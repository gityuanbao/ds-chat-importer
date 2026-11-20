/**
 * dsh-deepseek-archive —— 把 DeepSeek 网页版导出的聊天记录接续进 DSH。
 *
 * 两个工具：
 *   ds_archive_list   列出/搜索档案里的历史会话
 *   ds_archive_import 把某一条会话变成当前上下文里"可接续的对话"
 *
 * 设计要点：
 *   - 走 parent_id 主链，不按数组顺序铺（重试/重新生成会分叉）
 *   - 工具噪声（搜索结果、打开的网页）压成单行标记，思考默认不收
 *   - 超出预算时 = 首条 + 中间提纲 + 尾部逐字，且全文落盘供 read 工具续读
 */
import { readFile, readdir, stat, writeFile, mkdir, utimes } from 'node:fs/promises'
import { join, resolve, sep, dirname, basename, extname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { zstdCompressSync, inflateRawSync } from 'node:zlib'
import { execFile } from 'node:child_process'

/* ───────────────── zip 支持（直接读官方导出的压缩包） ───────────────── */

function zipEntries(buffer) {
  let eocd = -1
  const stop = Math.max(0, buffer.length - 65558)
  for (let i = buffer.length - 22; i >= stop; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录）')

  const count = buffer.readUInt16LE(eocd + 10)
  const cdOffset = buffer.readUInt32LE(eocd + 16)
  const out = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) break
    const flags = buffer.readUInt16LE(p + 8)
    const method = buffer.readUInt16LE(p + 10)
    const compSize = buffer.readUInt32LE(p + 20)
    const nameLen = buffer.readUInt16LE(p + 28)
    const extraLen = buffer.readUInt16LE(p + 30)
    const commentLen = buffer.readUInt16LE(p + 32)
    const localOffset = buffer.readUInt32LE(p + 42)
    const nameBytes = buffer.subarray(p + 46, p + 46 + nameLen)
    // bit 11 = 文件名是 UTF-8；否则官方导出基本也是 ASCII 路径
    const name = nameBytes.toString(flags & 0x800 ? 'utf8' : 'utf8')
    out.push({ name, method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

function readZipEntry(buffer, entry) {
  const p = entry.localOffset
  if (buffer.readUInt32LE(p) !== 0x04034b50) throw new Error('zip 本地头损坏：' + entry.name)
  const nameLen = buffer.readUInt16LE(p + 26)
  const extraLen = buffer.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const raw = buffer.subarray(start, start + entry.compSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) return inflateRawSync(raw)
  throw new Error('不支持的压缩方式 ' + entry.method + '：' + entry.name)
}

/** 把一个导出包（文件夹或 .zip）变成一个可直接扫描的目录 */
async function openArchiveDir(path) {
  const abs = resolve(path)
  if (await looksLikeArchive(abs)) return abs

  const info = await stat(abs)
  if (!info.isFile()) throw new Error('这个路径既不是导出目录，也不是压缩包：' + abs)
  if (extname(abs).toLowerCase() !== '.zip') throw new Error('只支持 .zip 压缩包或导出目录：' + abs)

  const key = createHash('sha1')
    .update(abs + '|' + info.size + '|' + info.mtimeMs)
    .digest('hex')
    .slice(0, 16)
  const target = join(dshHome(), 'cache', 'deepseek-archive', key)
  if (await looksLikeArchive(target)) return target

  const buffer = await readFile(abs)
  const entries = zipEntries(buffer)
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue
    const dest = join(target, entry.name)
    if (!resolve(dest).startsWith(resolve(target) + sep)) continue // 防目录穿越
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, readZipEntry(buffer, entry))
  }
  if (!(await looksLikeArchive(target))) {
    throw new Error('压缩包里没有找到 chat_sessions/，可能不是 DeepSeek 的导出包')
  }
  return target
}

/**
 * 扫描候选导出包，给面板下拉用。
 * 不假设任何固定路径 —— 谁的机器上都不一样。依次看：
 *   已选的包、配置的包、进程工作目录、桌面、下载。
 */
async function findArchiveSources(state) {
  const seeds = new Set()
  const pushSeed = (p) => {
    if (!p) return
    try {
      const abs = resolve(p)
      seeds.add(dirname(abs))
      seeds.add(abs)
    } catch {
      /* ignore */
    }
  }
  if (state.activeArchive) pushSeed(state.activeArchive)
  pushSeed(state.archiveRoot)
  pushSeed(process.cwd())
  for (const guess of ['Desktop', 'Downloads', 'Documents']) {
    try {
      pushSeed(join(homedir(), guess))
    } catch {
      /* ignore */
    }
  }

  const found = new Map()
  const scanDir = async (dir) => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (await looksLikeArchive(full)) {
          found.set(full, { path: full, kind: 'folder', label: e.name })
        }
      } else if (e.isFile() && extname(e.name).toLowerCase() === '.zip') {
        // 下载目录里全是 zip，只认 DeepSeek 导出的命名（deepseek_data-YYYY-MM-DD.zip）。
        // 改过名的包用面板里的「粘贴路径 → 打开」即可。
        if (!/deepseek|chat_?session/i.test(e.name)) continue
        let size = 0
        try {
          size = (await stat(full)).size
        } catch {
          /* ignore */
        }
        found.set(full, { path: full, kind: 'zip', label: e.name, bytes: size })
      }
    }
    return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name))
  }

  for (const dir of seeds) {
    // 先看本层；再看下一层（导出包常被下载器套在一个文件夹里）
    const subs = await scanDir(dir)
    for (const sub of subs.slice(0, 40)) await scanDir(sub)
  }

  return [...found.values()].sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'zip' ? -1 : 1))
}

/** 当前生效的档案目录：面板选过的优先，其次配置里的 */
async function activeArchiveRoot(state) {
  if (state.activeArchive) return openArchiveDir(state.activeArchive)
  if (state.archiveRoot) return resolveArchiveRoot(state.archiveRoot)
  throw new Error('还没有选导出包：在面板左上角「档案来源」里选一个 .zip 或已解压的导出目录')
}

export const name = 'dsh-deepseek-archive'
export const inject = ['tools']

const DEFAULT_MAX_CHARS = 36000

/** 记住用户选过的导出包，重启后不用再选一次 */
function archiveStateFile() {
  return join(dshHome(), 'cache', 'deepseek-archive', 'state.json')
}

async function loadPersistedArchive() {
  try {
    const j = JSON.parse(await readFile(archiveStateFile(), 'utf8'))
    return typeof j.archiveRoot === 'string' && j.archiveRoot ? j.archiveRoot : undefined
  } catch {
    return undefined
  }
}

async function persistArchive(path) {
  try {
    const f = archiveStateFile()
    await mkdir(dirname(f), { recursive: true })
    await writeFile(f, JSON.stringify({ archiveRoot: path }, null, 2), 'utf8')
  } catch {
    /* 记不住也不影响当次使用 */
  }
}

/* ────────────────────────── 小工具 ────────────────────────── */

function clip(s, head, tail = 0) {
  const t = String(s ?? '')
  if (t.length <= head + tail) return t
  if (tail <= 0) return t.slice(0, head) + '…'
  return t.slice(0, head) + '…〔中略 ' + (t.length - head - tail) + ' 字〕…' + t.slice(-tail)
}

function oneLine(s, n) {
  return clip(String(s ?? '').replace(/\s+/g, ' ').trim(), n)
}

function isoDay(v) {
  if (!v) return '?'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* ────────────────────── 定位档案目录 ────────────────────── */

async function looksLikeArchive(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.some((e) => e.isDirectory() && e.name === 'chat_sessions')
  } catch {
    return false
  }
}

async function resolveArchiveRoot(configured) {
  const candidates = []
  if (configured) candidates.push(resolve(configured))

  for (const base of candidates) {
    if (await looksLikeArchive(base)) return base
  }
  // 配置的是上一级目录（例如含 deepseek_data-* 子目录）
  for (const base of candidates) {
    let entries = []
    try {
      entries = await readdir(base, { withFileTypes: true })
    } catch {
      continue
    }
    const subs = entries.filter((e) => e.isDirectory()).map((e) => join(base, e.name))
    for (const sub of subs) {
      if (await looksLikeArchive(sub)) return sub
    }
  }
  throw new Error(
    '找不到 DeepSeek 导出目录（需要包含 chat_sessions/）。已尝试：' +
      (candidates.join(' | ') || '(未配置)'),
  )
}

/* ────────────────────── 会话索引 ────────────────────── */

const indexCache = new Map() // root -> { at, entries }

