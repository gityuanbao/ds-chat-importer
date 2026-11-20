# DS 对话导入工具：安装与配置

[返回 README](README.md)

## 运行环境

- DeepSeek Harness（DSH），需要插件管理能力和 Web 客户端界面。插件面板不适用于纯终端界面。
- 独立会话导入需要宿主的工作区和会话服务。当前没有声明或验证完整的 DSH 版本兼容范围。
- Host 的 Node.js 必须提供 `node:zlib` 的 `zstdCompressSync`。该 API 从 Node.js 22.15.0 和 23.8.0 加入，后续主版本也提供；具体以宿主实际使用的运行时为准。[Node.js 官方文档](https://nodejs.org/api/zlib.html#zlibzstdcompresssyncbuffer-options)
- 本地安装只需插件文件；从源码打包额外需要 Node.js 和 npm，无需先安装项目依赖。

## 从文件夹安装

1. 在 [仓库首页](https://github.com/gityuanbao/ds-chat-importer) 点击 **Code → Download ZIP** 并解压，或用 Git 克隆：

   ```bash
   git clone https://github.com/gityuanbao/ds-chat-importer.git
   ```

2. 确认安装目录中直接包含 `package.json`、`index.js`、`client.js` 和 `cordis.patch.yml`。不要选择这些文件外面的另一层目录。
3. 打开 DSH 的 **插件 → 添加插件 → 安装第三方插件**，在包名或地址输入框中填写安装目录的绝对路径。
4. 根据界面提示完成安装并启用，然后完全退出、重开 DSH。侧边栏入口名为 **DS 对话导入工具**。

具体菜单以使用的 DSH 版本为准，可参考 [官方插件管理文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md#安装一个组合包)。也可以在 DSH 对话中让 Agent 使用插件管理工具，安装你明确提供的本地目录。

路径示例（请替换成实际解压的位置）：

```text
C:\DS-Tools\ds-chat-importer-master
/Users/你的用户名/DS-Tools/ds-chat-importer-master
/home/你的用户名/DS-Tools/ds-chat-importer-master
```

请填写完整绝对路径，避免使用 `~/` 或相对路径。保留安装源目录，不要在安装后移动或删除它。

## 从源码生成安装包

在包含 `package.json` 的项目目录中执行：

```bash
npm pack --dry-run --ignore-scripts
npm pack --ignore-scripts
```

第一条命令预览打包文件，第二条命令生成 `local-dsh-deepseek-archive-0.2.0.tgz`。可以在 DSH 的第三方插件安装入口填写该文件的绝对路径，按界面提示安装并启用。

| 文件 | 用途 |
| --- | --- |
| GitHub 下载的 `ds-chat-importer-master.zip` | 插件源码，先解压，再从目录安装 |
| `npm pack` 生成的 `.tgz` | 插件安装包，在 DSH 插件管理中安装 |
| DeepSeek 导出的聊天 ZIP | 聊天数据，在本插件的“档案来源”中打开 |

`package.json` 中的 `private: true` 用来避免意外发布到 npm，不影响公开 GitHub 仓库或本地打包安装。

## 可选配置

通常直接在面板里选择档案和目标工作区即可，不必改配置。需要固定默认值时，可以在本地安装源的 `cordis.patch.yml` 中设置：

```yaml
- insert:
    - id: deepseek-archive
      name: '@local/dsh-deepseek-archive'
      config:
        archiveRoot: 'C:/DS-Data/deepseek-export'
        sessionCwd: 'C:/DS-Workspaces/历史对话'
        maxChars: 36000
```

将示例路径换成真实路径；macOS 和 Linux 使用 `/Users/...` 或 `/home/...` 等绝对路径。保存后重新加载插件或重启 DSH；若安装方式复制了文件，需要重新安装才能让更改生效。

| 配置项 | 含义 |
| --- | --- |
| `archiveRoot` | 已解压的档案目录，直接包含 `chat_sessions/`，也支持它的上一级目录；此配置不直接接受 ZIP，ZIP 请在面板中选择 |
| `sessionCwd` | 默认目标工作区。未配置时使用 `~/Documents/DeepSeek 导入` |
| `maxChars` | 上下文模式的默认正文字符预算，默认 36000；调用时限制在 4000～200000 |
| `agentPreset` | 宿主默认预设无法解析时的备用预设 ID；通常不需要配置 |

面板当前选中的档案优先于 `archiveRoot`。插件会记住选择；重启时仅在没有配置 `archiveRoot` 的情况下恢复上次选择。

## Agent 工具参数

`ds_archive_import` 的参数如下：

| 参数 | 作用与默认行为 |
| --- | --- |
| `session` | 必填。会话 ID、ID 前缀或能唯一匹配的标题关键词 |
| `mode` | `session`（默认）：独立会话；`context`：放入当前上下文 |
| `cwd` | 独立会话所属工作区的绝对路径 |
| `title` | 自定义独立会话标题，默认使用原标题 |
| `keepFailures` | 默认 `false`；设为 `true` 可保留模板失败回复和重复提问 |
| `maxChars` | 仅上下文模式：正文字符预算默认 36000，取值会限制在 4000～200000 |
| `includeThinking` | 仅上下文模式：默认 `false`；启用后附带经过裁剪的思考片段 |
| `writeFile` | 仅上下文模式：默认 `true`；内容发生压缩或清理后的消息数大于 12 时，尝试保存 Markdown |

上下文模式遇到长对话时，按“开头内容 + 中间提纲 + 尾部正文”组织内容。满足落盘条件时，插件会尝试在解析后的档案目录上一级创建 `.ds-archive-imports/`，并返回 `fullPath`。这个文件是经过格式转换的文本记录，不能替代原始导出包。

## 数据目录

这里的 `~/.dsh` 指 DSH 的默认数据目录。如果设置了 `DSH_HOME`，下列路径从该目录开始。

| 路径 | 内容 |
| --- | --- |
| `~/.dsh/sessions/` | 导入后由 DSH 管理的会话日志 |
| `~/.dsh/cache/deepseek-archive/` | ZIP 解压缓存，以及记录上次档案路径的 `state.json` |
| `~/.dsh/cache/deepseek-archive/uploads/` | 浏览器无法获取本地路径时传给 Host 的 ZIP 副本 |
| 档案解析目录上一级的 `.ds-archive-imports/` | 上下文模式满足条件时写出的 Markdown 文本 |

原始导出包不会被覆盖。选择远程 DSH Host 时，路径和数据目录均以运行 Host 的机器为准。

## 更新与卸载

更新前保留原始导出包和现有 DSH 数据备份。用新代码更新本地源目录后重新加载；如果插件管理器使用的是复制安装，可按其提示卸载后重新安装。[官方插件管理文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-plugin-manager/README.zh.md)

卸载入口在 DSH 插件管理页面，显示名为 **DS 对话导入工具**，内部包名为 `@local/dsh-deepseek-archive`。插件没有卸载时删除已导入会话的逻辑；缓存和原始导出包也需要单独管理。

## 验证安装

先选择一条短对话，导入到专用工作区，确认侧边栏可见、消息顺序正确，再发送一条消息验证接续。随后再尝试批量导入。出现“自检降级”时，先检查是否已生成会话，避免重复导入。

源码语法检查可以单独运行：

```bash
node --check index.js
node --check client.js
```

这些命令只检查 JavaScript 语法，不会连接 DSH 或导入真实聊天记录。
