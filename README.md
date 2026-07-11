# ChatGPT Codex 桌面客户端

## 项目介绍

ChatGPT Codex 桌面客户端是一款基于 `openai/codex` 开源运行时开发的 Windows 多模型客户端。默认仍采用“填写 API Key 即用”的方式，同时可选登录 ChatGPT 账户并在两种模式间切换。项目同时提供图形桌面端和终端端，两端共享加密配置、当前模型与 Token 使用记录。

本项目是第三方客户端实现，不是 OpenAI 官方发行的 Codex App；界面与协议会持续跟进官方 ChatGPT Codex / Codex App。

当前版本重点打通“API Key → 模型发现 → 流式对话 → Token 统计”核心链路，并内置火山方舟、阿里云百炼、智谱 GLM、腾讯云 Coding Plan，也支持任意 OpenAI 兼容接口。

### 主要特点

- 简单配置：选择平台并输入 API Key 即可开始。
- 双认证模式：默认使用 API Key，也可选择 ChatGPT 账户；模型中心支持一键切换，退出账户不会删除已保存 API Key。
- 多平台模型：自动发现模型，并支持手动填写模型 ID。
- Codex Agent：桌面端内置官方 Codex 运行时，可执行终端、文件、Skills、MCP、插件和多步骤任务。
- 持久会话：通过 Codex app-server 恢复、分叉、重命名、归档、取消归档、永久删除和压缩官方 Codex 会话。
- 代码审查：可直接启动 Codex 对当前工作区暂存、未暂存和未跟踪改动的内联审查。
- 文件 Diff：实时接收本轮统一 Diff，显示改动文件数并支持一键复制补丁。
- 实时 Plan：同步展示 Codex 执行计划、当前步骤和完成进度。
- 模型能力：从 app-server 读取推理强度、Personality、服务层级、图片输入和原生工具能力，并按模型动态显示控件。
- 引擎诊断：显示本机 Codex、官方最新稳定版、app-server 协议和当前已接入能力；不会自动切换到 alpha 版本。
- 内置终端：通过官方 app-server PTY 启动 PowerShell，支持实时输入、输出、停止和清屏。
- 交互审批：命令执行、文件修改和额外权限请求会在桌面端弹窗确认，可按单次或当前会话授权。
- 补充提问：支持 Agent 的 `request_user_input`，可展示选项、密码输入和自定义回答。
- 图片附件：可选择多张本地图片随文本发送，并在发送前预览或移除。
- 多代理可视化：实时展示协作 Agent 的运行、完成和失败状态，并可选择按需或主动协作模式。
- 实时联网搜索：默认开启，用户提问后自动提炼搜索意图，通过 Bing RSS 优先检索实时来源，并为 AI 新闻等时效问题生成带当天日期的稳定查询；app-server、Codex exec 和普通 SSE 回退链路都会使用同一份带来源上下文回答，不再重复调用终端探测网络。
- Agent 网络权限：Codex app-server 和 exec 在工作区写入沙箱内允许直接联网，工作区外文件访问仍受限制并保留交互审批。
- 真实流式对话：不支持 Codex Responses 协议的接口会自动回退到普通 SSE 对话。
- 本地安全存储：API Key 使用 Electron `safeStorage` 加密。
- Token 统计：记录每次请求，并按今日、本月、今年和全部汇总。
- 本地定时任务：支持每天、每周、每小时多次执行，桌面端运行时按秒级计划自动调用真实 Codex Agent。
- 本地内容库：自动保存会话结果、定时任务结果、视频项目和用户收藏的提示词。
- 插件市场：读取 Codex 已配置市场中的插件，可一键安装和卸载；支持按名称、说明和市场搜索，插件清单提供官方图标时直接展示真实图标。
- 自定义 MCP：支持添加远程 URL 或本地 stdio MCP 服务。
- Codex 风格排版：支持标题、列表、表格、代码块、引用、链接和 Markdown 导出。
- 桌面与终端共享：两种使用方式读取同一份安全配置和用量账本。
- 视频工作室：选择本地素材后自动安装 Remotion 插件，并交给 Codex Agent、Remotion 或 FFmpeg 生成真实视频文件。

## 当前可用链路

完整 Codex 功能接入进度和后续批次见 `docs/CODEX功能差距路线图.md`。

1. Electron 桌面窗口、无窗口终端应用、官方 Codex Agent 运行时和持久 `app-server --stdio` 进程。
2. API Key 通过 Electron `safeStorage` 加密后写入本机用户数据目录。
3. 支持 OpenAI 兼容的 `GET /models` 自动发现模型。
4. 支持 `POST /chat/completions` SSE 流式对话。
5. 每次成功请求记录输入、输出和总 Token。
6. 用量支持今日、本月、今年和全部统计。
7. 支持预设 Coding Plan，也支持自定义 Base URL 和手动模型 ID。
8. 支持真实插件市场、Skills、MCP、自定义 MCP 和工作区选择。
9. 回答使用安全过滤后的 Markdown 富文本排版。
10. 支持 app-server 会话恢复、分叉、归档、执行中补充要求和中断当前轮次。
11. 支持命令/文件/权限审批、Agent 补充提问、图片附件和多代理协作状态可视化。
12. 定时任务、历史会话、提示词库、视频项目、用量筛选和 CSV 导出均使用真实本地数据。
13. API Key 为默认认证模式；可选 ChatGPT 登录会显示套餐、短周期与长周期额度、账户 Token 摘要。