async function loadIndex(root) {
  const cached = indexCache.get(root)
  if (cached && Date.now() - cached.at < 5000) return cached.entries

  const sessionsDir = join(root, 'chat_sessions')
  let entries = []

  try {
    const parsed = JSON.parse(await readFile(join(root, 'chat_session_index.json'), 'utf8'))
    if (Array.isArray(parsed)) entries = parsed
  } catch {
    /* 没有索引文件就从目录扫 */
  }

  if (entries.length === 0) {
    const names = await readdir(sessionsDir)
    for (const n of names) {
      if (!n.endsWith('.json')) continue
      try {
        const j = JSON.parse(await readFile(join(sessionsDir, n), 'utf8'))
        entries.push({
          id: j.id,
          title: j.title,
          message_count: Array.isArray(j.messages) ? j.messages.length : 0,
          inserted_at: j.inserted_at,
          updated_at: j.updated_at,
        })
      } catch {
        /* 单个坏文件不影响整体 */
      }
    }
  }

  // 算出「真实对话字数」与文件体积。
  // 注意：文件体积里大头是联网搜索的结果快照，跟会话长短几乎无关；
  // 用户挑会话时真正想知道的是折掉噪音后有多少内容要读。
  const enriched = await Promise.all(
    entries.map(async (e) => {
      let bytes = 0
      let chars = null
      try {
        const f = join(sessionsDir, `${e.id}.json`)
        bytes = (await stat(f)).size
        const j = JSON.parse(await readFile(f, 'utf8'))
        chars = countConversationChars(j)
      } catch {
        /* 坏文件就留空 */
      }
      return { ...e, bytes, chars }
    }),
  )

  indexCache.set(root, { at: Date.now(), entries: enriched })
  return enriched
}

/** 折掉搜索/网页等噪音后的对话字数（只数主链上的问答） */
function countConversationChars(session) {
  let n = 0
  for (const m of mainChain(session)) {
    for (const f of Array.isArray(m.fragments) ? m.fragments : []) {
      const t = String(f.type || '')
      if (t === 'REQUEST' || t === 'RESPONSE' || t === 'TEMPLATE_RESPONSE') {
        n += String(f.content ?? '').length
      }
    }
  }
  return n
}

function sizeLabel(e) {
  const c = typeof e.chars === 'number' ? e.chars : undefined
  const kb = Math.max(1, Math.round((e.bytes || 0) / 1024))
  return c === undefined ? `${kb}KB` : `${c >= 1000 ? (c / 1000).toFixed(1) + 'k' : c}字`
}

async function readSession(root, id) {
  const safeId = String(id || '').replace(/[^0-9a-fA-F-]/g, '')
  if (!safeId) throw new Error('会话 id 非法')
  const file = resolve(join(root, 'chat_sessions', `${safeId}.json`))
  const base = resolve(root)
  if (!file.startsWith(base + sep)) throw new Error('路径越界')
  return JSON.parse(await readFile(file, 'utf8'))
}

function pickSession(entries, query) {
  const q = String(query || '').trim()
  if (!q) throw new Error('请给出会话 id 或标题关键词')
  const lower = q.toLowerCase()

  const exact = entries.find((e) => String(e.id).toLowerCase() === lower)
  if (exact) return { hit: exact }

  const byIdPrefix = entries.filter((e) => String(e.id).toLowerCase().startsWith(lower))
  if (byIdPrefix.length === 1) return { hit: byIdPrefix[0] }

  const byTitle = entries.filter((e) => String(e.title || '').toLowerCase().includes(lower))
  if (byTitle.length === 1) return { hit: byTitle[0] }

  const pool = byIdPrefix.length > 1 ? byIdPrefix : byTitle
  if (pool.length > 1) return { candidates: pool }
  return { candidates: [] }
}

/* ────────────────────── 主链与回合 ────────────────────── */

function mainChain(session) {
  const messages = Array.isArray(session.messages) ? session.messages : []
  if (messages.length === 0) return []
  const byId = new Map()
  for (const m of messages) byId.set(m.id, m)

  let cur = byId.get(session.current_message_id)
  if (!cur) cur = messages[messages.length - 1]

  const chain = []
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    chain.push(cur)
    cur = cur.parent_id === null || cur.parent_id === undefined ? undefined : byId.get(cur.parent_id)
  }
  return chain.reverse()
}

function buildTurns(session) {
  const turns = []
  for (const m of mainChain(session)) {
    const role = String(m.role || '').toUpperCase()
    const blocks = []
    let thinking = ''
    let hasReal = false
    let hasTemplate = false

    for (const f of Array.isArray(m.fragments) ? m.fragments : []) {
      const t = String(f.type || '')
      if (t === 'REQUEST' || t === 'RESPONSE') {
        const c = String(f.content ?? '').trim()
        if (c) {
          blocks.push(c)
          hasReal = true
        }
      } else if (t === 'TEMPLATE_RESPONSE') {
        const c = String(f.content ?? '').trim()
        if (c) {
          blocks.push('[系统模板回复] ' + c)
          hasTemplate = true
        }
      } else if (t === 'THINK') {
        thinking += String(f.content ?? '')
      } else if (t === 'TOOL_SEARCH') {
        const qs = (Array.isArray(f.queries) ? f.queries : []).join(' / ')
        const n = Array.isArray(f.results) ? f.results.length : 0
        if (qs || n) blocks.push(`[联网搜索：${clip(qs, 60)}${n ? ` → ${n} 条结果` : ''}]`)
      } else if (t === 'TOOL_OPEN') {
        const label = f.title || f.url || ''
        if (label) blocks.push(`[打开网页：${oneLine(label, 60)}]`)
      } else if (t === 'FILE') {
        const names = (Array.isArray(f.files) ? f.files : [])
          .map((x) => x && x.file_name)
          .filter(Boolean)
        if (names.length) blocks.push(`[附件：${names.join('、')}]`)
      }
      // CONTENT_RISK 及其它：忽略
    }

    const body = blocks.join('\n\n').trim()
    if (!body && !thinking) continue
    turns.push({
      role: role === 'USER' ? 'USER' : 'ASSISTANT',
      body,
      thinking,
      time: m.inserted_at ? Date.parse(m.inserted_at) : undefined,
      // 只有系统模板、没有任何真实回答 = 一次失败占位（如「服务器繁忙」）
      onlyTemplate: hasTemplate && !hasReal && !thinking,
    })
  }
  return turns
}

/**
 * 接续前的清理。
 *
 * DeepSeek 的会话里会留下失败重试的痕迹：用户因为「服务器繁忙」把同一句话重发好几次，
 * 于是真实对话变成了 U / 失败 / U / 真答案 / U / 失败。原样搬进上下文，尾巴会被重试噪音占满，
 * 「接着往下说」就没有落点。
 *
 * 这里做两件事，而且都在页脚如实报数（全文仍在 fullPath 里，不丢东西）：
 *   1. 丢掉纯失败占位（只有系统模板的助手消息）
 *   2. 合并连续重复的用户提问
 */
function sameAsk(a, b) {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
  return norm(a) === norm(b)
}

function cleanupTurns(turns) {
  const stats = { droppedFailures: 0, mergedRepeats: 0 }

  const kept = []
  for (const t of turns) {
    if (t.role === 'ASSISTANT' && t.onlyTemplate) {
      stats.droppedFailures += 1
      continue
    }
    const prev = kept[kept.length - 1]
    if (t.role === 'USER' && prev && prev.role === 'USER' && sameAsk(prev.body, t.body)) {
      stats.mergedRepeats += 1
      kept[kept.length - 1] = t // 保留较新的一条
      continue
    }
    kept.push(t)
  }
  return { turns: kept, stats }
}

/* ────────────────────── 组织成可接续的上下文 ────────────────────── */

function headerFor(session, meta) {
  return [
    '【DeepSeek 历史对话 · 接续上下文】',
    `标题：${session.title || '(无标题)'}`,
    `会话 id：${session.id}`,
    `时间：${isoDay(session.inserted_at)} → ${isoDay(session.updated_at)} ｜ 共 ${meta.turnCount} 轮 ｜ 原文 ${meta.totalChars} 字`,
    '',
    '下面是「用户」与「助手」在 DeepSeek 网页版里的完整对话。',
    '请把它当作**你已经参与过的对话上文**：不要复述、不要总结全文、不要逐条确认，',
    '直接接着最后一句往下继续，就像同一段对话没有中断过一样。',
    '若用户这轮有新要求，就在这个上下文之上继续处理。',
    '—'.repeat(28),
    '',
  ].join('\n')
}

function renderTurn(t, includeThinking) {
  const who = t.role === 'USER' ? '【用户】' : '【助手】'
  let s = `${who}\n${t.body}`
  if (includeThinking && t.thinking) {
    s += `\n\n<details><summary>当时的思考过程</summary>\n\n${clip(t.thinking, 1200, 400)}\n\n</details>`
  }
  return s
}

function compose(session, turns, budget, includeThinking) {
  const rendered = turns.map((t) => renderTurn(t, includeThinking))
  const header = headerFor(session, {
    turnCount: turns.length,
    totalChars: rendered.reduce((a, s) => a + s.length, 0),
  })
  const sepTurn = '\n\n---\n\n'
  const full = header + rendered.join(sepTurn)

  if (full.length <= budget) return { text: full, truncated: false }

  const avail = Math.max(2000, budget - header.length)
  const headBudget = Math.floor(avail * 0.3)
  const tailBudget = Math.floor(avail * 0.5)
  const outlineBudget = Math.max(400, avail - headBudget - tailBudget)

  const head = []
  let i = 0
  for (; i < rendered.length; i++) {
    if (head.join('').length + rendered[i].length > headBudget) break
    head.push(rendered[i])
  }

  const tail = []
  let j = rendered.length - 1
  for (; j >= i; j--) {
    if (tail.join('').length + rendered[j].length > tailBudget) break
    tail.unshift(rendered[j])
  }

  const outline = []
  let used = 0
  for (let k = i; k <= j; k++) {
    const line = `- [${turns[k].role === 'USER' ? '用户' : '助手'}] ${oneLine(turns[k].body, 72) || '(空)'}`
    if (used + line.length > outlineBudget) {
      outline.push(`- ……其余 ${j - k + 1} 条从略`)
      break
    }
    outline.push(line)
    used += line.length + 1
  }

  const parts = [header]
  if (head.length) parts.push(head.join(sepTurn), sepTurn)
  if (j >= i) {
    parts.push(`〔中间 ${j - i + 1} 条因篇幅折叠为提纲〕\n`, outline.join('\n'), sepTurn)
  }
  if (tail.length) parts.push(tail.join(sepTurn))

  return { text: parts.join(''), truncated: true }
}

