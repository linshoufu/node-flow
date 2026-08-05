# Node Flow

Node Flow 是一个面向开发者的通用工作流节点编辑器。前端使用 React Flow，后端使用 FastAPI；`nodes/` 目录里的 Python 类通过 `@node(...)` 装饰器注册后，会自动变成可拖拽、可配置、可执行的工作流节点。

当前先以内置测试自动化节点作为第一批能力，重点覆盖接口测试、数据驱动测试、断言、循环和运行结果检查；节点契约、端口校验、执行策略和运行事件均按可扩展的通用工作流平台设计。

最新的阶段验收结果、已知风险和 Agent 接手顺序见 [2026-08-05 阶段性验收与接手说明](docs/acceptance/2026-08-05-stage-acceptance-handoff.md)。

## 开发启动

安装前端依赖：

```powershell
pnpm install
```

安装后端依赖：

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[test]"
```

启动后端：

```powershell
pnpm dev:api
```

启动前端：

```powershell
pnpm dev:web
```

打开 `http://127.0.0.1:5273`。

本地开发默认使用 API `http://127.0.0.1:8150`、前端 `http://127.0.0.1:5273`；后端 CORS 默认只放行 `5273` 和备用前端端口 `5274`，避免旧端口或其它本地项目误连。需要使用自定义前端地址时，启动 API 前设置 `NODE_FLOW_EXTRA_CORS_ORIGINS`（逗号分隔），例如 `http://127.0.0.1:5275`。

## 基本使用

1. 在左侧节点库中拖拽节点到画布，也可以点击节点按钮快速添加。
2. 在画布中连接节点端口，例如把 `手动触发.success` 连接到后续节点输入。
3. 点击节点后，在右侧配置面板填写参数。
   - “节点名称”是工作流自己的显示标题，会显示在画布和运行日志中；它不修改 Python 节点类型或节点配置。
   - “节点备注”用于记录流程背景、约束或交接信息，会随工作流版本保存并显示在画布上，不参与执行。
   - 在“执行状态”中启用“禁用节点”，可临时跳过该节点而保留原有连线；运行时会将输入透传到主输出端口，适合局部排查和逐段调试。禁用 `Webhook 触发` 或 `定时触发` 时，该触发器不会再接收外部请求或创建定时运行。
   - 顶部的撤销/重做可回退或恢复画布、节点配置、备注和工作流设置；快捷键为 `Ctrl/Cmd + Z`、`Ctrl/Cmd + Y` 或 `Ctrl/Cmd + Shift + Z`。在文本输入框内会保留浏览器原生撤销行为。
   - 选中画布节点后可点击画布工具栏的复制图标，或使用 `Ctrl/Cmd + D` 创建副本。按住 `Ctrl`、`Shift` 或 `Cmd` 可多选节点；复制多选节点时会保留选中范围内的连线。副本会偏移显示，并为循环体内的节点、连线和说明重新生成 ID；原节点和跨出选区的连线不会被改动。
4. 点击“验证”检查节点类型、端口、配置和表达式语法。
5. 点击“运行”保存并执行工作流；也可以选中根画布中的任意节点，在右侧点击“从此节点开始运行”来调试该节点及其下游。
   - 点击运行按钮旁的运行选项图标，可为本次运行输入任意 JSON。该输入只作用于本次运行，由 `手动触发` 节点作为初始数据输出，不会修改工作流或节点的已保存默认输入。
6. 局部运行会复用目标节点直接上游的“固定调试输出”，不会重跑这些上游节点。若必填输入没有对应固定输出，编辑器会拒绝启动并提示改用完整运行，或先为上游节点准备 Mock 数据。
7. 运行中可以点击“取消”。取消是协作式的：不会强杀正在执行的 Python 节点，但当前节点返回后会停止后续节点和循环迭代。
8. 在底部运行日志查看事件；点击节点事件后，右侧“运行详情”会显示状态、耗时、输入、输出、日志、错误和循环范围。

在节点右侧配置面板的“固定调试输出”区域，可以把该节点最近一次成功运行的输出固定下来，也可以在未运行过节点时手工编写 JSON Mock 数据。保存前界面会检查 JSON 格式、顶层对象和输出端口；后续手动运行会直接复用这份输出而不执行该节点，适合调试下游逻辑、避免重复调用外部接口。固定数据会随工作流版本保存，并在画布上标记为“固定输出”；Webhook 和被调用工作流会始终忽略固定数据，避免调试结果进入生产触发链路。

新建、复制、导入和从模板创建的工作流默认是未发布草稿，避免在配置尚未确认时暴露外部触发器。点击“保存”只会创建新的草稿版本，不会改变生产 Webhook 或定时任务；顶部会显示生产版本、草稿版本和是否存在未发布修改。确认后点击“发布工作流”，外部触发器才会切换到当前草稿。已发布且没有未发布修改时，按钮会显示“停用工作流”；停用后 Webhook 返回 404，定时触发不会创建新运行，手动运行和“执行工作流”节点调用仍然可用。

编辑器默认自动保存草稿：停止编辑约 2 秒后执行保存，持续编辑时最长等待约 10 秒。保存请求期间仍可继续修改节点、连线和配置；请求返回后只更新服务器版本元数据，新产生的修改会保留并进入下一轮保存。普通网络错误会指数退避重试，工作流设置中可以关闭自动保存，`Ctrl+S` 和顶部“保存”仍可随时手动保存。

保存、发布、恢复、生产回滚和节点升级都会携带当前工作流版本。服务器版本发生变化时，操作会停止并显示中文冲突弹层，不会静默覆盖。可以重新加载服务器最新版本；保存冲突还可以把当前画布另存为新的未发布副本。选择“稍后处理”后，顶部“保存冲突”状态可再次打开恢复弹层，自动保存会保持暂停直到冲突被处理。

已保存工作流使用稳定编辑地址 `/workflow/<工作流 ID>`；选中根画布节点时，地址还会包含节点 ID。刷新页面或直接打开这个地址会恢复对应工作流和节点，首次保存、新建、复制、导入及模板创建也会同步更新地址。当前运行和历史运行使用 `/workflow/<工作流 ID>/executions/<运行 ID>`，选中的运行节点同样会写入地址；直接打开时会加载这次运行实际使用的工作流版本、事件和节点详情。浏览器返回或前进同样遵守未保存修改保护；如果拒绝丢弃修改，编辑器会同时恢复原画布和原地址。快速连续导航时，较慢的旧请求不会覆盖最后选择的工作流，运行 ID 与工作流不匹配时也会停止打开，避免展示错误日志。