当前内置并锁定官方稳定运行时 `@openai/codex 0.144.1`。客户端会在“模型中心 → 引擎诊断”中联网检查最新 stable 版本。

## Coding Plan 预设

- 火山方舟：`https://ark.cn-beijing.volces.com/api/coding/v3`
- 阿里云百炼：`https://coding.dashscope.aliyuncs.com/v1`
- 智谱 GLM：`https://open.bigmodel.cn/api/coding/paas/v4`
- 腾讯云：`https://api.lkeap.cloud.tencent.com/coding/v3`

模型列表由内置兼容列表与平台实时发现结果合并，可直接使用 `GLM-5.2`、`Doubao-Seed-2.0-Code` 等 Coding Plan 模型。

## 桌面端

```powershell
npm.cmd install
npm.cmd start
```

如果 Electron 下载失败：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules\electron\install.js
```

## 终端端

在项目目录直接运行：

```powershell
npm.cmd run cli -- help
npm.cmd run cli -- status
npm.cmd run cli -- chat "你好，请介绍一下你自己"
```

注册为全局命令：

```powershell
npm.cmd link
codex-flow.cmd help
```

PowerShell 如果禁止执行 npm 生成的 `.ps1` 文件，请使用 `codex-flow.cmd`；在 CMD、Windows Terminal 或已允许脚本的 PowerShell 中可直接使用 `codex-flow`。

常用命令：

```text
codex-flow login
codex-flow status
codex-flow models
codex-flow model glm-5.2
codex-flow chat
codex-flow chat "分析当前目录的项目结构"
codex-flow usage day
codex-flow usage month
codex-flow usage year
codex-flow usage all
codex-flow schedule list
codex-flow schedule create --name "每日 AI 资讯" --prompt "联网搜索并总结今天的 AI 资讯" --type daily --time 08:00:00
codex-flow schedule toggle <任务ID>
codex-flow schedule remove <任务ID>
codex-flow logout
```

### 配置自定义接口

交互配置：

```powershell
codex-flow login
```

直接指定自定义 OpenAI 兼容接口；当服务不支持 `/models` 时可同时手动指定模型：

```powershell
codex-flow login --base-url https://example.com/v1 --model custom-model
```

直接选择 Coding Plan：

```powershell
codex-flow login --plan volcengine-coding-plan
codex-flow login --plan aliyun-coding-plan
codex-flow login --plan zhipu-coding-plan
codex-flow login --plan tencent-coding-plan
```

执行 `codex-flow chat` 后进入持续对话，可使用：

- `/model <ID>`：切换模型。
- `/usage`：查看本月 Token 用量。
- `/clear`：清空当前会话上下文。
- `/exit`：退出终端对话。

## 配置与数据共享

桌面端和终端端统一使用：

- `%APPDATA%\codex-flow-desktop\codex-flow-config.json`
- `%APPDATA%\codex-flow-desktop\codex-flow-usage.json`
- `%APPDATA%\codex-flow-desktop\codex-flow-tasks.json`
- `%APPDATA%\codex-flow-desktop\codex-flow-content.json`

API Key 只保存为系统加密后的密文。`logout` 会清除服务商和 API Key 配置，但保留历史 Token 用量、任务、提示词和会话结果。

定时任务由本机客户端调度，客户端运行时自动执行。

开启联网搜索时，用户的问题会发送到搜索服务以获取公开网页结果；搜索结果会作为不受信任的外部资料注入 Agent，客户端会明确要求模型忽略网页中的指令。

## 验证

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run cli -- status
npm.cmd run cli -- usage month
```

## 主要目录

- `electron/main.cjs`：桌面窗口生命周期与 IPC。
- `electron/cli-main.cjs`：终端命令、交互对话与共享数据入口。
- `bin/codex-flow.cjs`：全局 CLI 启动器。
- `electron/services/config-store.cjs`：加密凭据配置。
- `electron/services/openai-client.cjs`：模型发现与流式对话。
- `electron/services/app-server-service.cjs`：Codex app-server 生命周期、JSONL 协议和交互请求转发。
- `electron/services/usage-store.cjs`：Token 请求账本。
- `index.html` / `styles.css` / `app.js`：桌面 UI。
- `test/`：核心链路测试。
- `问题日志.md`：持续问题和解决方案记录。


## 隐私说明

- 仓库不包含任何真实 API Key、用户配置、Token 用量账本或本地问题日志。
- 请勿将 `%APPDATA%\codex-flow-desktop` 目录中的文件提交到版本库。
- 命令行传入 `--api-key` 可能进入终端历史记录，建议使用交互式 `codex-flow login`。