/* ─────────────── 写成一条独立的 DSH 会话 ─────────────── */

/**
 * DSH 把会话存在 ~/.dsh/sessions/<转义后的 cwd>/session-<uuid>/session.v4.jsonl.zstd，
 * 内容是一个 zstd 压缩的 JSONL：第一行是 header，其后每条是一个带 seq 的事件。
 *
 * 这里按"一条真实会话"的形状合成它：
 *   turn/start → step/start → user/message → assistant/message → step/end → turn/end
 * 只写这几类通用事件，不伪造 request/header —— 用户下次在里面说话时，agent 会照常补上。
 * 写完立刻用 DSH 自己的读端（sessionController.list / events）验一遍，验不过就删掉。
 */

const SESSION_FORMAT_VERSION = 4

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 这个路径是否落在 ~/.dsh 里（缓存、会话、配置都在这儿） */
function isInsideDshHome(p) {
  try {
    const home = resolve(dshHome())
    const abs = resolve(p)
    return abs === home || abs.startsWith(home + sep)
  } catch {
    return false
  }
}

/**
 * 没指定目标工作文件夹时的落点。
 *
 * 两个都踩过的坑：
 *   1. 更早是 `dirname(档案目录)`，而档案目录在缓存里，于是会话被导进
 *      ~/.dsh/cache/deepseek-archive，还建了个叫 deepseek-archive 的工作区；
 *   2. 改成 `dirname(包路径)` 后，放下载目录的包会让默认目标变成整个 ~/Downloads
 *      —— 会话是能建，但工作区等于把用户的下载目录当 agent 工作目录，不合适。
 * 现在固定落到一个专用目录，语义清楚：每次导入都在同一个工作区里。
 */
function defaultImportCwd(state) {
  if (state.sessionCwd) return state.sessionCwd
  return join(homedir(), 'Documents', 'DeepSeek 导入')
}

/**
 * C:\Users\x\桌面 → --C-Users-x-~684C~9762--
 * 规则（对着真实目录名反推出来的）：盘符冒号丢弃，\ 和 / 变 -，非 ASCII 字符变 ~ + 四位大写十六进制。
 */
function escapeCwd(cwd) {
  let out = ''
  for (let i = 0; i < cwd.length; i++) {
    const ch = cwd[i]
    const code = cwd.charCodeAt(i)
    if (ch === '/' || ch === '\\') out += '-'
    else if (ch === ':') continue
    else if (code < 0x20 || code > 0x7e) {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    } else out += ch
  }
  return '--' + out + '--'
}

/** 把交替的 USER/ASSISTANT 回合分组成「一问一答」 */
function groupTurns(turns) {
  const groups = []
  let cur
  for (const t of turns) {
    if (!cur || t.role === 'USER') {
      cur = { user: null, assistants: [] }
      groups.push(cur)
    }
    if (t.role === 'USER') cur.user = t
    else cur.assistants.push(t)
  }
  return groups
}

function buildSessionJsonl({
  id,
  cwd,
  createdAt,
  turns,
  provider,
  model,
  title,
  agentPreset,
  reasoningEffort,
  existingEvents,
}) {
  const header = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt,
    cwd,
    isSeeded: false,
    delegationDepth: 0,
  }
  // 关键：没有 agentPreset，宿主就组不出 agent —— sessionController 会给出
  // agentAvailable:false，侧边栏里点不开，表现为"导入了但看不到"。
  if (agentPreset) header.agentPreset = agentPreset
  const lines = [JSON.stringify(header)]

  let seq = 0
  let clock = createdAt
  // 会话是经 sessionController.create 建立的，它已经有几条事件（权限/沙箱等）。
  // 必须原样保留并接在其后续写 seq，否则读端会报 "source headers conflict"。
  for (const ev of Array.isArray(existingEvents) ? existingEvents : []) {
    if (!ev || !ev.type) continue
    lines.push(JSON.stringify(ev))
    if (typeof ev.seq === 'number' && ev.seq + 1 > seq) seq = ev.seq + 1
    if (typeof ev.time === 'number' && ev.time > clock) clock = ev.time
  }

  const tick = (want) => {
    clock = Math.max(clock + 1, Number.isFinite(want) ? want : 0)
    return clock
  }
  const push = (type, want, data, extra) => {
    const event = { type, seq: seq++, time: tick(want), data }
    if (extra) Object.assign(event, extra)
    lines.push(JSON.stringify(event))
    return event
  }

  let titleSeq
  let titlePending = Boolean(title)
  let seriesStarted = false
  groupTurns(turns).forEach((g, i) => {
    const turn = TURN_BASE + i + 1
    push('turn/start', g.user && g.user.time, { turn })
    push('step/start', g.user && g.user.time, { turn, step: 1 })

    if (g.user) {
      const ev = push(
        'user/message',
        g.user.time,
        {
          content: [{ type: 'text', text: g.user.body }],
          source: { kind: 'user' },
          role: 'user',
          id: randomUUID(),
        },
        { surfaceOp: 'append' },
      )
      if (titleSeq === undefined) titleSeq = ev.seq
    }
    if (titlePending && titleSeq !== undefined) {
      push('session/title', g.user && g.user.time, {
        title,
        messageSeqs: [titleSeq],
        source: { kind: 'fallback' },
      })
      titlePending = false
    }

    // 恢复 agent 需要知道用哪个模型：没有 request/header，宿主给出
    // agentAvailable:false，会话在侧边栏里点不开。只写一次，与真实日志同序。
    if (!seriesStarted) {
      const config = { provider, model }
      if (reasoningEffort) config.reasoningEffort = reasoningEffort
      push('request/header', g.user && g.user.time, {
        header: { config },
        reason: 'initial',
        startsSeries: true,
      })
      push('request/context', g.user && g.user.time, { provider, model })
      seriesStarted = true
    }

    for (const a of g.assistants) {
      push(
        'assistant/message',
        a.time,
        {
          turn,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: a.body }],
            source: { kind: 'model', provider, model },
            id: randomUUID(),
          },
          stream: [],
        },
        { surfaceOp: 'append' },
      )
    }

    push('step/end', undefined, { turn, step: 1 })
    push('turn/end', undefined, { turn, reason: { kind: 'completed' } })
  })

  return { header: lines[0], body: lines.slice(1).join('\n') + '\n' }
}

async function writeSession({
  cwd,
  title,
  turns,
  createdAt,
  updatedAt,
  provider,
  model,
  agentPreset,
  reasoningEffort,
  id: presetId,
  existingEvents,
}) {
  const id = presetId || `session-${randomUUID()}`
  const dir = join(dshHome(), 'sessions', escapeCwd(cwd), id)
  await mkdir(dir, { recursive: true })
  const { header, body } = buildSessionJsonl({
    id,
    cwd,
    createdAt,
    turns,
    provider,
    model,
    title,
    agentPreset,
    reasoningEffort,
    existingEvents,
  })
  const file = join(dir, 'session.v4.jsonl.zstd')
  // DSH 的会话日志是「多帧 zstd」：第 1 帧必须**只含 header 一行**，事件放在后续帧里。
  // 合成一整帧会被读端判成 corrupt（header frame failed validation）。
  const buf = Buffer.concat([
    zstdCompressSync(Buffer.from(header + '\n', 'utf8')),
    zstdCompressSync(Buffer.from(body, 'utf8')),
  ])
  await writeFile(file, buf)
  // 经官方路径建立的会话，时间轴由 create 决定，不再改 mtime
  if (Number.isFinite(updatedAt) && !existingEvents) {
    const secs = updatedAt / 1000
    await utimes(file, secs, secs).catch(() => {})
  }
  return { id, dir, file, bytes: buf.length, turns: turns.length }
}

/**
 * 往「已经由 sessionController.create 建立的实时会话」里追加对话事件。
 *
 * 不能改磁盘文件：那个会话已经接进了写端（writer），它的 flush 会在我们写完之后
 * 再写一遍自己的缓冲，把内容冲乱。所以只能走 Session.append。
 */
/**
 * 导入内容的轮次编号起点。
 *
 * 为什么不用 1、2、3：会话是经 sessionController.create 建立的，那一刻会话还是空的，
 * agent 的轮次计数器是 0。随后我们 append 进去的 turn=1/2 它并不知道，
 * 于是用户接着说话时 agent 又从 turn=1 开始数 —— 轮号撞车。
 * Chat 界面按轮号分组，结果就把"这一轮的耗时/已完成"挂到了导入的历史轮头上，
 * 表现为「已完成，用时 31 秒」出现在错误的位置。
 *
 * 用一个大起点避开 agent 的 1、2、3，两边编号永不重叠。
 */
const TURN_BASE = 10000

