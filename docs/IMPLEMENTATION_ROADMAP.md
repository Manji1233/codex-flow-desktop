# ChatGPT Codex 客户端实施路线

## 1. 总体架构建议

采用“桌面壳 + 本地核心服务 + Web UI”的三层结构：

### 桌面壳
负责窗口、系统托盘、通知、开机启动、文件选择、密钥链、自动更新和深色模式。

### 本地核心服务
复用 Codex 的 Rust 能力，负责模型请求、工具调用、MCP、权限、会话、Token 统计、任务调度和 CLI。

### Web UI
将当前 H5 逐步组件化，负责页面展示、交互、状态管理和流式输出。

UI 与核心服务通过本地 IPC 或受限 localhost 通道通信。API Key 不进入普通前端存储。

## 2. 推荐模块

| 模块 | 责任 |
| --- | --- |
| app-shell | 窗口、托盘、通知、更新、启动生命周期 |
| credential-store | 系统密钥链、密钥读写、脱敏展示 |
| provider-registry | 厂商 URL、认证方式、模型发现、连接测试 |
| conversation-engine | 会话、流式响应、上下文、取消与重试 |
| usage-meter | 请求级 Token、费用估算、日/月/年聚合 |
| scheduler | 本地定时任务、补跑、失败重试、执行历史 |
| capability-manager | Skills、MCP、插件安装、权限和版本 |
| media-pipeline | 图片生成、H5 转图、视频插件任务 |
| cli | 与桌面端共享配置和本地核心服务 |

## 3. 核心数据模型

### Provider
- id
- name
- base_url
- auth_type
- credential_ref
- compatibility
- enabled
- last_checked_at

### Model
- provider_id
- model_id
- display_name
- capability: text / vision / image / audio / video / tools
- context_window
- input_price
- output_price
- enabled

### RequestUsage
- request_id
- conversation_id
- task_id
- provider_id
- model_id
- input_tokens
- output_tokens
- cached_tokens
- estimated_cost
- started_at
- finished_at
- status

### ScheduledTask
- id
- name
- prompt
- schedule_type
- schedule_expression
- timezone
- model_id
- capability_ids
- output_target
- retry_policy
- enabled
- next_run_at

### Capability
- id
- type: skill / mcp / plugin
- source
- version
- permissions
- configuration
- enabled
- update_available

## 4. 开发阶段

### 阶段 0：设计冻结
- 完成页面清单、流程、设计 Token 和组件状态。
- 将当前 H5 拆成可复用组件。
- 确定桌面壳与 Codex 核心服务的通信协议。

验收：七个主页面都具备正常、空、加载、错误状态设计。

### 阶段 1：可运行桌面壳
- 集成当前 UI。
- 完成窗口、托盘、通知和本地配置。
- 完成首次启动流程。
- 使用系统密钥链保存 API Key。

验收：安装后输入 API Key，可在重启应用后继续使用且前端无法读取明文密钥。

### 阶段 2：模型与对话
- OpenAI 兼容接口。
- 模型发现、连接测试、默认模型。
- 流式对话、取消、重试、会话历史。
- 展示工具调用过程。

验收：能完成真实模型请求，并正确处理无效密钥、超时和余额不足。

### 阶段 3：用量统计
- 请求级记录。
- Token 解析与费用估算。
- 今日、本月、今年与自定义日期统计。
- CSV/JSON 导出。

验收：每次请求完成后统计自动更新；重启应用后数据仍存在。

### 阶段 4：本地定时任务
- 每天精确到秒。
- 每小时执行 N 次。
- 每周与高级 Cron。
- 系统通知、失败重试、执行历史。
- 睡眠唤醒后的错过任务策略。

验收：应用运行时任务按时执行；异常退出后不会重复执行同一实例。

### 阶段 5：Skills 与 MCP
- 推荐列表与本地安装。
- 权限声明、配置表单和启停。
- 自定义 Skill/MCP 页面。
- 版本与更新状态。

验收：安装后能在对话中调用；敏感权限在首次调用时确认。

### 阶段 6：媒体与 CLI
- 图片生成 Skill。
- H5 渲染与截图降级流程。
- 视频插件任务队列。
- CLI 登录、运行任务、查看用量和管理定时任务。

验收：GUI 与 CLI 共享同一 Provider、Skill 和任务配置。

## 5. 第一轮组件拆分

- AppShell
- SidebarNavigation
- TopBar
- OnboardingWizard
- ProviderCard
- ModelPicker
- PromptComposer
- ConversationMessage
- ToolExecutionStep
- UsageSummaryCard
- UsageChart
- ScheduledTaskCard
- ScheduleEditor
- CapabilityCard
- PermissionDialog
- Toast
- EmptyState
- ErrorState

## 6. 关键风险

1. **密钥安全**：禁止 localStorage 保存 API Key。
2. **费用准确性**：厂商价格变化时需要可更新价格表，并标注“估算”。
3. **模型发现差异**：部分厂商不提供模型列表，需要内置目录与手动配置并存。
4. **任务可靠性**：必须处理时区、夏令时、睡眠、崩溃和重复执行。
5. **插件安全**：安装来源、权限、命令执行和文件访问必须可审计。
6. **媒体依赖**：视频处理依赖大型二进制时，应按需下载而不是强制打包。

## 7. 下一迭代建议

第一轮正式设计优先完成以下四个页面：

1. 首次启动与 API Key 连接。
2. 智能对话正常/执行/失败状态。
3. 模型中心连接与模型发现。
4. 定时任务创建与执行详情。

这四个页面共同决定产品是否真正做到“输入 API Key，打开就能用”。