工作台提供两级渲染故障恢复。节点库、画布、节点配置或运行结果单独渲染失败时，只替换对应区域并提供“重试此区域”和“重新加载”，其余区域仍可使用；切换工作流、节点或运行数据后会自动重试。根级异常也不会留下白屏，而会显示中文恢复页，可重试、重新加载或打开空白工作流。技术错误默认折叠在“错误摘要”中，方便开发者排查。

前端工作台按职责逐步拆分为文档、目录、节点库、保存、发布、路由、运行和画布操作控制器，方向参考 [n8n 编辑器的 composables 与 stores 分层](https://github.com/n8n-io/n8n/tree/master/packages/frontend/editor-ui/src/app)。`useCanvasOperations` 统一管理节点添加、复制粘贴、配置变更、连线删除与修复，并在工作流、修订或子流程发生变化时丢弃迟到的异步剪贴板结果。画布更新始终保留当前层级的说明批注，嵌套子流程更新也不会清除父级批注；这些数据不变量由独立 hook 和纯函数测试覆盖。

`useNodeCatalogController` 负责节点类型和本地节点包的首次加载、刷新、安装、启停、版本锁定、卸载与历史恢复。手动刷新会使较慢的首次加载响应失效，包操作在 React 忙碌状态渲染前就通过同步操作租约互斥，刷新诊断失败时保留最后一次有效节点包快照；工作流页面只消费控制器状态，不再直接协调这些请求。

`useWebhookTestListenerController` 负责调试 Webhook 的启动、停止、轮询、一次性消费和 TTL 到期。控制器将监听和请求绑定到当前工作流及节点，使用同步操作租约阻止快速重复点击，并丢弃切换工作流、手动停止或监听到期后返回的旧响应。这个边界参考 n8n 的 [webhooks store](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/app/stores/webhooks.store.ts) 和 [testWebhookReceived](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/app/composables/usePushConnection/handlers/testWebhookReceived.ts)：视图只消费当前工作流的监听状态，外部事件在修改执行状态前必须核对工作流身份。

`useRunInspectorController` 负责历史运行记录、事件、实际执行版本和运行对比。打开多个运行时只有最后一次请求可以更新界面，运行记录与地址中的工作流不匹配时会在读取事件前停止；即使当前工作流在事件加载期间产生了新版本，历史视图也会补取该次运行真正使用的不可变版本。加载历史运行期间编辑和自动保存会暂停，避免运行视图与正在变化的草稿混合。

`useWorkflowSettingsController` 统一管理工作流名称、描述、标签、超时、并发、环境、错误工作流和变量。设置更新会保留已有及后续扩展字段，变量重命名也不会覆盖已存在的同名变量。

`useWorkflowVersionActions` 统一协调版本历史和触发器面板、版本对比、恢复与生产回滚。成功写入后会同步编辑文档、工作流目录和版本列表；忙碌、迟到响应、普通错误与版本冲突使用同一处理顺序。若发布状态刷新期间用户切换了工作流，旧工作流的迟到提示和版本刷新不会污染新页面，但服务端已经完成的版本变更仍会写入目录摘要。

`useWorkflowReleaseActions` 统一协调发布、停用、节点升级预览和升级应用，并在等待发布状态刷新期间隔离已经切换走的页面。顶部发布与升级按钮由纯展示模型生成标签、禁用状态和原因提示，能够明确区分“尚未保存”“存在未保存修改”“工作流正在处理”和“正在应用升级”。

`useWorkflowPersistenceActions` 负责保存动作的产品语义编排：保存前设置校验、首次保存后的持久路由、目录同步、版本冲突分类，以及保存请求期间继续编辑时保留新修改。文档版本和撤销历史仍由 `useWorkflowDocumentController` 管理，请求互斥与迟到结果隔离仍由 `useWorkflowMutationController` 管理，页面视图不再自行拼接这三层状态。这个分层与 n8n 的 `WorkflowLayout`、工作流状态 composable 和初始化/持久化动作相互独立的方向一致。

`useWorkflowValidationController` 统一管理后端验证请求和可导航的问题项。验证请求绑定工作流 ID 与本地修订，快速重复点击只会发出一次请求；节点、连线或设置产生新修订后会立即清除旧验证结果，旧请求稍后返回也不会重新污染问题中心或覆盖当前消息。

版本冲突由 `useWorkflowConflictController` 和 `useWorkflowConflictRecoveryActions` 分层处理：前者统一识别服务端冲突并维护可稍后恢复的弹窗状态，后者负责重新加载服务器版本或把当前画布另存为副本。恢复请求绑定发起时的工作流，切换文档后返回的旧响应会被丢弃，不会覆盖新画布、清除新页面问题或产生迟到提示；成功恢复后才会统一重置编辑选择、校验问题和自动保存状态。

`useWorkflowNavigationActions` 统一处理新建、模板应用、工作流加载、删除和 URL 深链接受规则。它在离开脏草稿前统一确认，使用请求序列丢弃迟到的加载结果，并把“加载文档”的工作台副作用收束到单一适配器；浏览器 history 仍由 `useWorkflowRouteController` 独立管理。删除和加载失败都会恢复页面状态并给出中文错误，不再把异步异常留给按钮调用方。

`useWorkflowTransferActions` 统一处理复制、JSON 导入和版本化导出。复制与文件读取都使用当前文档作用域和同步操作租约，切换画布后返回的旧数据不会打开成新草稿；下载失败会清理临时 DOM 和对象 URL，并转成中文状态消息。导入成功只通过工作台的“打开草稿”适配器替换文档、重置运行状态并调整画布，这一职责边界参考 n8n 的 [useWorkflowImport](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/app/composables/useWorkflowImport.ts)，避免文件解析逻辑直接操纵编辑器视图。

运行编排分为 `useWorkflowRunActions` 与 `useHistoricalRunActions`：前者负责运行前检查、保存、创建执行、轮询、取消和历史重试，后者负责历史执行的加载、节点深链、清除与结果对比。运行前保存复用 `useWorkflowPersistenceActions`，因此运行按钮不会绕过版本冲突和保存互斥策略；底层 `useWorkflowExecutionController` 继续只维护当前执行快照、操作令牌和轮询状态，`useRunInspectorController` 继续只负责历史数据读取与迟到结果隔离。

工作流设置视图由独立的 `WorkflowSettingsPopover` 承载，职责划分参考 n8n 的 [WorkflowSettings 组件](https://github.com/n8n-io/n8n/tree/master/packages/frontend/editor-ui/src/app/components/WorkflowSettings) 与 [工作流设置文档 store](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/app/stores/workflowDocument/useWorkflowDocumentSettings.ts)。弹层限制在当前视口内滚动，标题栏保持可见，并支持关闭图标、`Esc` 和点击外部关闭；字段修改通过显式 action 契约交给设置控制器，页面不再内嵌整套设置表单。

顶部工作区由独立的 `WorkflowTopbar` 承载，并通过 `identity`、`operationState`、`actions` 三组契约组织工作流身份、命令状态和用户操作。编辑历史、资源、工作流命令、发布与运行控制具有明确的可访问分组；资源、设置和工作流目录通过插槽接入，顶部栏不依赖对应业务控制器。`WorkflowSettingsMenu` 统一管理设置触发按钮与弹层关闭行为，避免打开状态分散在页面视图中。

主编辑区由 `WorkflowWorkbenchLayout` 管理节点库、画布、节点检查器和运行日志四个稳定插槽，布局职责对应 n8n `WorkflowLayout` 中 header、router view、logs footer 的分层方式。每个插槽仍有独立错误边界和上下文 reset key：单一区域渲染失败不会拖垮整个编辑器，切换工作流、节点版本、选中节点或运行记录后会自动清除旧故障状态。

`useWorkbenchNavigationController` 统一维护节点主选、多选、连线聚焦、配置/运行标签、运行详情来源、子流程层级和画布适配请求。节点与连线选择互斥，跨层级、历史版本和工作流文档切换通过原子动作清理旧状态；这套边界参考 n8n 的 [canvas store](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/app/stores/canvas.store.ts) 与按工作流文档隔离的 [NDV store](https://github.com/n8n-io/n8n/blob/master/packages/frontend/editor-ui/src/features/ndv/shared/ndv.store.ts)，避免页面组件分别修改多个关联状态。

每次保存和节点升级都会保留历史版本；发布或停用只切换生产版本指针，不会额外创建版本。在“工作流设置”的“版本历史”中可先查看任一旧版本与当前版本的差异摘要（工作流名称、说明、标签、节点新增、删除、配置或位置变化、连线、设置和画布说明），再决定是否恢复；恢复不会覆盖历史，而是校验后生成一个新的草稿版本。恢复或节点升级后需要再次点击“发布工作流”，才会影响外部触发器；发布时才执行 Webhook 路由冲突校验。

已经有生产版本时，历史列表还会提供“回滚生产”。它会先要求二次确认，再把选定的历史内容复制成一个新的已发布版本，并立即切换 Webhook、定时触发等生产入口；当前草稿和所有历史版本都保留。版本记录会标出“普通保存”“恢复自 vX”或“生产回滚自 vX”，便于追溯每次变更。未发布工作流、当前版本和已经在生产运行的版本不能执行这项操作。

在顶部“工作流管理”中可导出当前工作流为带格式和版本号的 JSON 文件，也可导入此前导出的文件或兼容的裸工作流 JSON。导入始终创建一个新的“副本”草稿，不覆盖已有工作流；导入后请先验证，再保存。

在“工作流设置”的“基本信息”中可为流程填写描述并添加标签。描述和标签会随工作流版本保存，在“工作流管理”目录中展示，搜索框也可按名称、ID、描述或标签检索流程。

节点运行状态包括：等待、运行中、成功、失败、已处理、已跳过、已取消。工作流运行状态包括：排队中、运行中、成功、失败、已取消。

## 执行策略与运行谱系

每个节点在右侧配置面板的“失败处理”区域可设置运行策略：

- `失败即停止`：默认行为，节点失败后结束本次工作流运行。
- `失败后继续`：记录失败和“错误已处理”事件，但不向下游输出数据；其他独立分支可继续执行。
- `走错误端口`：仅适用于声明并连接 `error` 输出端口的节点。运行时会把标准错误对象传给该端口的下游节点。
- `最多尝试次数` 和 `重试间隔`：可为单节点配置 1 到 5 次尝试、0 到 60 秒间隔。运行详情会显示每次尝试与“已安排重试”事件。

标准错误对象包含 `message`、`type`、`attempt`、`nodeId`、`scope` 和 `timestamp`，便于错误处理节点、报告节点或未来的通知节点复用。工作流有默认 600 秒全局超时，可在“工作流设置”中调整。

运行记录支持父运行和来源节点字段。运行事件中的“查看子运行”会打开被调用工作流的历史运行；子运行详情也可返回父运行。

在历史运行详情中，失败或已取消的“手动运行”和“定时触发”可以点击“重新运行”。系统会严格复用该次运行保存的工作流版本、入口节点、触发输入与固定数据设置，而不是使用当前画布或最新版流程；新的运行记录会标为“手动运行”。原运行与重试运行的事件会互相链接，便于比对两次结果。为避免重复的外部副作用，生产/调试 Webhook、子工作流和错误处理运行不提供重试入口。

“工作流管理”的运行历史默认显示最近 5 条；可按排队中、运行中、成功、失败或已取消筛选，点击“加载更多”会保留已显示的记录并继续读取更早的运行。打开任一历史运行后，可在“运行对比”中选择已加载的另一条记录，按节点查看状态、执行次数和输入输出差异。

在“工作流设置”的“错误处理”中可选择一个已保存的错误处理工作流。该工作流必须仅以一个 `工作流触发` 节点开始；当当前工作流失败时，系统会创建一条独立的“错误处理”运行，并将失败运行 ID、工作流 ID、名称、版本和已脱敏的错误信息传给该触发节点。运行日志会记录错误处理的启动、成功、失败或跳过，并可直接打开对应运行。错误处理运行使用自己的全局超时，不会因当前运行的超时而被立即取消；取消当前运行不会触发它，错误处理工作流自身失败也不会递归触发下一层。

## 工作流组合

已保存的工作流可以像普通节点一样被同步调用：

1. 新建一个被调用工作流，并以唯一的 `工作流触发` 节点作为根节点。
2. 将输入接到后续节点；调用方传入的数据会从该节点的 `输入` 端口输出。手动运行被调用工作流时，输入为空对象。
3. 在需要把数据交还调用方的位置连接 `工作流返回` 节点。
4. 在调用方添加 `执行工作流` 节点，在右侧选择已保存的目标工作流，并连接它的输入、结果或错误端口。

`执行工作流` 会等待子工作流结束后才继续下游；未使用 `工作流返回` 时会返回空对象。直接或间接递归调用会在创建子运行前被拒绝。子工作流继承父运行的取消请求和剩余全局超时，因此不能在父运行结束后继续执行。子工作流失败会作为调用节点的普通失败处理，可继续使用“失败即停止”、“失败后继续”、重试或“走错误端口”。本阶段不提供异步后台调用。

## Webhook 触发

`Webhook 触发`是第一个面向外部系统的通用触发器。为节点配置请求方法和路径，例如 `POST` 与 `hooks/orders`；保存草稿后需点击顶部“发布工作流”，才可通过 `POST /webhooks/hooks/orders` 启动工作流。节点的输出包含 `method`、`path`、`headers`、`query` 和 `body`，后续节点可用表达式读取这些字段。

同一个请求方法和路径只能绑定一个已保存工作流，避免外部请求落到不确定的流程。Webhook 触发器必须是入口节点，不能连接上游；同一工作流内也不能重复配置相同方法和路径。一个工作流可以有多个 Webhook 触发器，但单次请求只会执行匹配入口及其下游。

需要控制对外 HTTP 响应时，在下游连接 `Webhook 响应` 节点：它的输入会成为 JSON 响应体，配置可设置状态码和响应头。例如把 `Webhook 触发` 连到一个状态码为 `202` 的 `Webhook 响应`，即可返回接收到的请求数据。一个请求只能实际设置一次响应；该节点不能用于手动运行或子工作流。未连接该节点时，Webhook 保留兼容响应，返回运行记录和工作流输出。

Webhook 的“响应方式”默认为“等待工作流完成”，适合需要把处理结果直接返回给调用方的接口。长耗时事件、回调和告警可改为“立即确认，后台执行”：路由会立即返回 `202 Accepted`、运行 ID 与 `Location: /api/runs/<运行 ID>`，随后通过统一队列在后台执行，仍支持取消、超时、失败策略、运行日志和错误工作流。该模式不能连接 `Webhook 响应` 节点，因为 HTTP 响应已经发出。流式响应将在后续阶段补齐。

“访问保护”还支持 `Webhook HMAC-SHA256 签名` 凭据。新建凭据时填写共享签名密钥和第三方发送签名的请求头名称，例如 `X-Hub-Signature-256`；平台会对收到的原始请求体计算 HMAC-SHA256，并接受 `sha256=<十六进制签名>` 或裸十六进制签名。签名头和固定验证头都会在运行输入、日志与详情中脱敏显示。

在“凭据管理”中新建“HTTP 请求头”凭据，填入要校验的请求头名称和值，例如 `X-Webhook-Token`；再回到 Webhook 节点的“访问保护”选择它即可。凭据值只保存为本地加密数据，画布和运行详情不会显示明文。

配置面板会同时显示生产地址和调试地址。生产地址只会调用已发布版本；调试地址形如 `POST /webhooks-test/<工作流 ID>/hooks/orders`，会精确调用该工作流最近保存的草稿版本，即使它尚未发布。调试前需在节点配置中点击“开始监听”：监听会在两分钟后过期，并在收到一条请求后自动结束。两种地址都使用相同的请求头验证规则，调试地址不会执行未保存的画布改动。运行历史会明确标记为“生产 Webhook”或“调试 Webhook”，避免排障时混淆来源。

## 定时触发

`定时触发`用于按固定间隔自动执行已发布的工作流。配置“间隔秒数”（10 秒到 7 天）并保存草稿、发布后，服务端会等待一个完整间隔再创建运行记录。定时触发必须是入口节点，不能有上游连线；每个实际到期的周期都会创建运行并交给统一队列，慢任务是否允许叠加由“工作流设置 > 运行并发”的显式上限决定。下次执行时间会持久化到 SQLite，服务重启后调度器会继续使用原有时间。触发数据包含 `trigger: "schedule"` 与 `scheduled_at`，可供后续 Python 节点或表达式使用。在“工作流设置”的“触发器状态”中可查看生产版本的启停状态、Webhook 绑定与定时器下次执行时间。

运行创建时会保存工作流版本、入口节点、触发输入和启动方式。服务重启后，尚未开始的手动或定时运行会从保存的版本继续执行；正在执行中的运行、Webhook 请求和子工作流不会自动重放，因为它们可能已经向外部系统产生副作用。这些运行会被标记为失败，并在运行事件中记录中断或跳过恢复的原因，便于人工判断是否需要重新运行。

本地服务会统一调度后台根工作流，默认最多同时执行 4 个运行；超过上限的手动、定时或恢复运行会保持“排队中”，直到获得执行槽位。Webhook 仍同步等待自己的工作流完成，以便返回节点定义的 HTTP 响应。

在独立 Worker 模式下，Worker 的 `--concurrency` 也是所有连接同一 SQLite 数据库的 Worker 共享的全局上限，而不是每个进程可叠加的额度；同一部署中的 Worker 应使用相同配置，并与 API 服务的全局队列限制保持一致。

## 运行并发与队列

顶部的全局队列限制用于保护本机执行资源；每个工作流还可在“工作流设置 > 运行并发”中设置自己的“同时运行上限”。留空表示只受全局队列限制；设为 `1` 时，同一工作流的手动、定时与 Webhook 根运行会串行执行，但其他工作流仍可使用剩余的全局并发额度。

运行结果面板会显示排队位置和当前全局执行占用。排队中的运行取消后会立即从队列移除并标记为“已取消”；已经开始执行的运行采用协作式取消，正在执行的 Python 节点会先完成当前调用，执行器随后停止未开始的节点和循环迭代。工作流的全局超时默认是 600 秒，可在顶部“超时”输入框中调整。
## 独立 Worker

默认 `embedded` 模式适合本地单进程使用：API 服务同时消费队列。需要把执行与 API 隔离时，先以 worker 模式启动 API，再单独启动 worker：

```powershell
$env:NODE_FLOW_EXECUTION_MODE = "worker"
pnpm dev:api

# 新开一个终端，使用同一个 SQLite 数据库
pnpm dev:worker

# 或自行指定数据库、节点目录和并发数
python -m apps.api.nodeflow_api.worker --database node-flow.sqlite3 --nodes-dir nodes --concurrency 4
```

独立 worker 只领取手动和定时触发创建的后台根运行，并通过 SQLite 原子领取和租约标记防止多个 worker 重复执行。Webhook 与子工作流保持同步执行语义。API 重启不会中断仍由独立 worker 持有租约的运行；worker 进程本身失联后的运行不会自动重放，以避免外部副作用重复发生。

Worker 会在每次领取任务前检查 `nodes/` 下 Python 节点脚本和 `nodeflow-package.json` 清单的文件变更；发现变化后才重新扫描节点库。已开始的运行会继续使用启动时的节点快照，后续领取的运行则使用刷新后的脚本定义。

## 画布说明

画布工具栏中的“添加画布说明”可在当前主流程或循环体画布上放置独立说明卡片。说明支持编辑正文、切换颜色和调整尺寸，并会随工作流的保存、导入导出、版本恢复以及撤销/重做一同保留。

说明只服务于流程编排和协作阅读：它不是可执行节点，不占输入输出端口，不参与连线校验，也不会写入运行事件或影响 Python 节点执行。

## 测试自动化节点

当前内置节点已经覆盖常见测试工作流：

- `读取 CSV`：读取 CSV 行和列，用于数据驱动测试。
- `遍历循环`：对 CSV 行或任意列表逐项执行循环体。
- `HTTP 请求`：发送接口请求并输出状态码、响应头和响应体。
- `状态码断言`、`相等断言`、`包含断言`：判断接口响应是否符合预期。
- `记录测试结果`、`测试汇总`、`写入测试报告`：收集断言结果并写出报告。

一个典型流程是：`手动触发 -> 读取 CSV -> 遍历循环`，在循环体里执行 `HTTP 请求 -> 断言 -> 记录测试结果`，循环结束后执行 `测试汇总 -> 写入测试报告`。

表达式使用 `{{ ... }}` 形式引用运行时数据，例如：

```text
{{ vars.baseUrl }}
{{ project.baseUrl }}
{{ loop.item.username }}
{{ nodes.request.outputs.success.status_code }}
{{ variables.token }}
```

在顶部“项目变量”中维护的非敏感共享配置通过 `project` 引用，适合多个工作流共用的接口基址、环境名和默认参数。每次创建运行时，项目变量都会被固化为运行快照；后续修改不会影响排队、重试或子工作流中的已有运行。

## 运行环境

顶部“环境管理”可创建命名的运行环境，例如“测试环境”“预发布环境”。每个环境保存一组 JSON 变量；工作流表达式继续通过 `{{ project.base_url }}` 读取当前环境中的值，因此不需要为每个环境复制画布或修改节点配置。

环境也可以建立“工作流凭据 → 环境实际凭据”的同类型映射。例如节点中固定引用“默认 HTTP 令牌”，在测试环境映射为“测试 HTTP 令牌”，发布环境映射为“生产 HTTP 令牌”。工作流不需要改动凭据字段；映射只保存凭据 ID，不保存或展示令牌、密码等秘密值。

在“工作流设置 > 运行环境”选择默认环境并保存草稿。发布后，生产 Webhook 和定时触发会使用已发布版本所选择的环境；后续修改草稿的环境选择不会影响生产。手动运行时，可在“本次运行输入”弹窗临时选择另一个环境，只影响这一次运行。

每条运行都会记录环境 ID、环境名称、变量快照和凭据映射快照。环境后续修改、删除或重命名不会改变已经排队、执行完成或重新运行的历史记录。默认环境兼容原有“项目变量”：它的变量仍在“项目变量”中维护。变量仅用于非敏感配置；令牌、密码和鉴权头仍应使用“凭据管理”。

在“工作流设置”里维护的变量通过 `vars` 引用，适合单个工作流的固定配置；`variables` 是运行过程中由节点写入的变量。令牌、密码和固定鉴权头请继续放在“凭据管理”中，而不要写入项目变量。

当前验证会检查表达式的基本语法，但不会静态证明运行时路径一定存在。

## 测试工作流使用方式

从空画布开始时，可以直接在画布空状态里选择测试模板。模板会预置常见节点和连接，适合先跑通一条测试链路，再按接口实际字段微调配置。

单接口状态码断言：

1. 选择“单接口状态码断言”模板，或手动连接 `手动触发 -> HTTP 请求 -> 状态码断言 -> 记录测试结果 -> 测试汇总 -> 写入测试报告`。
2. 点击 `HTTP 请求` 节点，在右侧配置里填写请求方法和 URL；需要请求头、请求体时，按节点字段继续补充。
3. 点击 `状态码断言` 节点，把实际状态码指向 HTTP 请求输出，例如 `{{ nodes.request.outputs.success.status_code }}`，并填写期望状态码，例如 `200`。
4. 点击 `写入测试报告` 节点，填写报告输出路径，例如 `reports/smoke-status.json`。

CSV 参数化接口测试：

1. 准备 CSV 文件，例如 `data/users.csv`，首行写列名，后续每行是一组测试数据。

   ```csv
   name,url
   node_types,http://127.0.0.1:8150/api/node-types
   health,http://127.0.0.1:8150/api/health
   ```

2. 选择“CSV 参数化接口测试”模板，或手动连接 `读取 CSV -> 遍历循环`，并在循环体里连接 `HTTP 请求 -> 断言 -> 记录测试结果`。
3. 点击 `读取 CSV` 节点，填写 CSV 文件路径，确认分隔符和表头设置。
4. 点击 `遍历循环` 节点，把循环输入指向 CSV 读取结果；循环体中的 HTTP 请求可以通过 `{{ loop.item.column_name }}` 引用当前行字段。

   ```text
   {{ loop.item.url }}
   ```

5. 模板默认断言状态码为 200；循环结束后连接 `测试汇总 -> 写入测试报告`，运行完成后在底部“测试报告”查看用例通过、失败和未知结果。

运行与排查：

- 点击“运行”保存并执行当前工作流；运行中可点击“取消”停止后续节点和循环迭代。
- 底部面板的“测试报告”用于查看汇总和每条用例结果。
- 底部面板的“运行事件”用于查看节点级事件；点击事件后，右侧“运行详情”会显示输入、输出、日志、错误和循环范围。

## 本地凭据库

顶部的“凭据管理”用于维护仅本机可用的连接凭据。内置支持 Bearer 令牌、Basic 认证和固定请求头；本地节点包还可以声明自己的凭据类型，例如数据库连接、消息队列账号或云服务 API 密钥。凭据在 Windows 上使用当前登录用户的 DPAPI 加密后写入 SQLite，工作流只保存凭据 ID 引用。

在 HTTP 请求节点的“认证凭据”中选择已创建的凭据即可。请求头的覆盖顺序为：凭据注入 < 节点配置请求头 < 输入端口请求头。自定义节点可在声明式表单中使用一个或多个 `credential` 控件，每个控件都能限制允许的凭据类型。凭据字段不会出现在列表、工作流导出、运行事件或运行详情中；编辑凭据时只有明确勾选替换后才会写入新的秘密值。

凭据删除前会检查工作流引用，有引用时会阻止删除。此能力目前仅支持 Windows；在其他平台上，系统会拒绝凭据写入而不会降级为明文存储。已有 `NODE_FLOW_SECRET_*` 环境变量仍可供 Python 节点兼容使用，但不会自动导入凭据库。

解密后的凭据字段只在当前根运行及其同步子工作流执行期间保留于运行级脱敏上下文；运行结束、失败或取消后，该上下文会立即释放。不同并发运行之间不会共享凭据值。

## Python 节点

Python 节点文件放在 `nodes/` 下。节点使用类和装饰器注册：

```python
from pydantic import BaseModel
from nodeflow_sdk import BaseNode, NodeContext, Output, node


class DemoConfig(BaseModel):
    message: str = "hello"


@node(id="demo.echo", name="Echo", category="Demo", description="Return a message.")
class EchoNode(BaseNode[DemoConfig]):
    outputs = {"success": Output(description="Echo result")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        ctx.log.info("echo")
        return {"success": {"message": self.config.message}}
```

后端启动时会扫描节点目录，节点配置会由 Pydantic 生成 JSON Schema，并在前端自动渲染成配置表单。

### 跨运行状态

Python 节点可以保存少量、可 JSON 序列化的跨运行状态，适合增量同步游标、去重标记和上次成功处理的时间。节点级状态按“工作流 ID + 节点 ID”隔离；工作流级状态由同一工作流中的所有节点共享：

```python
cursor = ctx.get_node_static_data("cursor", None)
ctx.set_node_static_data("cursor", next_cursor)

last_success = ctx.get_workflow_static_data("last_success", None)
ctx.set_workflow_static_data("last_success", {"at": "2026-07-30T10:00:00Z"})
```

也可使用对应的 `delete_node_static_data(...)` 和 `delete_workflow_static_data(...)` 删除键。状态修改会在根运行及其同步子工作流全部成功后一次性提交；运行失败、超时或取消时全部丢弃。错误处理工作流拥有独立事务，因此可在主流程失败后持久化自己的告警或去重状态。并发运行发生版本冲突时，系统会让该运行明确失败，而不会静默覆盖已有状态。

跨运行状态不是凭据存储：不要写入令牌、密码、固定鉴权头或大体积数据。状态值本身不会自动写入运行事件，但节点主动输出或记录它们时仍会出现在运行详情中。

节点的输入、输出端口也是脚本契约的一部分。推荐为端口声明 JSON Schema，这样画布拖线、保存前校验和后端运行前校验都会使用同一类规则：不存在的端口不能连接，必填输入必须连接，`integer` 可以连接到 `number`，但 `string` 不能直接连接到 `number`。端口也可以通过 `filter` 限制可连接的节点类型：输入端口的筛选作用于上游节点，输出端口的筛选作用于下游节点；`nodes` 是允许列表，`excludedNodes` 是排除列表且优先级更高。

节点可以直接输出普通 JSON。需要在批量数据流中保留来源配对关系或二进制描述时，可从 SDK 使用 `execution_item()` 返回标准数据项；运行详情会显示这些 item 及其元数据。下游端口只有显式声明 `Input(data_mode="items")` 时才会收到标准 item 列表，普通旧节点仍按原始 JSON 方式运行。

```python
from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


@node(id="demo.add_one", name="Add One", category="Demo")
class AddOneNode(BaseNode[NodeConfig]):
    inputs = {
        "input": Input(
            required=True,
            description="数字输入",
            schema={"type": "number"},
        )
    }
    outputs = {
        "success": Output(
            description="加一后的数字",
            schema={"type": "number"},
        )
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs["input"] + 1}
```

端口名会成为连线句柄，例如 `success -> input`。如果节点返回了未声明的输出端口，运行器会把它当成节点实现错误处理，避免工作流在隐式数据形状下继续运行。

例如只允许 HTTP 请求节点接到某个输入，或只允许错误出口连到日志节点：

```python
inputs = {
    "response": Input(filter={"nodes": ["http.request"]}),
}
outputs = {
    "error": Output(filter={"nodes": ["debug.log"]}),
}
```

这个约束会同时用于画布拖线提示、修复候选、保存前校验和后端权威校验。

刷新节点库时，系统还会校验静态端口契约。端口 handle 必须是稳定标识符，`filter` 只能使用 `nodes` 和 `excludedNodes`，连接上限必须为非负整数或 `None`。不符合规则的本地节点或节点包入口会被隔离，节点库的“加载问题”会显示具体原因，不会阻塞其它节点继续使用。

动态端口节点需要同时声明 `DynamicInputList` / `DynamicOutputList`，并实现对应的 `input_ports()` / `output_ports()`。解析器返回的是该节点实例的完整端口集合：必须保留静态端口，动态句柄及元数据必须与装饰器声明和当前配置一致。平台会先用 Pydantic 配置模型补齐默认值，再隔离调用解析器；运行时异常、非法句柄、错误端口类型、遗漏端口、额外端口或元数据漂移都会生成 `node_input_port_resolution_failed` / `node_output_port_resolution_failed` 校验问题。界面会暂时退回静态端口以便修复，但工作流不能保存或运行，避免画布与执行器使用不同的连接图。

输入端口默认只允许一条连线。需要汇聚多个上游结果时，可以把输入端口声明为多连接端口；运行时该输入会收到一个列表，顺序按上游结果到达顺序排列：

```python
@node(id="demo.collect", name="Collect", category="Demo")
class CollectNode(BaseNode[NodeConfig]):
    inputs = {
        "items": Input(
            required=False,
            description="多个上游结果",
            max_connections=None,
        )
    }
    outputs = {"success": Output(description="Collected items")}

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs.get("items", [])}
```

`Input(max_connections=None)` 表示输入端口不限制连接数；省略时输入端口默认为 `1`，即保持普通单输入端口行为。输出端口默认允许连接多个下游节点；只有显式设置 `Output(max_connections=...)` 时，才会限制该输出的扇出数量。

需要按数据项处理上游结果时，可以把它与多连接端口组合使用：

```python
inputs = {
    "items": Input(
        required=False,
        max_connections=None,
        data_mode="items",
    )
}
```

此时 `inputs["items"]` 始终是 `[{"json": ...}, ...]` 形式的列表；多个上游会按到达顺序合并。未声明 `data_mode="items"` 的端口保持兼容，继续接收原始 JSON。

内置“读取 CSV”还会通过 `items` 输出为每行产生一个标准数据项。将它连接到“逐项循环”的 `items` 输入后，循环体会依次执行，当前行可用 `{{ loop.item.列名 }}` 读取。这条路径不依赖 CSV 专用执行器，任何能输出 item 列表的 Python 节点都可以接入。

通用数据流可在循环前完成整理：`映射数据项` 用 `{{ item.字段 }}` 为每项构造新对象并保留来源元数据；`筛选数据项` 按字段值比较保留匹配项；`合并数据项` 将多个上游 item 流按到达顺序追加。它们均可直接连接到“逐项循环”的 `数据项` 输入。

### 声明式配置表单

节点可以在 `@node(...)` 中可选声明 `form=NodeForm(...)`。它描述配置面板的分组、字段顺序、控件类型、中文帮助文本、条件显示、下拉选项和可用凭据类型；编辑器会统一渲染这些元数据，因此新增通用连接器不需要为每个节点再写一套前端页面。

```python
from nodeflow_sdk import FormCondition, FormField, FormGroup, NodeForm, SelectOption, node


@node(
    id="demo.request",
    name="Request",
    category="Network",
    form=NodeForm(groups=(
        FormGroup("request", "请求", fields=(
            FormField("method", control="select", options=(SelectOption("GET", "GET"),)),
            FormField("url", control="url", label="URL"),
            FormField("body", control="json", visible_when=FormCondition("method", one_of=("POST",))),
        )),
    )),
)
class RequestNode(BaseNode[RequestConfig]):
    pass
```

支持的控件为 `text`、`textarea`、`password`、`number`、`switch`、`select`、`json`、`url` 和 `credential`。`visible_when` 只控制界面显示，不改变 Pydantic 的后端校验规则；配置模型始终是唯一权威。未声明表单或表单描述无效的节点会安全回退到通用 JSON Schema 表单。

凭据控件可使用任意配置字段名，并用 `credential_type_ids` 限制可选类型。节点执行时通过该字段保存的凭据 ID 从上下文读取，多个凭据会同时提供：

```python
class ServiceConfig(NodeConfig):
    auth_credential_id: str | None = None


@node(
    id="example.request",
    name="服务请求",
    category="Network",
    form=NodeForm(groups=(
        FormGroup("auth", "认证", fields=(
            FormField(
                "auth_credential_id",
                control="credential",
                label="服务认证",
                credential_type_ids=("example.api_key",),
            ),
        )),
    )),
)
class ServiceNode(BaseNode[ServiceConfig]):
    async def execute(self, ctx: NodeContext, inputs: dict):
        credential = ctx.get_credential(self.config.auth_credential_id or "")
        api_key = credential.data["api_key"] if credential else None
        # 使用 api_key 调用服务；不要写入日志。
```

### 本地节点包

除了直接放在 `nodes/` 下的单个 Python 脚本外，也可以用本地节点包组织可复用连接器。一个包目录放置 `nodeflow-package.json`，只会加载 `nodeEntrypoints` 明确声明的入口文件：

在项目根目录中，可用脚手架直接创建一个可加载的包和示例节点：

```powershell
python -m nodeflow_sdk.scaffold nodes/acme-tools `
  --package-id acme.tools `
  --package-name "Acme 工具" `
  --node-id acme.echo `
  --node-name "回显" `
  --category "自定义"
```

命令会拒绝覆盖已经存在的目录；生成后的 `echo.py` 包含 Pydantic 配置、输入输出端口、日志和可执行的最小示例。修改脚本后在节点库点击“刷新”，后续运行即可使用新定义。

节点包接入编辑器前可以运行与正式加载链路一致的自检：

```powershell
# 检查整个节点目录
pnpm doctor:nodes

# 只检查一个节点包
python -m apps.api.nodeflow_api.node_doctor nodes/acme-tools

# CI 使用机器可读输出，并把无法完成的默认动态端口检查也视为失败
python -m apps.api.nodeflow_api.node_doctor nodes/acme-tools --json --strict
```

自检会先检查 Node Flow/Python 兼容范围和已安装的 Python 分发包，再加载入口并校验节点 ID、静态与动态端口、声明式表单、凭据类型及默认动态端口解析器。普通输出使用中文摘要；`--json` 返回稳定字段。退出码 `0` 表示通过，`1` 表示发现契约错误（或严格模式下存在警告），`2` 表示目标路径或命令参数无效。入口脚本没有注册节点、单文件脚本加载失败等问题也会给出具体诊断，不再只显示一个笼统的失败状态。

```text
nodes/
  my-tools/
    nodeflow-package.json
    json_tools.py
```

```json
{
  "id": "example.my-tools",
  "name": "我的工具集",
  "version": "1.0.0",
  "engines": {
    "nodeflow": ">=0.1.0,<0.2.0",
    "python": ">=3.11"
  },
  "pythonDependencies": ["httpx>=0.28"],
  "nodeEntrypoints": ["json_tools.py"],
  "credentialTypes": [
    {
      "id": "example.api_key",
      "displayName": "示例 API 密钥",
      "fields": [
        {"id": "api_key", "label": "API 密钥", "secret": true}
      ],
      "nodeTypeIds": ["example.request"]
    }
  ]
}
```

`engines.nodeflow` 与 `engines.python` 使用 Python 标准版本范围语法；`pythonDependencies` 使用 PEP 508 分发包依赖语法，也支持环境标记。加载器只检查当前环境，不会自动执行 pip 安装。Node Flow/Python 版本不兼容、依赖缺失或已安装版本不满足时，整个包会在执行入口顶层代码之前停止加载，并返回稳定诊断。旧清单省略 `engines` 时仍可加载，但兼容状态为“未验证”，doctor 的 `--strict` 会将该警告视为失败。

`credentialTypes` 是可选数组。每个类型的 ID 在当前项目必须唯一，字段必须声明 `id`、中文 `label` 与是否为敏感字段的 `secret`，`nodeTypeIds` 只能引用该包已成功加载的节点。类型冲突或错误声明只会让该类型被跳过并记录包诊断，不会阻止包内其他正确节点加载。未使用清单的旧脚本仍按原方式加载，并在节点库中标记为“本地脚本”；使用清单的节点会显示包名称与版本。

点击节点库的“刷新”后，`GET /api/node-packages` 可返回最近一次扫描的包快照、运行环境要求、兼容状态、生命周期与诊断。编辑器会以中文区分“兼容”“未验证”“不兼容”“已停用”和“版本待确认”，并允许管理第三方包：

- 节点包状态区的“导入 ZIP”可以安装或升级一个包含单一清单的本地节点包。导入前会提示该包将执行受信 Python 代码。
- ZIP 会先在隔离暂存目录做路径、大小、清单、兼容性、依赖、节点、端口、表单和凭据类型预检；预检通过后才进入 `nodes/_installed/`。
- 升级会拒绝降级、工作区同 ID 包覆盖、版本锁冲突、节点 ID 冲突，以及删除仍被工作流引用的节点。激活后若全局扫描失败，会自动恢复原版本。
- 安装器会为成功升级或重装前的活动版本保留最多 10 个历史修订。展开包后点击“历史版本”可查看版本、归档时间和原始 ZIP 文件名，并主动恢复。
- 主动恢复允许从新版本回到已归档旧版本，但仍会重新预检内容并执行版本锁、节点冲突和工作流引用检查；当前活动版本会先归档，因此恢复操作本身也可追溯。
- 安装、升级、恢复、卸载和手动扫描共享跨进程文件租约；另一个 API 或 Worker 正在变更节点目录时，API 返回结构化 `409 node_package_mutation_busy`，不会并发改写安装槽。
- 每次目录切换都会写入 `.nodeflow-packages/transactions/` 原子事务日志。服务异常退出后，下次启动会恢复未提交操作或完成已提交清理，并在节点包状态区显示中文恢复提示。
- 只有通过安装器导入的包显示“卸载”。卸载前同样检查工作流引用；`nodes/` 中手写的工作区包和内置包不会被安装器删除。
- “启用节点包”只影响后续扫描和运行；已经开始的运行固定使用启动时节点快照。
- 停用前会检查当前工作流引用，仍被使用时返回具体工作流与节点位置，不会让现有流程静默损坏。
- “锁定当前版本”把包版本写入项目数据库。清单升级后若与锁定版本不同，入口不会被导入，需接受新版本或恢复原文件。
- API 使用 `PUT /api/node-packages/{package_id}/settings`，完整提交 `enabled` 与 `locked_version`。内置包由平台管理，不允许停用或单独锁定。
- 安装 API 为 `POST /api/node-packages/install?filename=...`，请求体是 ZIP；卸载 API 为 `DELETE /api/node-packages/{package_id}`。
- 历史 API 为 `GET /api/node-packages/{package_id}/revisions` 和 `POST /api/node-packages/{package_id}/revisions/{revision_id}/activate`。
- API、嵌入式执行器和独立 Worker 读取同一份 SQLite 策略；各进程在读取节点目录或领取任务前会通过 fingerprint 检测并加载其他进程已经提交的包变更。

本地节点包会执行 Python 模块顶层代码，因此与现有 `nodes/` 脚本一样属于受信任的本地开发者代码。ZIP 导入不会自动执行 pip 安装；依赖必须事先存在于当前 Python 环境。当前不提供在线市场、远程下载、包签名校验或代码沙箱。

## 节点版本升级

工作流会为每个节点保存 `typeVersion`。新拖入的节点记录当前 Python 节点脚本的 `@node(..., version=...)` 版本；旧工作流未保存版本时按 v1 处理。

当节点脚本调整配置模型并提高版本号时，为每一步迁移提供 `migrate_config`。编辑器中的“检查节点升级”会先展示字段级的新增、修改、删除，以及每一步迁移说明；只有点击“应用升级”才会写入一个新的草稿工作流版本。旧版本节点不会被静默运行或静默覆盖，生产触发器会继续使用原已发布版本，直到确认发布升级后的草稿。

历史运行的“重新运行”会先校验其保存工作流中的节点版本；若当前脚本已经不兼容，会拒绝创建重试。已经排队、恢复或由 Worker 延后领取的运行会在真正启动前再次检查；发现节点缺失或版本不兼容时会明确失败，而不会混用新脚本和旧配置。

```python
@node(id="demo.echo", name="Echo", category="Demo", version=2)
class EchoNode(BaseNode[DemoConfig]):
    @classmethod
    def migrate_config(cls, from_version: int, config: dict):
        if from_version == 1:
            return {"message": config["text"]}
        return super().migrate_config(from_version, config)
```

迁移函数只负责从 `from_version` 到下一版；系统会按版本顺序逐步执行，并在最终配置不符合当前 Pydantic 模型、缺少迁移步骤或节点版本倒退时阻止应用。

## 验证

运行后端测试：

```powershell
pytest tests/api -q
```

运行前端测试：

```powershell
pnpm --filter @node-flow/web test
```

构建前端：

```powershell
pnpm build:web
```

## 当前不支持

- 在线编辑 Python 脚本。
- 多用户、认证和权限管理。
- 生产级密钥管理。