function appendTurnsToLiveSession(live, { turns, title, provider, model, reasoningEffort }) {
  let titlePending = Boolean(title)
  let titleSeq
  let seriesStarted = false
  let events = 0

  groupTurns(turns).forEach((g, i) => {
    const turn = TURN_BASE + i + 1
    live.append('turn/start', { turn })
    events++
    live.append('step/start', { turn, step: 1 })
    events++

    if (g.user) {
      const ev = live.append(
        'user/message',
        {
          content: [{ type: 'text', text: g.user.body }],
          source: { kind: 'user' },
          role: 'user',
          id: randomUUID(),
        },
        { surfaceOp: 'append' },
      )
      events++
      if (titleSeq === undefined) titleSeq = ev.seq
    }
    if (titlePending && titleSeq !== undefined) {
      live.append('session/title', { title, messageSeqs: [titleSeq], source: { kind: 'fallback' } })
      events++
      titlePending = false
    }

    // 恢复 agent 需要知道用哪个模型
    if (!seriesStarted) {
      const config = { provider, model }
      if (reasoningEffort) config.reasoningEffort = reasoningEffort
      live.append('request/header', { header: { config }, reason: 'initial', startsSeries: true })
      live.append('request/context', { provider, model })
      events += 2
      seriesStarted = true
    }

    for (const a of g.assistants) {
      live.append(
        'assistant/message',
        {
          turn,
          step: 1,
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: a.body }],
            source: { kind: 'model', provider, model },
            id: randomUUID(),
          },
          stream: [],
        },
        { surfaceOp: 'append' },
      )
      events++
    }

    live.append('step/end', { turn, step: 1 })
    live.append('turn/end', { turn, reason: { kind: 'completed' } })
    events += 2
  })

  return events
}

function errMsg(err) {
  return String((err && err.message) || err).split('\n')[0].slice(0, 200)
}

/* ────────────────── 选目录：native / browse / macOS 兜底 ────────────────── */

const PICK_TIMEOUT_MS = 5 * 60 * 1000

/** 去掉末尾斜杠（保留根目录），并把 Windows 反斜杠统一成 / 便于比较 */
function normalizeDirPath(p) {
  const s = String(p ?? '').trim()
  if (!s) return null
  const unified = s.replace(/\\/g, '/')
  if (unified === '/' || /^[A-Za-z]:\/$/.test(unified)) return unified
  return unified.replace(/\/+$/, '')
}

/**
 * macOS 兜底：直接用 osascript 弹系统「选择文件夹」对话框。
 *
 * 为什么需要兜底：DSH 的 directoryPicker 有 native / browse 两种组合，
 * 插件原先不看 kind 直接调 pick()，一旦组合成 browse 就抛
 * `directory-picker/unavailable`（系统对话框在这套组合里根本不存在）。
 * 桌面端本机明明能弹 macOS 原生对话框，没必要因为 DSH 的能力组合而整块用不了。
 */
function pickFolderMac(promptText, signal) {
  return new Promise((resolve) => {
    const prompt = String(promptText || '选择要导入到的文件夹').replace(/["\\]/g, ' ')
    const script = [
      'try',
      `  set f to choose folder with prompt "${prompt}"`,
      '  return POSIX path of f',
      'on error number -128',
      '  return ""',
      'end try',
    ].join('\n')
    if (signal && signal.aborted) return resolve({ canceled: true, path: null })
    execFile(
      'osascript',
      ['-e', script],
      { timeout: PICK_TIMEOUT_MS, maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || err)
          // -128 / User canceled：用户点了取消，不算错误
          if (/\(-128\)|User canceled/i.test(msg)) return resolve({ canceled: true, path: null })
          return resolve({ path: null, error: errMsg(msg) })
        }
        const path = normalizeDirPath(stdout)
        if (!path) return resolve({ canceled: true, path: null })
        resolve({ path })
      },
    )
  })
}

/** 读一下当前组合提供的是哪种能力；拿不到返回 null */
function pickerCapabilityKind(ctl) {
  try {
    if (!ctl || typeof ctl.capability !== 'function') return null
    const cap = ctl.capability()
    return cap && typeof cap.kind === 'string' ? cap.kind : null
  } catch {
    return null
  }
}

/** 写完立刻用 DSH 自己的读端验一遍：列得出、读得回，才算真的成了 */
async function verifySession(ctx, id) {
  const sc = ctx.get('sessionController')
  const sq = ctx.get('sessionQuery')

  let listed = null
  let agentAvailable = null
  let messages = null
  let user = null
  let assistant = null
  let via = null
  let reason = null

  if (sc && typeof sc.list === 'function') {
    try {
      const value = await sc.list({}, AbortSignal.timeout(10000))
      const items = (value && value.items) || []
      const summary = items.find((s) => String(s.sessionId) === id)
      listed = Boolean(summary)
      // agentAvailable 只对"正被 agent 持有着的会话"为 true，冷会话普遍 false，不能当判据
      agentAvailable = summary ? summary.agentAvailable === true : null
    } catch (err) {
      reason = 'list 失败：' + errMsg(err)
    }
  } else {
    reason = 'sessionController.list 不可用'
  }

  // 读回消息条数：新版走 sessionQuery.readSession()，旧版走 sessionController.events()。
  // 这两个 API 换过名字 —— 硬编码其一会让自检恒判失败（早先版本因此把刚写好的会话删掉）。
  if (sq && typeof sq.readSession === 'function') {
    try {
      const snap = await sq.readSession(id)
      const events = Array.isArray(snap && snap.events) ? snap.events : []
      user = events.filter((e) => e && e.type === 'user/message').length
      assistant = events.filter((e) => e && e.type === 'assistant/message').length
      messages = events.length
      via = 'sessionQuery.readSession'
    } catch (err) {
      reason = (reason ? reason + '；' : '') + 'readSession 失败：' + errMsg(err)
    }
  } else if (sc && typeof sc.events === 'function') {
    try {
      const page = await sc.events(
        { address: { kind: 'session', sessionId: id }, maxMessages: 200 },
        AbortSignal.timeout(10000),
      )
      messages = Array.isArray(page && page.records) ? page.records.length : 0
      via = 'sessionController.events'
    } catch (err) {
      reason = (reason ? reason + '；' : '') + 'events 失败：' + errMsg(err)
    }
  } else {
    reason = (reason ? reason + '；' : '') + '没有可用的会话读回 API（sessionQuery.readSession）'
  }

  return { checked: listed !== null || messages !== null, listed, agentAvailable, messages, user, assistant, via, reason }
}

function buildDiagTool(state, ctx) {
  return {
    name: 'ds_archive_diag',
    description: '诊断：报告 DSH 会话读端（sessionController.list / sessionQuery.readSession）当前能看到什么，用于排查导入的会话为何没出现。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '可选：对指定会话做一次读回，验证读端调用是否正确' },
      },
      additionalProperties: false,
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const a = args && typeof args === 'object' ? args : {}
      const sc = ctx.get('sessionController')
      const out = []
      if (!sc) return { text: 'sessionController 不可用（未注入？）' }

      try {
        const value = await sc.list({}, AbortSignal.timeout(15000))
        const items = (value && value.items) || []
        out.push(`list 返回 ${items.length} 条会话`)
        const cwds = {}
        for (const s of items.slice(0, 400)) {
          const k = String(s.cwd || '(none)')
          cwds[k] = (cwds[k] || 0) + 1
        }
        out.push('按 cwd 分布（前 6）：')
        for (const [k, n] of Object.entries(cwds).sort((x, y) => y[1] - x[1]).slice(0, 6)) {
          out.push(`  ${n} 条  ${k}`)
        }
        out.push('样本 id：' + items.slice(0, 5).map((s) => String(s.sessionId)).join(', '))
        const avail = items.filter((s) => s.agentAvailable === true).length
        const running = items.filter((s) => s.running === true).length
        out.push(`agentAvailable=true：${avail}/${items.length}｜running=true：${running}`)
        const coldTrue = items.find((s) => s.agentAvailable === true && s.running !== true)
        if (coldTrue) out.push('一条「不在运行但可打开」的真实会话：' + JSON.stringify(coldTrue))
        try {
          const ap = ctx.get('agentPresets')
          if (ap && typeof ap.list === 'function') {
            const list = await ap.list()
            out.push('可用 agent preset：' + list.map((p) => p.id).join(', '))
          }
        } catch (err) {
          out.push('读取 preset 失败：' + errMsg(err))
        }
        if (a.sessionId) {
          const inList = items.some((s) => String(s.sessionId) === String(a.sessionId))
          out.push(`目标 ${a.sessionId} 是否在 list 中：${inList ? '✓ 在' : '✗ 不在'}`)
          const summary = items.find((s) => String(s.sessionId) === String(a.sessionId))
          if (summary) out.push('该会话的 summary：' + JSON.stringify(summary))
          const control = items[0]
          if (control) out.push('参照（另一条真实会话）的 summary：' + JSON.stringify(control))
        }
      } catch (err) {
        out.push('list 失败：' + errMsg(err))
      }

      // 读回探测：走和导入自检同一套（新版 sessionQuery → 旧版 sessionController.events）
      const target = a.sessionId || 'session-a01789ea-aef8-4320-9d7f-a013566fc943'
      const sq = ctx.get('sessionQuery')
      out.push('sessionQuery 可用：' + Boolean(sq && typeof sq.readSession === 'function'))
      if (sq && typeof sq.readSession === 'function') {
        try {
          const snap = await sq.readSession(target)
          const events = (snap && snap.events) || []
          out.push(
            `readSession(${target}) → events=${events.length} 首条=${events.slice(0, 4).map((e) => (e && e.type) || '?').join(' / ')}`,
          )
        } catch (err) {
          out.push('readSession 失败：' + errMsg(err))
        }
      } else if (sc && typeof sc.events === 'function') {
        try {
          const page = await sc.events(
            { address: { kind: 'session', sessionId: target }, maxMessages: 20 },
            AbortSignal.timeout(15000),
          )
          out.push(
            `events(${target}) → records=${(page && page.records && page.records.length) || 0} hasMore=${page && page.hasMore}`,
          )
        } catch (err) {
          out.push('events 失败：' + errMsg(err))
        }
      } else {
        out.push('没有可用的读回接口（sessionQuery.readSession 不存在）')
      }

      out.push('dshHome=' + dshHome())
      return { text: out.join('\n') }
    },
  }
}

