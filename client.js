window.__ModuleLoader__.load({
  id: '@local/dsh-deepseek-archive',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const NS = 'deepseek-archive'
    const PANEL = 'deepseek-archive'
    const API = '/_deepseek-archive/api'
    let ctxRef = null

    const ZH = {
      title: 'DS 对话导入工具',
      heading: 'DS 对话导入工具',
      sub: '把导出里的历史对话导入成 DSH 的独立会话',
      archive: '档案',
      archiveLabel: '档案来源',
      archiveDefault: '（自动：默认导出的位置）',
      chooseFolderShort: '选文件夹…',
      switchBusy: '正在打开…',
      archivePathPh: '或粘贴导出包路径（.zip 或已解压目录）',
      openPath: '打开',
      dropTitle: '松手即可导入聊天记录',
      dropHint: '把 DeepSeek 导出的 .zip 或已解压的文件夹拖到这里',
      dropNoPath: '拿不到这个文件的路径，试试面板里的「选文件夹…」或粘贴路径',
      dropFailed: '接收拖入的文件失败',
      refresh: '刷新',
      search: '搜索标题或会话 id…',
      loading: '加载中…',
      total: '{n} 条会话',
      totalOf: '{n} / {all} 条',
      empty: '没有匹配的会话',
      pick: '点一下左侧任意一条就能选中，可多选',
      rowHint: '点击选中 / 取消选中',
      target: '导入到哪个工作文件夹',
      targetHint: '会话文件存在 ~/.dsh/sessions/ 里，不会写进这个文件夹；这里只决定它归属于哪个工作区',
      targetHintAt: '会话文件存在 {p} 里，不会写进这个文件夹；这里只决定它归属于哪个工作区',
      choose: '选择文件夹…',
      defaultTarget: '（默认：档案所在目录）',
      defaultTargetAt: '（默认：{p}）',
      customPath: '或直接填绝对路径',
      targetNow: '当前目标',
      willCreate: '（将自动新建工作区）',
      isWorkspaceTag: '（已有工作区）',
      pickedOption: '🆕 刚选择的位置',
      pickerUnavailable: '系统对话框不可用：{e}',
      fileLabel: '文件',
      fileHint: '会话日志的真实位置（工作区文件夹里不会有文件）',
      degradedHint: '自检降级：会话已写入，但这台机器的读回接口与插件预期不一致，未经读端确认。',
      doImport: '导入为独立会话',
      importing: '正在写入并自检…',
      result: '结果',
      okTitle: '已导入',
      failTitle: '导入失败',
      sessionId: '会话 id',
      messages: '消息',
      question: '提问',
      answer: '回答',
      cleaned: '已清理 {f} 条失败占位、{r} 处重复提问',
      refreshHint: '如果侧边栏没出现，刷新一下页面',
      newWorkspace: '（已新建工作区）',
      existWorkspace: '（已有工作区）',
      selectAll: '全选',
      selectedN: '已选 {n} 条',
      importN: '导入选中的 {n} 条',
      progress: '正在导入 {done}/{total}：{current}',
      batchSummary: '成功 {ok} 条 / 共 {total} 条',
      allFailed: '全部导入失败，详见下方结果',
      partFailed: '有 {f} 条导入失败，详见下方结果',
      moreFails: '……另有 {n} 条失败未列出',
      confirmMany: '将一次导入 {n} 条会话到同一个工作区，侧边栏会多出 {n} 条记录。继续吗？',
      errPick: '选择文件夹失败：{e}',
      errImport: '导入失败：{e}',
      loadingList: '正在读取档案…',
      chars: '{n} 字',
      msgs: '{n} 条',
    }

    const EN = {
      title: 'DS Chat Importer',
      heading: 'DS Chat Importer',
      sub: 'Import exported conversations as standalone DSH sessions',
      archive: 'Archive',
      archiveLabel: 'Archive source',
      archiveDefault: '(auto: default export location)',
      chooseFolderShort: 'Folder…',
      switchBusy: 'Opening…',
      archivePathPh: 'Or paste the export path (.zip or extracted folder)',
      openPath: 'Open',
      dropTitle: 'Drop to import chats',
      dropHint: 'Drop the exported DeepSeek .zip or an extracted folder here',
      dropNoPath: 'Could not read that file path; use “Folder…” or paste the path instead',
      dropFailed: 'Could not receive the dropped file',
      refresh: 'Refresh',
      search: 'Search title or session id…',
      loading: 'Loading…',
      total: '{n} sessions',
      totalOf: '{n} / {all}',
      empty: 'No matching session',
      pick: 'Click a session on the left to select it; multiple allowed',
      rowHint: 'Click to select / deselect',
      target: 'Target workspace folder',
      targetHint: 'Session files live under ~/.dsh/sessions/ — nothing is written into this folder; it only decides which workspace owns the session',
      targetHintAt: 'Session files live under {p} — nothing is written into this folder; it only decides which workspace owns the session',
      choose: 'Choose folder…',
      defaultTarget: '(default: archive folder)',
      defaultTargetAt: '(default: {p})',
      customPath: 'Or type an absolute path',
      targetNow: 'Target',
      willCreate: '(new workspace, created on import)',
      isWorkspaceTag: '(existing workspace)',
      pickedOption: '🆕 Just picked',
      pickerUnavailable: 'System dialog unavailable: {e}',
      fileLabel: 'File',
      fileHint: 'Real location of the session log (the workspace folder stays empty)',
      degradedHint: 'Self-check degraded: written, but this build\'s read-back API differs from what the plugin expects.',
      doImport: 'Import as a session',
      importing: 'Writing and verifying…',
      result: 'Result',
      okTitle: 'Imported',
      failTitle: 'Import failed',
      sessionId: 'Session id',
      messages: 'Messages',
      question: 'questions',
      answer: 'answers',
      cleaned: 'Dropped {f} failed placeholders and merged {r} repeated questions',
      refreshHint: 'If the sidebar does not show it, refresh the page',
      newWorkspace: '(new workspace created)',
      existWorkspace: '(existing workspace)',
      selectAll: 'Select all',
      selectedN: '{n} selected',
      importN: 'Import {n} selected',
      progress: 'Importing {done}/{total}: {current}',
      batchSummary: '{ok} of {total} imported',
      allFailed: 'All imports failed; see results below',
      partFailed: '{f} imports failed; see results below',
      moreFails: '…{n} more failures not listed',
      confirmMany: 'This imports {n} sessions into the same workspace, adding {n} rows to the sidebar. Continue?',
      errPick: 'Folder picking failed: {e}',
      errImport: 'Import failed: {e}',
      loadingList: 'Reading the archive…',
      chars: '{n} chars',
      msgs: '{n} msgs',
    }

    const CSS = [
      '.dsa-root{display:flex;flex-direction:column;height:100%;min-width:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;font-family:system-ui,-apple-system,sans-serif}',
      '.dsa-head{flex:none;padding:14px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsa-h1{font-size:15px;font-weight:600;margin:0 0 3px}',
      '.dsa-sub{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dsa-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dsa-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}',
      '.dsa-body{flex:1;min-height:0;display:flex;gap:0;position:relative}',
      '.dsa-dropmask{position:absolute;inset:8px;z-index:20;border-radius:12px;border:2px dashed var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-base));display:flex;align-items:center;justify-content:center;pointer-events:none}',
      '.dsa-dropbox{text-align:center;padding:24px}',
      '.dsa-droptitle{font-size:15px;font-weight:600;color:var(--dsw-alias-brand-primary);margin-bottom:6px}',
      '.dsa-col-l{flex:1.15;min-width:260px;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1)}',
      '.dsa-col-r{flex:1;min-width:280px;display:flex;flex-direction:column}',
      '.dsa-searchwrap{flex:none;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dsa-checkrow{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.dsa-check{width:14px;height:14px;margin:0;flex:none;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.dsa-count{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsa-srcwrap{flex:none;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.dsa-srcrow{display:flex;align-items:center;gap:8px}',
      '.dsa-srclabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsa-idx{flex:none;min-width:30px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:11px;padding-top:2px}',
      '.dsa-rowmain{display:flex;gap:8px;align-items:flex-start}',
      '.dsa-input{width:100%;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;outline:none;box-sizing:border-box;transition:border-color .15s}',
      '.dsa-input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dsa-list{flex:1;min-height:0;overflow:auto}',
      '.dsa-row{display:flex;flex-direction:column;gap:2px;padding:8px 14px;cursor:pointer;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 60%,transparent)}',
      '.dsa-row:hover{background:var(--dsw-alias-bg-layer-1)}',
      '.dsa-row[data-on=true]{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 2px 0 0 var(--dsw-alias-brand-primary)}',
      '.dsa-rowtitle{font-size:13px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsa-rowmeta{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dsa-right{padding:14px 16px;overflow:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:12px}',
      '.dsa-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:none}',
      '.dsa-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5}',
      '.dsa-btn{height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;cursor:pointer;white-space:nowrap;transition:all .15s}',
      '.dsa-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}',
      '.dsa-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.dsa-btn-main{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:600}',
      '.dsa-btn-main:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}',
      '.dsa-row2{display:flex;gap:8px;align-items:center}',
      '.dsa-target-now{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}',
      '.dsa-target-path{font-size:11px;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
      '.dsa-select{flex:1;min-width:0;height:30px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;outline:none}',
      '.dsa-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1)}',
      '.dsa-card-ok{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,var(--dsw-alias-border-l1))}',
      '.dsa-card-err{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,var(--dsw-alias-border-l1))}',
      '.dsa-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;margin-top:8px}',
      '.dsa-k{color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.dsa-empty{padding:28px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.dsa-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5}',
      '.dsa-ok{color:var(--dsw-alias-state-success-primary);font-weight:600;font-size:13px}',
      '.dsa-spin{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dsa-spin .8s linear infinite;display:inline-block;vertical-align:-2px;margin-right:6px}',
      '@keyframes dsa-spin{to{transform:rotate(360deg)}}',
    ].join('')

    function fmt(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m))
    }

    async function callApi(body) {
      const res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        throw new Error('接口返回非 JSON：' + text.slice(0, 140))
      }
      if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
      return data
    }

    function Icon(props) {
      const size = typeof props.size === 'number' ? props.size : 18
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('path', { d: 'M20 8.5A2.5 2.5 0 0 0 17.5 6H10L7.6 3.6A1.5 1.5 0 0 0 6.5 3H4A2 2 0 0 0 2 5v11a2 2 0 0 0 2 2h.5' }),
        h('path', { d: 'M4.2 9h15.3a1 1 0 0 1 1 1.2l-1.3 6A2 2 0 0 1 17.2 18H6.8a2 2 0 0 1-2-1.8L3.6 10.2A1 1 0 0 1 4.2 9z' }),
      )
    }

    function Page() {
      const t = useCallback((k, vars) => {
        let dict = ZH
        try {
          const loc = ctxRef && ctxRef.locale && ctxRef.locale.bind(NS)
          if (loc) {
            const f = loc()
            if (typeof f === 'function') return fmt(f(k), vars)
          }
        } catch {
          /* 用内置中文兜底 */
        }
        return fmt(dict[k] || k, vars)
      }, [])

      const [sessions, setSessions] = useState([])
      const [archiveRoot, setArchiveRoot] = useState('')
      const [archiveTotal, setArchiveTotal] = useState(0)
      const [query, setQuery] = useState('')
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [picked, setPicked] = useState({})
      const [focusId, setFocusId] = useState(null)
      const [workspaces, setWorkspaces] = useState([])
      const [cwd, setCwd] = useState('')
      const [customCwd, setCustomCwd] = useState('')
      const [cwdIsWs, setCwdIsWs] = useState(false)
      const [pickingTarget, setPickingTarget] = useState(false)
      const [defaultCwd, setDefaultCwd] = useState('')
      const [sessionsRoot, setSessionsRoot] = useState('')
      const [busy, setBusy] = useState(false)
      const [result, setResult] = useState(null)
      const [actionError, setActionError] = useState(null)
      const [progress, setProgress] = useState(null)

      const load = useCallback(
        async (q) => {
          setLoading(true)
          setError(null)
          try {
            const data = await callApi({ action: 'list', query: q || '' })
            setSessions(data.sessions || [])
            setArchiveRoot(data.archiveRoot || '')
            setArchiveTotal(data.archiveTotal || 0)
          } catch (err) {
            setError(String((err && err.message) || err))
          } finally {
            setLoading(false)
          }
        },
        [],
      )

      const [sources, setSources] = useState([])
      const [activeSource, setActiveSource] = useState('')
      const [archivePath, setArchivePath] = useState('')
      const [switching, setSwitching] = useState(false)
      const [dragOver, setDragOver] = useState(false)
      const dragDepth = useRef(0)

      /** 切换档案：压缩包或已解压的目录都可以 */
      const useArchive = useCallback(
        async (path) => {
          if (!path) return
          setSwitching(true)
          setError(null)
          setPicked({})
          setFocusId(null)
          setResult(null)
          try {
            const data = await callApi({ action: 'useArchive', path })
            if (!data.ok) {
              setError(data.error || '打不开这个导出包')
              return
            }
            setActiveSource(data.active || path)
            setSources(data.sources || [])
            await load('')
          } catch (err) {
            setError(String((err && err.message) || err))
          } finally {
            setSwitching(false)
          }
        },
        [load],
      )

      /** 从拖放事件里拿一个本地路径：优先 text/uri-list，其次 text/plain */
      const pathFromDrop = (dt) => {
        try {
          for (const type of ['text/uri-list', 'text/plain']) {
            const raw = dt.getData(type)
            if (!raw) continue
            const first = raw.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#'))
            if (!first) continue
            let p = first.trim()
            if (p.startsWith('file://')) {
              try {
                p = decodeURIComponent(new URL(p).pathname)
              } catch {
                p = p.replace(/^file:\/{2,3}/, '')
              }
              if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
              return p
            }
            return p
          }
        } catch {
          /* ignore */
        }
        return ''
      }

      const onDragOver = useCallback(
        (e) => {
          if (busy) return
          e.preventDefault()
          e.stopPropagation()
          try {
            e.dataTransfer.dropEffect = 'copy'
          } catch {
            /* ignore */
          }
          setDragOver(true)
        },
        [busy],
      )

      const onDragLeave = useCallback((e) => {
        e.preventDefault()
        // dragenter/dragleave 在子元素之间会反复触发，用计数判断真正离开
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }, [])

      const onDrop = useCallback(
        async (e) => {
          e.preventDefault()
          e.stopPropagation()
          dragDepth.current = 0
          setDragOver(false)
          const dataTransfer = e.dataTransfer
          if (!dataTransfer) return

          // 先试拖进来的文件本身：zip 直接用，目录取它的路径
          const files = dataTransfer.files ? Array.from(dataTransfer.files) : []
          let path = ''
          if (files.length > 0) {
            const f = files[0]
            if (f.path) {
              path = f.path
            } else if (dataTransfer.items && dataTransfer.items.length > 0) {
              // 浏览器不给真实路径时，退回到文件数据本身
              try {
                const buf = await f.arrayBuffer()
                const bytes = new Uint8Array(buf)
                let bin = ''
                const CHUNK = 0x8000
                for (let i = 0; i < bytes.length; i += CHUNK) {
                  bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
                }
                const data = await callApi({
                  action: 'uploadArchive',
                  name: f.name,
                  base64: btoa(bin),
                })
                if (data && data.ok) {
                  setArchivePath(data.path || '')
                  useArchive(data.path)
                } else {
                  setError((data && data.error) || t('dropFailed'))
                }
                return
              } catch (err) {
                setError(fmt(t('errImport'), { e: String((err && err.message) || err) }))
                return
              }
            }
          }
          if (!path) path = pathFromDrop(dataTransfer)
          if (!path) {
            setError(t('dropNoPath'))
            return
          }
          useArchive(path)
        },
        [useArchive, t],
      )

      const loadSources = useCallback(async () => {
        try {
          const data = await callApi({ action: 'sources' })
          if (data && data.ok) {
            setSources(data.sources || [])
            setActiveSource(data.active || '')
            return data
          }
        } catch {
          /* 档案列表拉不到不影响主流程 */
        }
        return null
      }, [])

      const loadWorkspaces = useCallback(async () => {
        try {
          const data = await callApi({ action: 'workspaces' })
          if (data && data.ok) {
            setWorkspaces(data.workspaces || [])
            if (data.defaultCwd) setDefaultCwd(data.defaultCwd)
            if (data.sessionsRoot) setSessionsRoot(data.sessionsRoot)
          }
        } catch {
          /* 工作区拉不到不影响导入 */
        }
      }, [])


      // 首次挂载：拉档案列表；如果只有一个候选且还没选过，直接自动选上（新装的机器零配置可用）
      useEffect(() => {
        let cancelled = false
        ;(async () => {
          const data = await loadSources()
          if (cancelled) return
          const list = (data && data.sources) || []
          if (data && !data.active && list.length === 1) {
            await useArchive(list[0].path)
          } else {
            load('')
          }
          loadWorkspaces()
        })()
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      /** 用系统对话框选一个目录当档案（解压后的包） */
      const pickArchiveFolder = useCallback(async () => {
        try {
          const data = await callApi({ action: 'pickFolder', target: 'archive' })
          if (data && data.path) useArchive(data.path)
          else if (data && data.canceled) return
          else if (data && data.error) setError(fmt(t('errPick'), { e: data.error }))
        } catch (err) {
          setError(fmt(t('errPick'), { e: String((err && err.message) || err) }))
        }
      }, [useArchive, t])

      const runSearch = useCallback(() => {
        load(query.trim())
      }, [load, query])

      /**
       * 选目标工作文件夹。
       *
       * 修的是这个 bug：选完之后把路径塞进 cwd，但下拉框的 option 只来自「现有工作区」，
       * 选出来的目录不在里面 → <select value> 匹配不到任何 option，浏览器立刻回落到第一项
       * 「（默认：档案所在目录）」，看起来就是"选了没生效"。
       * 现在服务端会回 isWorkspace，面板再把这个路径补成一个真实 option 并显式回显。
       */
      const pickFolder = useCallback(async () => {
        if (pickingTarget) return
        setActionError(null)
        setPickingTarget(true)
        try {
          const data = await callApi({ action: 'pickFolder', target: 'import' })
          if (data && data.path) {
            setCwd(data.path)
            setCustomCwd('')
            setCwdIsWs(data.isWorkspace === true)
            return
          }
          if (data && data.canceled) return
          if (data && data.error) {
            setActionError(fmt(t('pickerUnavailable'), { e: data.error }))
          }
        } catch (err) {
          setActionError(fmt(t('errPick'), { e: String((err && err.message) || err) }))
        } finally {
          setPickingTarget(false)
        }
      }, [t, pickingTarget])

      const pickedIds = Object.keys(picked)
      const allPicked = sessions.length > 0 && sessions.every((s) => picked[s.id])
      const somePicked = !allPicked && sessions.some((s) => picked[s.id])
      const selected = focusId ? sessions.find((s) => s.id === focusId) || null : null

      /** 点行 = 切换选中（灰色高亮） */
      const toggleRow = useCallback((id) => {
        setFocusId(id)
        setPicked((prev) => {
          const next = { ...prev }
          if (next[id]) delete next[id]
          else next[id] = true
          return next
        })
        setResult(null)
        setActionError(null)
      }, [])

      /** 全选 / 取消全选（只作用于当前列表） */
      const toggleAll = useCallback(() => {
        setPicked((prev) => {
          const everyPicked = sessions.length > 0 && sessions.every((s) => prev[s.id])
          if (everyPicked) {
            const next = { ...prev }
            for (const s of sessions) delete next[s.id]
            return next
          }
          const next = { ...prev }
          for (const s of sessions) next[s.id] = true
          return next
        })
      }, [sessions])

      /** 批量导入选中的；没选就没法导 */
      const doImport = useCallback(async () => {
        const targets = sessions.filter((s) => picked[s.id])
        if (targets.length === 0) return

        // 全选之后一键导入会一次建出很多会话，先确认一下
        if (targets.length > 10 && typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(t('confirmMany', { n: targets.length }))) return
        }

        setBusy(true)
        setActionError(null)
        setResult(null)
        setProgress({ done: 0, total: targets.length, current: targets[0].title })
        const items = []
        try {
          const target = customCwd.trim() || cwd || undefined
          for (let i = 0; i < targets.length; i++) {
            const s = targets[i]
            setProgress({ done: i, total: targets.length, current: s.title })
            try {
              const data = await callApi({ action: 'import', sessionId: s.id, cwd: target })
              const rr = (data && data.result) || {}
              items.push({
                ok: Boolean(data && data.ok),
                title: rr.title || s.title,
                sessionId: rr.sessionId || null,
                cwd: rr.cwd || null,
                file: rr.file || null,
                degraded: rr.degraded === true,
                workspace: rr.workspace || null,
                messages: rr.messages ?? null,
                questions: rr.questions ?? null,
                answers: rr.answers ?? null,
                cleanup: rr.cleanup || null,
                projections: rr.projections || null,
                accounted: rr.accounted ?? null,
                verify: rr.verify || null,
                error: rr.error || (data && data.error) || null,
              })
            } catch (err) {
              items.push({ ok: false, title: s.title, error: String((err && err.message) || err) })
            }
            setProgress({ done: i + 1, total: targets.length, current: s.title })
          }
          const okCount = items.filter((x) => x.ok).length
          setResult({ total: items.length, okCount, items })
          if (okCount === 0) setActionError(t('allFailed'))
          else if (okCount < items.length) setActionError(t('partFailed', { f: items.length - okCount }))
          load(query.trim())
        } catch (err) {
          setActionError(fmt(t('errImport'), { e: String((err && err.message) || err) }))
        } finally {
          setBusy(false)
          setProgress(null)
          loadWorkspaces()
        }
      }, [picked, sessions, customCwd, cwd, query, load, t, loadWorkspaces])

      const r = result

      return h(
        'div',
        { className: 'dsa-root' },
        h('style', null, CSS),
        h(
          'div',
          { className: 'dsa-head' },
          h('div', { className: 'dsa-h1' }, t('heading')),
          h('div', { className: 'dsa-sub' }, t('sub')),
          h(
            'div',
            { className: 'dsa-meta' },
            h('span', null, t('archive')),
            h('span', { className: 'dsa-mono' }, archiveRoot || '—'),
            h(
              'button',
              { className: 'dsa-btn', onClick: () => load(query.trim()), disabled: loading },
              t('refresh'),
            ),
            h('span', null, query.trim() ? t('totalOf', { n: sessions.length, all: archiveTotal }) : t('total', { n: archiveTotal })),
          ),
        ),
        h(
          'div',
          {
            className: 'dsa-body',
            // 拖进来一个导出包（.zip 或已解压的目录）就直接当档案载入，
            // 解压、扫描、列表都在 Host 侧完成，这里只负责接住拖放。
            onDragOver: onDragOver,
            onDragLeave: onDragLeave,
            onDrop: onDrop,
          },
          dragOver
            ? h(
                'div',
                { className: 'dsa-dropmask' },
                h('div', { className: 'dsa-dropbox' }, h('div', { className: 'dsa-droptitle' }, t('dropTitle')), h('div', { className: 'dsa-hint' }, t('dropHint'))),
              )
            : null,
          h(
            'div',
            { className: 'dsa-col-l' },
            h(
              'div',
              { className: 'dsa-srcwrap' },
              h(
                'div',
                { className: 'dsa-srcrow' },
                h('span', { className: 'dsa-srclabel' }, t('archiveLabel')),
                h(
                  'select',
                  {
                    className: 'dsa-select',
                    value: sources.some((s) => s.path === activeSource) ? activeSource : '',
                    disabled: switching,
                    onChange: (e) => {
                      if (e.target.value) useArchive(e.target.value)
                    },
                  },
                  h('option', { value: '' }, switching ? t('switchBusy') : t('archiveDefault')),
                  sources.map((s) =>
                    h(
                      'option',
                      { key: s.path, value: s.path },
                      (s.kind === 'zip' ? '📦 ' : '📁 ') +
                        s.label +
                        (s.bytes ? ' · ' + Math.round((s.bytes / 1048576) * 10) / 10 + 'MB' : ''),
                    ),
                  ),
                ),
                h(
                  'button',
                  { className: 'dsa-btn', disabled: switching, onClick: pickArchiveFolder },
                  t('chooseFolderShort'),
                ),
              ),
              h(
                'div',
                { className: 'dsa-srcrow', style: { marginTop: '8px' } },
                h('input', {
                  className: 'dsa-input',
                  placeholder: t('archivePathPh'),
                  value: archivePath,
                  disabled: switching,
                  onChange: (e) => setArchivePath(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' && archivePath.trim()) useArchive(archivePath.trim())
                  },
                }),
                h(
                  'button',
                  {
                    className: 'dsa-btn',
                    disabled: switching || !archivePath.trim(),
                    onClick: () => useArchive(archivePath.trim()),
                  },
                  t('openPath'),
                ),
              ),
            ),
            h(
              'div',
              { className: 'dsa-searchwrap' },
              h(
                'div',
                { className: 'dsa-checkrow' },
                h('input', {
                  type: 'checkbox',
                  className: 'dsa-check',
                  title: t('selectAll'),
                  checked: allPicked,
                  ref: (el) => {
                    if (el) el.indeterminate = somePicked
                  },
                  onChange: toggleAll,
                  disabled: busy || sessions.length === 0,
                }),
                h('span', { className: 'dsa-count' }, t('selectAll')),
                pickedIds.length
                  ? h(
                      'button',
                      {
                        className: 'dsa-btn',
                        style: { height: '22px', padding: '0 8px', fontSize: '11px', marginLeft: 'auto' },
                        onClick: () => setPicked({}),
                        disabled: busy,
                      },
                      t('selectedN', { n: pickedIds.length }) + '  ✕',
                    )
                  : null,
              ),
              h('input', {
                className: 'dsa-input',
                placeholder: t('search'),
                value: query,
                onChange: (e) => setQuery(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') runSearch()
                },
              }),
            ),
            h(
              'div',
              { className: 'dsa-list' },
              loading
                ? h('div', { className: 'dsa-empty' }, h('span', { className: 'dsa-spin' }), t('loadingList'))
                : error
                  ? h('div', { className: 'dsa-empty' }, h('div', { className: 'dsa-err' }, error))
                  : sessions.length === 0
                    ? h('div', { className: 'dsa-empty' }, t('empty'))
                    : sessions.map((s, i) =>
                        h(
                          'div',
                          {
                            key: s.id,
                            className: 'dsa-row',
                            'data-on': picked[s.id] ? 'true' : 'false',
                            title: t('rowHint'),
                            onClick: () => {
                              if (!busy) toggleRow(s.id)
                            },
                          },
                          h(
                            'div',
                            { className: 'dsa-rowmain' },
                            h('div', { className: 'dsa-idx' }, String(i + 1).padStart(2, '0')),
                            h(
                              'div',
                              { style: { minWidth: 0, flex: 1 } },
                              h('div', { className: 'dsa-rowtitle', title: s.title }, s.day + '  ' + s.title),
                              h(
                                'div',
                                { className: 'dsa-rowmeta' },
                                (s.messages != null ? t('msgs', { n: s.messages }) : '') +
                                  (s.chars != null ? ' · ' + t('chars', { n: s.chars }) : ''),
                              ),
                            ),
                          ),
                        ),
                      ),
            ),
          ),
          h(
            'div',
            { className: 'dsa-col-r' },
            h(
              'div',
              { className: 'dsa-right' },
              h(
                'div',
                { className: 'dsa-label' },
                pickedIds.length > 1
                  ? t('selectedN', { n: pickedIds.length })
                  : selected
                    ? selected.title
                    : t('pick'),
              ),
              selected && pickedIds.length <= 1 && selected.chars != null
                ? h('div', { className: 'dsa-hint' }, t('chars', { n: selected.chars }) + ' · ' + t('msgs', { n: selected.messages }))
                : null,

              h('div', { className: 'dsa-label', style: { marginTop: '6px' } }, t('target')),
              h(
                'div',
                { className: 'dsa-row2' },
                h(
                  'select',
                  {
                    className: 'dsa-select',
                    value: cwd,
                    onChange: (e) => {
                      setCwd(e.target.value)
                      setCustomCwd('')
                      setCwdIsWs(workspaces.some((w) => w.path === e.target.value))
                    },
                  },
                  h(
                    'option',
                    { value: '' },
                    defaultCwd ? t('defaultTargetAt', { p: defaultCwd }) : t('defaultTarget'),
                  ),
                  workspaces.map((w) =>
                    h('option', { key: w.path || w.id, value: w.path }, (w.title ? w.title + ' — ' : '') + w.path),
                  ),
                  // 选出来的目录通常还不是工作区 —— 必须补一个 option，
                  // 否则 <select value={cwd}> 匹配不到任何项，会静默回落到第一项。
                  cwd && !workspaces.some((w) => w.path === cwd)
                    ? h('option', { key: cwd, value: cwd }, t('pickedOption') + ' — ' + cwd)
                    : null,
                ),
                h(
                  'button',
                  { className: 'dsa-btn', onClick: pickFolder, disabled: pickingTarget },
                  pickingTarget ? t('switchBusy') : t('choose'),
                ),
              ),
              h('input', {
                className: 'dsa-input',
                placeholder: t('customPath'),
                value: customCwd,
                onChange: (e) => setCustomCwd(e.target.value),
              }),
              (function () {
                const effective = customCwd.trim() || cwd || ''
                if (!effective)
                  return h(
                    'div',
                    { className: 'dsa-hint' },
                    sessionsRoot ? t('targetHintAt', { p: sessionsRoot }) : t('targetHint'),
                  )
                const isWs =
                  workspaces.some((w) => w.path === effective) || (effective === cwd && cwdIsWs)
                return h(
                  'div',
                  { className: 'dsa-target-now' },
                  h('span', { className: 'dsa-hint' }, t('targetNow')),
                  h('span', { className: 'dsa-mono dsa-target-path', title: effective }, effective),
                  h('span', { className: 'dsa-hint' }, isWs ? t('isWorkspaceTag') : t('willCreate')),
                )
              })(),

              h(
                'button',
                {
                  className: 'dsa-btn dsa-btn-main',
                  disabled: pickedIds.length === 0 || busy,
                  onClick: doImport,
                  style: { marginTop: '2px' },
                },
                busy ? h('span', { className: 'dsa-spin' }) : null,
                busy
                  ? progress
                    ? t('progress', progress)
                    : t('importing')
                  : pickedIds.length > 1
                    ? t('importN', { n: pickedIds.length })
                    : t('doImport'),
              ),

              actionError ? h('div', { className: 'dsa-err' }, actionError) : null,

              r
                ? r.total > 1
                  ? h(
                      'div',
                      { className: 'dsa-card ' + (r.okCount > 0 ? 'dsa-card-ok' : 'dsa-card-err') },
                      h(
                        'div',
                        { className: r.okCount > 0 ? 'dsa-ok' : 'dsa-err' },
                        t('batchSummary', { ok: r.okCount, total: r.total }),
                      ),
                      h(
                        'div',
                        { style: { marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' } },
                        r.items.slice(0, 30).map((it, k) =>
                          h(
                            'div',
                            {
                              key: k,
                              style: {
                                fontSize: '12px',
                                display: 'flex',
                                gap: '6px',
                                minWidth: 0,
                                color: it.ok ? 'inherit' : 'var(--dsw-alias-state-error-primary)',
                              },
                            },
                            h('span', { style: { flex: 'none' } }, it.ok ? '✓' : '✗'),
                            h(
                              'span',
                              {
                                style: {
                                  minWidth: 0,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                },
                                title: it.ok ? it.title : it.title + ' — ' + (it.error || ''),
                              },
                              it.ok ? it.title : it.title + ' — ' + (it.error || '导入失败'),
                            ),
                          ),
                        ),
                        r.items.length > 30
                          ? h('div', { className: 'dsa-hint' }, t('moreFails', { n: r.items.length - 30 }))
                          : null,
                      ),
                      r.okCount > 0
                        ? h('div', { className: 'dsa-hint', style: { marginTop: '6px' } }, t('refreshHint'))
                        : null,
                    )
                  : (function () {
                      const it = r.items[0] || {}
                      return h(
                        'div',
                        { className: 'dsa-card ' + (it.ok ? 'dsa-card-ok' : 'dsa-card-err') },
                        h('div', { className: it.ok ? 'dsa-ok' : 'dsa-err' }, t(it.ok ? 'okTitle' : 'failTitle')),
                        it.ok
                          ? h(
                              'div',
                              { className: 'dsa-kv' },
                              h('div', { className: 'dsa-k' }, t('sessionId')),
                              h('div', { className: 'dsa-mono' }, it.sessionId || '—'),
                              h('div', { className: 'dsa-k' }, t('target')),
                              h(
                                'div',
                                { className: 'dsa-mono' },
                                (it.cwd || '—') +
                                  (it.workspace && it.workspace.created
                                    ? '  ' + t('newWorkspace')
                                    : '  ' + t('existWorkspace')),
                              ),
                              h('div', { className: 'dsa-k' }, t('fileLabel')),
                              h(
                                'div',
                                { className: 'dsa-mono', style: { wordBreak: 'break-all', fontSize: '11px' } },
                                it.file || '—',
                              ),
                              h('div', { className: 'dsa-hint', style: { gridColumn: '1 / -1' } }, t('fileHint')),
                              h('div', { className: 'dsa-k' }, t('messages')),
                              h(
                                'div',
                                null,
                                (it.messages ?? '?') +
                                  '  (' +
                                  (it.questions ?? '?') +
                                  ' ' +
                                  t('question') +
                                  ' / ' +
                                  (it.answers ?? '?') +
                                  ' ' +
                                  t('answer') +
                                  ')',
                              ),
                              it.cleanup && (it.cleanup.droppedFailures || it.cleanup.mergedRepeats)
                                ? h(
                                    'div',
                                    { className: 'dsa-k' },
                                    t('cleaned', { f: it.cleanup.droppedFailures, r: it.cleanup.mergedRepeats }),
                                  )
                                : null,
                              it.degraded
                                ? h('div', { className: 'dsa-hint', style: { gridColumn: '1 / -1' } }, t('degradedHint'))
                                : null,
                            )
                          : h('div', { className: 'dsa-hint' }, it.error || ''),
                        it.ok
                          ? h('div', { className: 'dsa-hint', style: { marginTop: '6px' } }, t('refreshHint'))
                          : null,
                      )
                    })()
                : null,
            ),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctxRef = ctx
        ;['en', 'zh', 'zh-CN'].forEach((loc) => {
          ctx.effect(() => {
            try {
              return ctx.locale.register(NS, loc, loc === 'en' ? EN : ZH)
            } catch {
              return () => {}
            }
          })
        })

        ctx.effect(() =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL,
                order: 16,
                label: () => {
                  try {
                    return ctx.locale.bind(NS)('title')
                  } catch {
                    return 'DS 对话导入工具'
                  }
                },
              },
              Icon,
            ),
          ),
        )

        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page)))
      },
    }
  },
})