/* ─────────── 导入操作：工具与 UI 共用这一份实现 ─────────── */

/**
 * 导入一条 DeepSeek 会话，使它成为侧边栏里一条独立 DSH 会话。
 * 工具（ds_archive_import）和网页面板（HTTP 路由）都调这一个函数。
 */
async function importToSession(ctx, state, req) {
  const root = await activeArchiveRoot(state)
  const entries = await loadIndex(root)
  const picked = pickSession(entries, req.session)

  if (!picked.hit) {
    return {
      ok: false,
      stage: 'match',
      error: '没有唯一命中的会话',
      candidates: (picked.candidates || [])
        .slice(0, 20)
        .map((e) => ({ id: e.id, title: e.title, updated_at: e.updated_at })),
    }
  }

  const session = await readSession(root, picked.hit.id)
  const rawTurns = buildTurns(session)
  if (rawTurns.length === 0) {
    return { ok: false, stage: 'content', error: '这条会话里没有可用的对话内容' }
  }

  const clean =
    req.keepFailures === true
      ? { turns: rawTurns, stats: { droppedFailures: 0, mergedRepeats: 0 } }
      : cleanupTurns(rawTurns)
  const turns = clean.turns
  if (turns.length === 0) {
    return { ok: false, stage: 'content', error: '消息全是失败占位（如「服务器繁忙」），没有可接续的真实内容' }
  }

  const cwd = resolve(
    String(req.cwd && String(req.cwd).trim() ? req.cwd : defaultImportCwd(state)),
  )
  // 导进 ~/.dsh（缓存/配置目录）几乎一定是目标选错了，给个提醒但不算失败
  const cwdInDshHome = isInsideDshHome(cwd)
  const title = String(
    req.title && String(req.title).trim() ? req.title : session.title || '(导入的对话)',
  )

  let selection = { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: undefined }
  try {
    const svc = ctx.get('agentDefaultModel')
    const cur = svc && svc.currentSelection()
    if (cur && cur.provider && cur.model) {
      selection = { provider: cur.provider, model: cur.model, reasoningEffort: cur.reasoningEffort }
    }
  } catch {
    /* 拿不到默认模型就用兜底值 */
  }

  // 必须写进 header，否则宿主给出 agentAvailable:false，会话在侧边栏里点不开
  let agentPreset = state.agentPreset
  try {
    const ap = ctx.get('agentPresets')
    if (ap && typeof ap.resolve === 'function') {
      const resolved = await ap.resolve()
      if (resolved && resolved.id) agentPreset = resolved.id
    }
  } catch {
    /* 用配置兜底 */
  }
  if (!agentPreset) agentPreset = 'standard'

  // 目标文件夹如果还不是工作区，就登记成新工作区 —— 否则侧边栏没有对应的分组，
  // 会话即使写成功了也无处安放。
  let workspace = null
  try {
    const reg = ctx.get('workspaceRegistry')
    if (reg) {
      const existing = typeof reg.resolveByPath === 'function' ? await reg.resolveByPath(cwd) : undefined
      if (existing) {
        workspace = { id: String(existing.id), path: cwd, created: false }
      } else if (typeof reg.create === 'function') {
        const created = await reg.create(cwd, basename(cwd) || title)
        workspace = { id: String(created.id), path: cwd, created: true }
      }
    }
  } catch (err) {
    workspace = { path: cwd, error: errMsg(err) }
  }

  // 走官方创建路径：只有经 sessionController.create 建出来的会话才会被登记进
  // 工作区的 sessionIds 数组，而侧边栏正是按这张表渲染的。
  // 直接往磁盘写文件的话，会话能列出来、能读，但侧边栏永远不显示
  //（insertSessionBefore 也会报 "the session is not accounted"）。
  const sessionId = `session-${randomUUID()}`
  const sc = ctx.get('sessionController')
  let createdViaApi = false
  try {
    if (sc && typeof sc.create === 'function' && workspace && workspace.id) {
      const v = await sc.create({ workspaceId: workspace.id, sessionId })
      createdViaApi = Boolean(v && v.sessionId)
    }
  } catch (err) {
    return { ok: false, stage: 'create', error: '登记新会话失败：' + errMsg(err), workspace }
  }

  // 优先：往实时会话日志里追加。这是唯一不会和写端打架的方式。
  let written
  const store = ctx.get('sessions')
  const live =
    createdViaApi && store && typeof store.get === 'function' ? store.get(sessionId) : undefined

  if (live && typeof live.append === 'function') {
    try {
      const count = appendTurnsToLiveSession(live, {
        turns,
        title,
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
      })
      try {
        if (store && typeof store.flush === 'function') await store.flush(live)
      } catch {
        /* flush 失败不影响内存中的会话 */
      }
      const dir = join(dshHome(), 'sessions', escapeCwd(cwd), sessionId)
      written = { id: sessionId, dir, file: join(dir, 'session.v4.jsonl.zstd'), events: count }
    } catch (err) {
      return { ok: false, stage: 'append', error: '写入会话日志失败：' + errMsg(err) }
    }
  } else {
    // 兜底：拿不到实时会话时才直接写文件（此时没有写端竞争）
    try {
      written = await writeSession({
        id: sessionId,
        cwd,
        title,
        turns,
        createdAt:
          Date.parse(session.inserted_at) ||
          (turns[0] && turns[0].time) ||
          Date.parse(session.updated_at) ||
          Date.now(),
        updatedAt: Date.parse(session.updated_at) || Date.now(),
        provider: selection.provider,
        model: selection.model,
        agentPreset,
        reasoningEffort: selection.reasoningEffort,
      })
    } catch (err) {
      return { ok: false, stage: 'write', error: errMsg(err) }
    }
  }

  // 关键一步：唤醒一次会话。
  // 侧边栏是靠投影缓存（标题、用量等）渲染的，而投影缓存只在会话被 resume 时计算并落盘
  // （storages/session_projcache/sessions/<id>.json）。不唤醒就没缓存，
  // 表现为"导入成功但侧边栏看不到"。
  let warmed = null
  try {
    const sc = ctx.get('sessionController')
    if (sc && typeof sc.resolveAgent === 'function') {
      const r = await sc.resolveAgent(written.id)
      warmed = r && r.agent ? 'agent' : r && r.error ? r.error.code || String(r.error) : 'unknown'
    }
  } catch (err) {
    warmed = 'err:' + errMsg(err)
  }

  const cacheFile = join(dshHome(), 'storages', 'session_projcache', 'sessions', written.id + '.json')
  let projections = null
  for (let i = 0; i < 20; i++) {
    let cached = true
    try {
      await stat(cacheFile)
    } catch {
      cached = false
    }
    let title = null
    try {
      const sc = ctx.get('sessionController')
      const value = await sc.projections({ sessionId: written.id }, AbortSignal.timeout(10000))
      title = (value && value.values && value.values.title) || null
    } catch {
      /* ignore */
    }
    if (cached && title) {
      projections = { cached, title }
      break
    }
    projections = { cached, title }
    await new Promise((r) => setTimeout(r, 250))
  }

  const check = await verifySession(ctx, written.id)

  // 侧边栏是渲染「工作区的 sessionIds 数组」的，所以"被登记"是可见性的强判据，
  // 但读不到登记表时（resolveByPath 不可用）不能当成失败。
  let accounted = null
  try {
    const reg = ctx.get('workspaceRegistry')
    const ws = reg && typeof reg.resolveByPath === 'function' ? await reg.resolveByPath(cwd) : undefined
    accounted = ws ? ws.sessionIds.includes(written.id) : null
  } catch {
    accounted = null
  }

  // 判据：列得出 + 读得回 +（登记表可读时）已登记。
  // 读回条数为 null 表示这台机器没有可用的读回 API —— 降级为"写入但未经读端确认"，
  // 不算失败，更不能删：删了就是用户刚才遇到的"侧边栏有、磁盘没有"。
  const missing = check.listed === false && (check.messages === null || check.messages === 0)
  const verified =
    check.listed === true && check.messages !== null && check.messages > 0 && accounted !== false
  const degraded = !verified && !missing
  const keptUnverified = degraded

  return {
    ok: !missing,
    stage: 'done',
    verified,
    degraded,
    keptUnverified,
    rolledBack: false,
    unverified: check.messages === null || check.listed === null,
    sessionId: written.id,
    title,
    cwd,
    cwdInDshHome,
    file: written.file,
    agentPreset,
    warmed,
    workspace,
    accounted,
    createdViaApi,
    projections,
    messages: turns.length,
    questions: turns.filter((t) => t.role === 'USER').length,
    answers: turns.filter((t) => t.role === 'ASSISTANT').length,
    cleanup: clean.stats,
    verify: check,
    sourceSessionId: session.id,
  }
}

function formatImportResult(r) {
  if (!r.ok) {
    const lines = [`❌ 导入失败（${r.stage}）：${r.error || '会话既列不出来也读不回来'}`]
    if (r.verify) {
      lines.push(
        `自检：list=${r.verify.listed} agentAvailable=${r.verify.agentAvailable} 读回=${
          r.verify.messages
        }${r.verify.reason ? ' reason=' + r.verify.reason : ''}`,
      )
    }
    if (r.agentPreset) lines.push(`agentPreset=${r.agentPreset}`)
    if (r.projections !== undefined) lines.push('projections=' + JSON.stringify(r.projections))
    if (r.candidates && r.candidates.length) {
      lines.push('候选会话：')
      for (const c of r.candidates) lines.push(`- ${isoDay(c.updated_at)} | ${c.title} | id=${c.id}`)
      lines.push('用 ds_archive_list 确认后再试，或传更精确的 id。')
    }
    return lines.join('\n')
  }
  const lines = [
    r.degraded
      ? '✅ 会话已写入并出现在侧边栏（自检降级：这台机器读回接口与插件预期不一致）。'
      : r.unverified
        ? '✅ 会话已写入（未能自检，未经 DSH 读端确认）。'
        : '✅ 已导入为一条独立会话，位于侧边栏。',
    `标题：${r.title}`,
    `会话 id：${r.sessionId}`,
    `工作区：${r.cwd}${r.workspace && r.workspace.created ? '（新建工作区）' : ''}`,
    ...(r.cwdInDshHome ? ['⚠️ 目标目录在 ~/.dsh 里（缓存/配置目录），建议换一个普通文件夹重导'] : []),
    `内容：${r.messages} 条消息（${r.questions} 个提问 / ${r.answers} 个回答${
      r.cleanup.droppedFailures || r.cleanup.mergedRepeats
        ? `；清理了 ${r.cleanup.droppedFailures} 条失败占位、${r.cleanup.mergedRepeats} 处重复提问`
        : ''
    }）`,
    `文件：${r.file}`,
  ]
  if (r.verify && r.verify.checked) {
    lines.push(
      `自检：list ${r.verify.listed ? '✓' : '✗'} ｜ 读回 ${
        r.verify.messages === null ? '不可用' : r.verify.messages + ' 条'
      }${r.verify.via ? `（${r.verify.via}）` : ''} ｜ 工作区登记 ${
        r.accounted === null ? '未知' : r.accounted ? '✓' : '✗'
      } ｜ 投影缓存 ${r.projections && r.projections.cached ? '✓' : '✗'}`,
    )
  } else if (r.verify) {
    lines.push(`自检：未执行（${r.verify.reason}）`)
  }
  if (r.degraded && r.verify && r.verify.reason) lines.push(`自检说明：${r.verify.reason}`)
  if (r.ok) lines.push('', '去侧边栏点开这条会话，直接接着往下说就行。')
  return lines.join('\n')
}

/* ────────────────── 网页面板用的同源 HTTP 接口 ────────────────── */

const API_ROUTE = '/_deepseek-archive/api'

function readJsonBody(request, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大（上限 ' + Math.round(limit / 1048576) + 'MB）'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(err)
      }
    })
    request.on('error', reject)
  })
}

function createApiHandler(ctx, state) {
  const send = (response, code, payload) => {
    response.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify(payload))
  }

  return async (request, response) => {
    if (request.method !== 'POST') return send(response, 405, { ok: false, error: 'method not allowed' })

    let body
    try {
      // uploadArchive 要带走整个导出包（base64 后约 ×1.37），其余接口给 1MB 就够
      body = await readJsonBody(request, 700 * 1024 * 1024)
    } catch (err) {
      return send(response, 400, { ok: false, error: '请求体不是合法 JSON：' + errMsg(err) })
    }

    const action = String(body.action || '')
    try {
      if (action === 'sources') {
        const sources = await findArchiveSources(state)
        return send(response, 200, {
          ok: true,
          active: state.activeArchive || null,
          configured: state.archiveRoot || null,
          sources,
        })
      }

      if (action === 'uploadArchive') {
        // 浏览器不给真实路径时（部分环境下 File.path 为空），把文件内容传上来存成临时 zip
        const name = String(body.name || 'upload.zip').replace(/[\\/:*?"<>|]/g, '_')
        if (extname(name).toLowerCase() !== '.zip') {
          return send(response, 200, { ok: false, error: '只能接收 .zip；解压后的目录请用「选文件夹…」' })
        }
        if (typeof body.base64 !== 'string' || !body.base64) {
          return send(response, 200, { ok: false, error: '没有收到文件内容' })
        }
        let buf
        try {
          buf = Buffer.from(body.base64, 'base64')
        } catch (err) {
          return send(response, 200, { ok: false, error: '文件解码失败：' + errMsg(err) })
        }
        if (buf.length > 512 * 1024 * 1024) {
          return send(response, 200, { ok: false, error: '文件太大（超过 512MB）' })
        }
        const dir = join(dshHome(), 'cache', 'deepseek-archive', 'uploads')
        await mkdir(dir, { recursive: true })
        const dest = join(dir, `${Date.now()}-${name}`)
        await writeFile(dest, buf)
        return send(response, 200, { ok: true, path: dest, bytes: buf.length, name })
      }

      if (action === 'useArchive') {
        const path = String(body.path || '').trim()
        if (!path) return send(response, 200, { ok: false, error: '没有给出档案路径' })
        // 先确认这个包能打开，再切换，避免切到一个打不开的路径
        const dir = await openArchiveDir(path)
        state.activeArchive = resolve(path)
        state.lastArchiveError = undefined
        persistArchive(state.activeArchive)
        return send(response, 200, {
          ok: true,
          active: state.activeArchive,
          resolvedDir: dir,
          sources: await findArchiveSources(state),
        })
      }

      if (action === 'list') {
        if (!state.activeArchive) state.activeArchive = undefined
        const root = await activeArchiveRoot(state)
        state.resolvedDir = root
        const entries = await loadIndex(root)
        const q = String(body.query || '').trim().toLowerCase()
        let rows = q
          ? entries.filter(
              (e) =>
                String(e.title || '').toLowerCase().includes(q) ||
                String(e.id || '').toLowerCase().includes(q),
            )
          : entries.slice()
        rows.sort((x, y) => new Date(y.updated_at || 0) - new Date(x.updated_at || 0))
        return send(response, 200, {
          ok: true,
          archiveRoot: root,
          source: state.activeArchive || null,
          total: rows.length,
          archiveTotal: entries.length,
          sessions: rows.map((e) => ({
            id: e.id,
            title: e.title ?? '(无标题)',
            day: isoDay(e.updated_at),
            updatedAt: e.updated_at ?? null,
            messages: e.message_count ?? null,
            chars: e.chars ?? null,
          })),
        })
      }

      if (action === 'workspaces') {
        const out = []
        try {
          const reg = ctx.get('workspaceRegistry')
          for (const w of (reg && reg.list()) || []) {
            out.push({ id: String(w.id ?? w.workspaceId ?? ''), path: w.path ?? w.directory ?? '', title: w.title ?? '' })
          }
        } catch (err) {
          return send(response, 200, { ok: false, error: '读取工作区失败：' + errMsg(err) })
        }
        return send(response, 200, {
          ok: true,
          workspaces: out,
          // 面板把它显示在「（默认：…）」里 —— 默认落点是哪儿必须是可见的，
          // 之前只写「档案所在目录」，实际会落到下载目录甚至缓存目录。
          defaultCwd: defaultImportCwd(state),
          sessionsRoot: join(dshHome(), 'sessions'),
        })
      }

      if (action === 'pickerInfo') {
        // 诊断用：报告这台机器上 DSH 的目录选择器组合成了哪种能力
        const ctl = ctx.get('directoryPickerController')
        return send(response, 200, {
          ok: true,
          hasController: Boolean(ctl),
          kind: pickerCapabilityKind(ctl),
          platform: process.platform,
          canPickNative: typeof ctl?.pick === 'function',
          hasOsaFallback: process.platform === 'darwin',
        })
      }

      if (action === 'pickFolder') {
        const ctl = ctx.get('directoryPickerController')
        const kind = pickerCapabilityKind(ctl)
        const target = String(body.target || 'import')
        const promptText = target === 'archive' ? '选择 DeepSeek 导出包所在的文件夹' : '选择要导入到的文件夹'

        let path = null
        let backend = null
        let canceled = false
        let failure = null

        // 1) 首选：DSH 自己的原生选择器。
        //    注意 kind 可能拿不到（控制器不暴露 capability()），这时也要试 pick() ——
        //    早先"必须 kind==='native' 才调"会把本来可用的原生对话框整个跳过。
        const canTryNative = ctl && typeof ctl.pick === 'function' && kind !== 'browse'
        if (canTryNative) {
          try {
            const picked = await ctl.pick(AbortSignal.timeout(PICK_TIMEOUT_MS))
            path = normalizeDirPath(picked)
            if (path) backend = 'native'
            else canceled = true
          } catch (err) {
            failure = errMsg(err)
            ctx.logger?.warn?.('deepseek-archive: native pick failed', { error: failure, kind })
          }
        } else if (ctl && kind === 'browse') {
          failure = 'directory-picker/unavailable：当前组合只有应用内浏览（browse），没有系统对话框'
        } else if (!ctl) {
          failure = 'directoryPickerController 不可用'
        } else {
          failure = '当前环境没有系统文件夹选择器'
        }

        // 2) 兜底：macOS 上自己弹系统对话框（用户取消时不弹第二个）
        if (!path && !canceled && process.platform === 'darwin') {
          const alt = await pickFolderMac(promptText)
          if (alt.path) {
            path = alt.path
            backend = 'osascript'
            failure = null
          } else if (alt.canceled) {
            canceled = true
            failure = null
          } else if (alt.error) {
            failure = failure || alt.error
          }
        }

        // 顺手告诉面板：这个目录是不是已经登记过的工作区（决定显示「将新建」还是「已有」）
        let isWorkspace = false
        let workspaceId = null
        if (path) {
          try {
            const reg = ctx.get('workspaceRegistry')
            const hit = reg && typeof reg.resolveByPath === 'function' ? await reg.resolveByPath(path) : null
            if (hit) {
              isWorkspace = true
              workspaceId = String(hit.id)
            }
          } catch {
            /* 判定失败不影响选择本身 */
          }
        }

        return send(response, 200, {
          ok: true,
          path,
          canceled,
          backend,
          kind,
          isWorkspace,
          workspaceId,
          error: path ? null : failure,
        })
      }

      if (action === 'probeCreate') {
        const out = { steps: [] }
        const cwd = String(body.cwd || join(homedir(), 'Desktop', 'dsh-probe'))
        const reg = ctx.get('workspaceRegistry')
        const wc = ctx.get('workspaceController')
        const sc = ctx.get('sessionController')
        try {
          const existing = await reg.resolveByPath(cwd)
          const ws = existing
            ? { id: String(existing.id), created: false }
            : (() => null)()
          if (!existing) {
            const c = await wc.create({ path: cwd })
            ws.id = String(c.workspace.workspaceId)
            ws.created = c.created
          }
          out.workspace = ws
          out.steps.push('workspace ok')

          const id = String(body.sessionId || `session-${randomUUID()}`)
          const created = await sc.create({ workspaceId: ws.id, sessionId: id })
          out.created = created
          out.steps.push('create ok')

          const dir = join(dshHome(), 'sessions', escapeCwd(cwd), id)
          const files = await readdir(dir).catch(() => [])
          out.dir = dir
          out.files = files

          const value = await sc.list({}, AbortSignal.timeout(10000))
          const s = ((value && value.items) || []).find((x) => String(x.sessionId) === id)
          out.summary = s || null

          const page = await sc.events(
            { address: { kind: 'session', sessionId: id }, maxMessages: 50 },
            AbortSignal.timeout(10000),
          )
          out.records = page && page.records ? page.records.length : null

          const refetch = await reg.resolveByPath(cwd)
          out.workspaceSessionIds = refetch ? refetch.sessionIds : null
          out.accounted = refetch ? refetch.sessionIds.includes(id) : null
        } catch (err) {
          out.error = errMsg(err)
        }
        return send(response, 200, { ok: !out.error, ...out })
      }

      if (action === 'hide') {
        const wc = ctx.get('workspaceController')
        if (!wc) return send(response, 200, { ok: false, error: 'workspaceController 不可用' })
        const ids = Array.isArray(body.sessionIds) ? body.sessionIds : [String(body.sessionId || '')]
        const out = []
        for (const sessionId of ids) {
          if (!sessionId) continue
          try {
            const v = await wc.archiveSession({ sessionId })
            out.push({ sessionId, ok: true, archived: (v && v.archivedSessionIds && v.archivedSessionIds.length) || 0 })
          } catch (err) {
            out.push({ sessionId, ok: false, error: errMsg(err) })
          }
        }
        return send(response, 200, { ok: true, results: out })
      }

      if (action === 'attach') {
        const wc = ctx.get('workspaceController')
        if (!wc) return send(response, 200, { ok: false, error: 'workspaceController 不可用' })
        try {
          const value = await wc.insertSessionBefore({
            workspaceId: body.workspaceId,
            sessionId: body.sessionId,
          })
          const ids = (value && value.workspace && value.workspace.sessionIds) || []
          return send(response, 200, {
            ok: true,
            sessionIds: ids,
            contains: ids.includes(String(body.sessionId)),
          })
        } catch (err) {
          return send(response, 200, { ok: false, error: errMsg(err) })
        }
      }

      if (action === 'warm') {
        const id = String(body.sessionId || '')
        if (!id) return send(response, 200, { ok: false, error: '缺少 sessionId' })
        const sc = ctx.get('sessionController')
        const cachePath = join(dshHome(), 'storages', 'session_projcache', 'sessions', id + '.json')
        const hasCache = async () => {
          try {
            await stat(cachePath)
            return true
          } catch {
            return false
          }
        }
        const before = await hasCache()
        let resolved = null
        try {
          const r = await sc.resolveAgent(id)
          resolved = r && r.agent ? 'agent' : r && r.error ? r.error.code || String(r.error) : 'unknown'
        } catch (err) {
          resolved = 'err:' + errMsg(err)
        }
        let after = await hasCache()
        for (let i = 0; i < 12 && !after; i++) {
          await new Promise((res) => setTimeout(res, 250))
          after = await hasCache()
        }
        let summary = null
        try {
          const value = await sc.list({}, AbortSignal.timeout(10000))
          const s = ((value && value.items) || []).find((x) => String(x.sessionId) === id)
          summary = s
            ? {
                agentAvailable: s.agentAvailable,
                running: s.running,
                hasProjections: Boolean(s.projections),
                title: s.projections && s.projections.values && s.projections.values.title,
              }
            : null
        } catch {
          /* ignore */
        }
        return send(response, 200, { ok: true, resolved, cacheBefore: before, cacheAfter: after, cachePath, summary })
      }

      if (action === 'import') {
        const result = await importToSession(ctx, state, {
          session: body.sessionId,
          cwd: body.cwd,
          title: body.title,
          keepFailures: body.keepFailures === true,
        })
        return send(response, 200, { ok: result.ok === true, result })
      }

      return send(response, 400, { ok: false, error: '未知操作：' + action })
    } catch (err) {
      return send(response, 200, { ok: false, error: errMsg(err) })
    }
  }
}

/* ────────────────────── 工具定义 ────────────────────── */

const RESULT_SCHEMA = { type: 'object', additionalProperties: true }

function renderText(_args, value) {
  const v = value && typeof value === 'object' ? value : {}
  return [{ type: 'text', text: String(v.text ?? '') }]
}

const OUTPUT = { schema: RESULT_SCHEMA, render: renderText }

function buildListTool(state) {
  return {
    name: 'ds_archive_list',
    description:
      '列出或搜索用户从 DeepSeek 网页版导出的历史聊天记录（本地档案）。' +
      '当用户提到「以前聊过」「上次那个」「我之前问过」之类、需要找回旧对话时先用它定位，' +
      '再用 ds_archive_import 把命中的那一条导入并接续。' +
      '按最后活跃时间倒序返回；可用 query 按标题或会话 id 过滤。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '标题关键词或会话 id 片段；省略则列全部' },
        limit: { type: 'integer', description: '返回条数，默认 40，最多 200' },
        offset: { type: 'integer', description: '分页偏移，默认 0' },
        order: {
          type: 'string',
          enum: ['recent', 'oldest', 'largest'],
          description: '排序：recent=最后活跃倒序（默认）/ oldest=最早 / largest=体积最大',
        },
      },
      additionalProperties: false,
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const a = args && typeof args === 'object' ? args : {}
      const root = await activeArchiveRoot(state)
      const entries = await loadIndex(root)

      const q = String(a.query ?? '').trim().toLowerCase()
      let rows = q
        ? entries.filter(
            (e) =>
              String(e.title || '').toLowerCase().includes(q) ||
              String(e.id || '').toLowerCase().includes(q),
          )
        : entries.slice()

      const order = a.order === 'oldest' || a.order === 'largest' ? a.order : 'recent'
      rows.sort((x, y) => {
        if (order === 'largest') return (y.chars ?? y.bytes ?? 0) - (x.chars ?? x.bytes ?? 0)
        const dx = new Date(x.updated_at || 0).getTime()
        const dy = new Date(y.updated_at || 0).getTime()
        return order === 'oldest' ? dx - dy : dy - dx
      })

      const total = rows.length
      const offset = Math.max(0, Number(a.offset) || 0)
      const limit = Math.min(200, Math.max(1, Number(a.limit) || 40))
      const page = rows.slice(offset, offset + limit)

      const lines = [
        `DeepSeek 网页版历史对话档案（匹配 ${total} 条 / 档案共 ${entries.length} 条）`,
        `档案目录：${root}`,
        '用 ds_archive_import 传入 id 或标题即可导入并接续。',
        '',
      ]
      page.forEach((e, k) => {
        lines.push(
          `${String(offset + k + 1).padStart(3, '0')}. ${isoDay(e.updated_at)} | ${oneLine(e.title || '(无标题)', 40)} | ${e.message_count ?? '?'}条 | ${sizeLabel(e)} | id=${e.id}`,
        )
      })
      if (offset + page.length < total) {
        lines.push('', `……还有 ${total - offset - page.length} 条，用 offset=${offset + page.length} 继续。`)
      }

      return {
        text: lines.join('\n'),
        total,
        returned: page.length,
        archiveRoot: root,
        sessions: page.map((e) => ({
          id: e.id,
          title: e.title ?? null,
          updated_at: e.updated_at ?? null,
          message_count: e.message_count ?? null,
          chars: e.chars ?? null,
          bytes: e.bytes ?? null,
        })),
      }
    },
  }
}

function buildImportTool(state, ctx) {
  return {
    name: 'ds_archive_import',
    description:
      '把一条 DeepSeek 网页版历史对话导入 DSH。默认 mode=session：把它写成**侧边栏里一条独立会话**，' +
      '点开就是那段完整对话，可以直接接着聊（推荐）。mode=context 则把内容注入当前会话的上下文里。' +
      '传入会话 id（或 id 前缀 / 标题关键词）。',
    parameters: {
      type: 'object',
      properties: {
        session: { type: 'string', description: '会话 id、id 前缀，或标题关键词' },
        mode: {
          type: 'string',
          enum: ['session', 'context'],
          description:
            'session（默认）= 生成一条独立的 DSH 会话，出现在侧边栏；context = 注入当前会话上下文',
        },
        cwd: {
          type: 'string',
          description:
            'mode=session 时，这条会话归到哪个工作区（绝对路径）。省略则用配置里的 sessionCwd',
        },
        title: {
          type: 'string',
          description: 'mode=session 时的会话标题；省略则用 DeepSeek 原会话标题',
        },
        maxChars: {
          type: 'integer',
          description: 'mode=context 时本次注入的最大字符数，默认 36000',
        },
        includeThinking: {
          type: 'boolean',
          description: '是否连带当时的思考过程（默认 false）',
        },
        writeFile: {
          type: 'boolean',
          description: 'mode=context 时是否把完整原文落盘成 Markdown（默认 true）',
        },
        keepFailures: {
          type: 'boolean',
          description:
            '是否保留失败痕迹（如「服务器繁忙」占位与用户重复重发）。默认 false——会自动清理，' +
            '让接续落点落在最后一次真实对话上。要完全还原原始记录时设为 true',
        },
      },
      required: ['session'],
      additionalProperties: false,
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args) {
      const a = args && typeof args === 'object' ? args : {}

      // 默认路径：写成一条独立的 DSH 会话（与网页面板共用 importToSession）
      if (a.mode !== 'context') {
        const result = await importToSession(ctx, state, {
          session: a.session,
          cwd: a.cwd,
          title: a.title,
          keepFailures: a.keepFailures,
        })
        return {
          text: formatImportResult(result),
          matched: result.stage !== 'match',
          mode: 'session',
          ok: result.ok === true,
          sessionId: result.sessionId ?? null,
          cwd: result.cwd ?? null,
          verify: result.verify ?? null,
          candidates: result.candidates ?? null,
        }
      }

      const root = await activeArchiveRoot(state)
      const entries = await loadIndex(root)
      const picked = pickSession(entries, a.session)

      if (!picked.hit) {
        const cands = picked.candidates || []
        const body = cands.length
          ? cands
              .slice(0, 20)
              .map((e) => `- ${isoDay(e.updated_at)} | ${e.title} | id=${e.id}`)
              .join('\n')
          : '（没有匹配到的会话）'
        return {
          text: `没有唯一命中的会话，请用 ds_archive_list 先确认，或换更精确的 id。候选：\n${body}`,
          matched: false,
          candidates: cands.slice(0, 20).map((e) => ({ id: e.id, title: e.title })),
        }
      }

      const meta = picked.hit
      const session = await readSession(root, meta.id)
      const rawTurns = buildTurns(session)
      if (rawTurns.length === 0) {
        return { text: `会话「${session.title}」里没有可用的对话内容。`, matched: true, turns: 0 }
      }

      // 接续前清理失败重试的痕迹；原始记录始终完整保留在落盘文件里
      const clean = a.keepFailures === true
        ? { turns: rawTurns, stats: { droppedFailures: 0, mergedRepeats: 0 } }
        : cleanupTurns(rawTurns)
      const turns = clean.turns
      if (turns.length === 0) {
        return {
          text: `会话「${session.title}」里的消息全是失败占位（如「服务器繁忙」），没有可接续的真实内容。可用 keepFailures=true 查看原始记录。`,
          matched: true,
          turns: 0,
        }
      }


      /* ── 备选路径：注入当前会话上下文 ── */
      const includeThinking = a.includeThinking === true
      const budget = Math.min(
        200000,
        Math.max(4000, Number(a.maxChars) || (state.maxChars ?? DEFAULT_MAX_CHARS)),
      )
      const { text, truncated } = compose(session, turns, budget, includeThinking)

      let fullPath
      if (a.writeFile !== false && (truncated || turns.length > 12)) {
        try {
          const outDir = join(dirname(root), '.ds-archive-imports')
          await mkdir(outDir, { recursive: true })
          const safeName = `${isoDay(session.updated_at)}-${String(session.id).slice(0, 8)}`
          fullPath = join(outDir, `${safeName}.md`)
          const all = headerFor(session, {
            turnCount: rawTurns.length,
            totalChars: rawTurns.reduce((n, t) => n + t.body.length, 0),
          })
          // 落盘写的是未清理的原始记录（含失败痕迹），方便日后完全还原
          await writeFile(
            fullPath,
            all + rawTurns.map((t) => renderTurn(t, includeThinking)).join('\n\n---\n\n') + '\n',
            'utf8',
          )
        } catch (err) {
          fullPath = undefined
          state.lastWriteError = String(err && err.message ? err.message : err)
        }
      }

      const notes = []
      if (clean.stats.droppedFailures > 0) {
        notes.push(`已忽略 ${clean.stats.droppedFailures} 条失败占位回复`)
      }
      if (clean.stats.mergedRepeats > 0) {
        notes.push(`合并了 ${clean.stats.mergedRepeats} 处重复提问`)
      }
      if (truncated) notes.push('中间部分已折叠为提纲')
      if (fullPath) notes.push(`完整原文：${fullPath}（用 read 工具可分段精读）`)
      else if (state.lastWriteError) notes.push(`原文落盘失败：${state.lastWriteError}`)

      const tail = [
        '',
        '—'.repeat(28),
        `已导入 ${turns.length} 轮 / ${text.length} 字符${notes.length ? ' ｜ ' + notes.join(' ｜ ') : ''}`,
        '现在直接接着往下说即可。',
      ].join('\n')

      return {
        text: text + tail,
        matched: true,
        session: {
          id: session.id,
          title: session.title ?? null,
          inserted_at: session.inserted_at ?? null,
          updated_at: session.updated_at ?? null,
        },
        turns: turns.length,
        rawTurns: rawTurns.length,
        cleanup: clean.stats,
        chars: text.length,
        truncated,
        fullPath: fullPath ?? null,
      }
    },
  }
}

/* ────────────────────── 插件入口 ────────────────────── */

export function apply(ctx, config = {}) {
  const cfg = config && typeof config === 'object' ? config : {}
  const state = {
    archiveRoot: typeof cfg.archiveRoot === 'string' && cfg.archiveRoot ? cfg.archiveRoot : undefined,
    activeArchive: undefined,
    resolvedDir: undefined,
    sessionCwd: typeof cfg.sessionCwd === 'string' && cfg.sessionCwd ? cfg.sessionCwd : undefined,
    agentPreset: typeof cfg.agentPreset === 'string' && cfg.agentPreset ? cfg.agentPreset : undefined,
    maxChars: Number(cfg.maxChars) > 0 ? Number(cfg.maxChars) : DEFAULT_MAX_CHARS,
    lastWriteError: undefined,
    lastArchiveError: undefined,
  }

  ctx.effect(() => ctx.tools.register(buildListTool(state)), 'deepseek-archive: list')
  ctx.effect(() => ctx.tools.register(buildImportTool(state, ctx)), 'deepseek-archive: import')
  ctx.effect(() => ctx.tools.register(buildDiagTool(state, ctx)), 'deepseek-archive: diag')

  // 恢复上次选的导出包
  loadPersistedArchive().then((saved) => {
    if (saved && !state.activeArchive && !state.archiveRoot) {
      state.activeArchive = saved
      ctx.logger?.info?.('deepseek-archive: restored saved archive', { saved })
    }
  })

  // 网页面板用的同源接口。
  // 必须走 ctx.inject：apply 执行时 webServer 还没挂载，ctx.get('webServer') 是 undefined，
  // 路由会静默注册不上（请求落到 SPA 兜底，POST 得到 405 / GET 得到 HTML）。
  ctx.inject(['webServer'], (sub) => {
    sub.effect(
      () =>
        sub.webServer.register({
          kind: 'exact',
          path: API_ROUTE,
          handler: createApiHandler(ctx, state),
        }),
      'deepseek-archive: api route',
    )
    ctx.logger?.info?.('deepseek-archive: api route mounted', { path: API_ROUTE })
  })

  ctx.logger?.info?.('deepseek-archive ready', {
    archiveRoot: state.archiveRoot ?? '(auto)',
    sessionCwd: state.sessionCwd ?? '(默认=档案上一级)',
    dshHome: dshHome(),
  })
}
