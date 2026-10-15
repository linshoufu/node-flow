# 节点契约说明

## 工作流组合节点

`workflow.trigger`、`workflow.execute` 和 `workflow.return` 是平台提供的通用组合节点，不把存储、取消或运行归属暴露给 Python 节点 SDK：

- `workflow.trigger` 是被调用工作流的输入边界，必须是唯一根节点；输出 `success`，值为调用方传入的任意 JSON 数据。
- `workflow.execute` 的配置 `workflow_id` 是稳定的已保存工作流 ID；产品界面显示工作流名称。它接收可选 `input`，输出 `success` 或 `error`。
- `workflow.return` 接收可选 `input`，输出 `success`，并把该值作为子工作流的显式返回值。

运行器而不是节点类负责创建子运行，因此 `parent_run_id`、`parent_node_id`、运行事件、数据脱敏、节点失败策略、协作式取消和全局超时都保持同一套语义。子运行会继承祖先运行 ID 和绝对截止时间；任何祖先请求取消时，子运行会在下一次协作式检查时停止。运行器会在创建子运行前拒绝缺少唯一 `workflow.trigger` 根节点的目标工作流，以及直接或间接递归调用。

## Webhook 触发器

`webhook.trigger` 是外部 HTTP 请求的工作流入口。节点配置保存稳定的 `method` 与 `path`，但运行时接收的请求数据不写回工作流 JSON，而是通过 `success` 输出提供：`method`、`path`、`headers`、`query` 和 `body`。

`webhook.respond` 只可在当前 Webhook 触发的根工作流运行中生效。它接收可选 `input` 作为 JSON 响应体，并以 `status_code` 和 `headers` 配置 HTTP 状态码和响应头；运行器只接受该请求中第一个实际执行的响应节点，第二个会作为节点失败处理。未使用该节点时，路由保留返回运行记录和工作流输出的兼容行为。

`webhook.trigger.response_mode` 为 `sync` 时，HTTP 路由等待该运行结束，并可使用 `webhook.respond` 返回自定义响应；为 `immediate` 时，路由创建运行后立即返回 `202 Accepted`、运行摘要和 `Location` 运行地址，再由统一调度器异步执行。`immediate` 路径不能经过 `webhook.respond`，验证器会在保存时拒绝该组合。

`webhook.trigger` 的访问保护可引用 `http.header` 固定请求头凭据，或 `webhook.hmac_sha256` 签名凭据。后者包含共享 `secret` 和 `header_name`，路由以原始 HTTP body 计算 HMAC-SHA256，并以常量时间比较请求头中的裸十六进制签名或 `sha256=` 前缀签名。签名头会加入该运行的脱敏请求头集合。

Webhook 路由由平台存储层解析，而不是由节点脚本自行注册。`webhook.trigger` 必须是根节点，且所有已保存工作流与同一工作流内部的 `method + path` 都必须唯一；运行器会以命中的节点 ID 作为入口执行，因此同一工作流有多个 Webhook 根节点时也不会误执行其他入口。Webhook 响应由运行器暂存、由 HTTP 路由一次性写回，不进入 Python 节点 SDK。鉴权、测试 URL、流式响应和异步队列属于路由层后续能力。

Node Flow 的节点脚本是运行能力的来源，也是产品界面的元数据来源。新增节点时，应优先把节点契约写完整，让后端校验、前端画布、节点库搜索和运行详情使用同一份描述。

## 执行数据项

节点运行事件同时保留原始 `inputs` / `outputs`，并提供按端口组织的 `input_items` / `output_items`。每个数据项都有 `json` 字段，可选携带 `binary` 和 `pairedItem`；前端运行详情优先使用这些权威数据项，旧运行记录没有该字段时才从原始 JSON 兼容推断。

普通节点仍可直接返回 JSON。需要传递多个独立数据项、二进制描述或来源配对关系时，Python 节点应从 SDK 使用 `execution_item()`：

```python
from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, execution_item, node


@node(id="demo.rows", name="Rows", category="Data")
class RowsNode(BaseNode[NodeConfig]):
    async def execute(self, ctx: NodeContext, inputs: dict):
        return {
            "success": [
                execution_item({"id": 1}, paired_item={"item": 0}),
                execution_item({"id": 2}, paired_item={"item": 1}),
            ]
        }
```

普通输入端口保持旧行为，仍直接收到上游原始 JSON。需要显式消费标准数据项时，在输入端口声明 `data_mode="items"`：单条连线会传入一个 item 列表；多条连线会将各上游 item 按到达顺序合并为同一个列表。上游可以返回普通 JSON、`execution_item()` 或 item 列表，执行器都会在这个输入边界归一化；这不会改变现有连线的 schema 校验语义。

## 节点元数据

节点使用 `@node(...)` 注册：

```python
@node(
    id="http.request",
    name="HTTP Request",
    category="Network",
    description="Send an HTTP request.",
    group="action",
    icon="globe",
    tags=["http", "api", "network"],
    keywords=["request", "rest", "url", "web"],
)
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    ...
```

`id` 是稳定的内部类型标识，保存到 workflow JSON。`name`、`category`、`description`、`icon`、`tags` 和 `keywords` 面向产品界面和搜索。第一批内置节点偏测试场景，但这些字段应保持通用，不要把底层模型写死为测试工具。

## 固定调试输出

工作流节点可选保存 `pinnedData`，其键必须是节点声明的输出端口，值是 JSON 兼容的固定数据。产品界面既可从最近一次运行捕获输出，也可在尚无运行记录时手工创建和编辑 Mock 数据；保存前会检查 JSON、非空对象和端口名称，后端仍会作为权威校验。手动运行时，执行器会跳过该节点实现并直接发布固定输出，同时写入 `node_pinned_data_used` 事件；这使下游流程可以在不重复请求外部系统的情况下调试。

固定输出属于工作流编辑数据，而不是节点 Python 配置。Webhook 请求和 `workflow.execute` 创建的子运行必须以 `allow_pinned_data=False` 执行，始终忽略 `pinnedData`，从而保证生产触发路径不会使用开发期数据。固定数据也必须通过节点的输出端口声明校验，未知端口不得保存。

## 端口元数据

端口 handle 是工作流连线和执行器使用的稳定内部名称，例如 `success`、`error`、`input`。面向用户的名称应写在 `display_name`：

```python
inputs = {
    "body": Input(
        display_name="请求体",
        required=False,
        description="Request body",
        schema=ANY_JSON_SCHEMA,
    ),
}
outputs = {
    "success": Output(
        display_name="响应",
        description="Response data",
        schema=HTTP_RESPONSE_SCHEMA,
    ),
    "error": Output(
        display_name="错误",
        category="error",
        description="Request error",
        schema=ERROR_SCHEMA,
    ),
}
```

约定：

- `display_name` 是用户首先看到的端口名；内部 handle 只作为技术定位信息保留。
- `schema` 用于拖线校验和运行前校验；能声明就声明。
- `connection_kind` 表示端口连接的用途，省略时为 `"data"`。一条连线两端必须使用相同通道，通道匹配后才会继续检查 `schema`；可使用 `"resource"`、`"tool"`、`"trigger"` 或项目自定义的稳定名称。
- `filter` 可以约束另一端的节点类型。输入端口的 `filter` 匹配上游节点类型，输出端口的 `filter` 匹配下游节点类型；`nodes` 是可选的允许列表，`excludedNodes` 是排除列表。两者同时声明时，排除列表优先。该规则同时由画布连接、边修复候选和后端工作流校验执行。
- `required=True` 的输入端口必须被有效连接。
- `Input(max_connections=None)` 表示输入端口可接多条线；省略时输入端口默认为单连接。输出端口默认可扇出，只有显式声明 `Output(max_connections=...)` 时才限制可连接的下游数量。
- `data_mode="items"` 表示输入端口接收标准执行数据项列表；省略时为 `"value"`，保持原始 JSON 输入兼容。该设置只影响节点执行时的输入形状，不限制它连接旧节点或新节点的输出。
- `category="error"` 只表示错误分支的产品展示和路由语义，不会改变默认 `"data"` 通道；错误数据需要连接到普通数据输入时无需另设通道。
- 新增内置节点时，所有输入/输出端口都必须声明 `display_name`。

节点库刷新会在加载时校验静态端口声明：handle 必须匹配 `[A-Za-z_][A-Za-z0-9_]*`；`filter` 仅支持 `nodes` 和 `excludedNodes` 两个字符串数组；`max_connections` 必须为非负整数或 `None`。单个节点违反契约会被隔离并生成 `node_port_contract_invalid` 诊断，其它节点仍可正常加载。

### 动态端口解析契约

动态端口由装饰器元数据和节点实例配置共同决定。`DynamicInputList` / `DynamicOutputList` 是编辑器可见的权威声明，`input_ports()` / `output_ports()` 必须返回与该声明完全一致的完整端口字典：

- 静态端口必须保留，不能改名、删除或修改元数据。
- 动态端口 handle 必须与配置中的 ID 一一对应，不能额外产生未声明端口。
- 动态端口的 `Input` / `Output` 类型、描述、schema、连接类型、过滤器和连接上限必须与动态端口原型一致；只允许根据 `label_key` 写入对应的 `display_name`。
- 解析器应是确定性的纯函数，不应访问网络、凭据或运行上下文。

平台会使用配置模型补齐默认值后调用解析器，并捕获普通 Python 异常。失败时返回静态端口作为可编辑的安全视图，同时在工作流校验中生成 `node_input_port_resolution_failed` 或 `node_output_port_resolution_failed`，阻止错误连接图进入运行阶段。

开发节点包时使用下面的命令提前运行同一套注册和动态端口检查：

```powershell
python -m apps.api.nodeflow_api.node_doctor nodes/my-tools --strict
```

带 `--json` 时可把报告接入 CI。动态端口节点若有配置模型必填项，doctor 无法只靠默认值构造实例时会生成 `node_dynamic_port_default_check_skipped` 警告；为动态端口字段提供可用默认值，或在 CI 中使用 `--strict` 防止未检查的解析器进入交付。

### 节点包运行环境契约

每个 `nodeflow-package.json` 应声明运行环境与第三方分发包要求：

```json
{
  "engines": {
    "nodeflow": ">=0.1.0,<0.2.0",
    "python": ">=3.11"
  },
  "pythonDependencies": [
    "httpx>=0.28",
    "orjson>=3.10; platform_python_implementation == 'CPython'"
  ]
}
```

- `engines` 只接受 `nodeflow` 和 `python`，值使用 `packaging.specifiers.SpecifierSet` 支持的版本范围。
- 包自身的 `version` 必须是有效的 PEP 440 版本。
- `pythonDependencies` 使用 PEP 508 requirement，按分发包名称和已安装版本检查；环境标记不适用时跳过。
- 加载器绝不自动安装或升级依赖。不兼容包在导入任何入口文件前标记为 `failed`，避免模块顶层副作用。
- 省略全部或部分 `engines` 时保持旧包可用，但兼容状态为 `unverified` 并生成 warning；`nodeflow-doctor --strict` 会失败。
- API 的包快照提供 `engines`、`pythonDependencies` 和包含当前 Node Flow/Python 版本的 `compatibility`，前端据此显示中文状态。

稳定诊断代码包括 `package_engine_constraints_missing`、`package_engine_constraints_incomplete`、`package_nodeflow_engine_incompatible`、`package_python_engine_incompatible`、`package_python_dependency_missing` 和 `package_python_dependency_incompatible`。

### 节点包生命周期

项目数据库的 `node_package_settings` 保存第三方包的启用状态和可选 `locked_version`。加载器将该状态纳入自身 fingerprint，因此即使 Python 文件没有变化，API 或 Worker 的下一次 `scan_if_changed()` 也会应用新策略。

- `enabled=false` 时清单仍出现在包快照中，状态为 `disabled`，但不会导入入口、注册节点或凭据类型。
- `locked_version` 与清单 `version` 使用 PEP 440 语义比较；不一致时生成 `package_version_lock_mismatch` 并在入口导入前停止。
- 在 API 中停用包前必须确认当前版本工作流没有使用该包的节点；引用存在时返回 `409` 和工作流、节点位置。
- 更新策略后，正在执行的工作流继续使用其不可变节点快照，后续运行使用新的注册表。
- `nodeflow.builtin` 不接受生命周期修改。doctor 专注检查磁盘中的包内容，不读取项目数据库的启停和锁定状态。

### 节点包安装事务

本地包管理器接收 ZIP 请求体，且一个 ZIP 必须只包含一个 `nodeflow-package.json`。压缩包路径必须使用正斜杠，不能包含绝对路径、`..`、重复路径或符号链接；压缩体、展开体积和文件数量都有上限。清单目录之外不能夹带其他文件。

安装流程保持以下顺序：

1. 解压到项目外侧的 `.nodeflow-packages/staging/`。
2. 使用独立 `NodeRegistry` 完成清单、兼容性、依赖、入口和节点契约预检。
3. 检查包 ID、节点 ID、凭据类型 ID、版本锁、降级和工作流引用。
4. 将旧安装槽移动到备份目录，再把候选目录移动到 `nodes/_installed/` 的确定性安装槽。
5. 使用生产注册表做全局扫描。候选包必须以目标版本完整加载；否则删除候选并原位恢复旧包。
6. 激活成功后把旧目录复制到 `.nodeflow-packages/history/`，同时原子更新当前版本元数据；旧备份会保留到提交点之后，任一步失败仍可回到步骤 4 前的活动版本。

注册表的 `mutation_lock()` 负责当前进程内串行化；`.nodeflow-packages/mutation.lock` 使用 Windows 字节锁或 POSIX `flock`，让多个 API/Worker 进程之间的手动重载、安装、升级、恢复和卸载也只能有一个写入者。租约占用时变更 API 返回 `409 node_package_mutation_busy`，并附带当前操作、PID、主机和获取时间；操作系统会在进程退出时自动释放锁。

每次会改变活动目录的操作还会先写入 `.nodeflow-packages/transactions/tx_*.json`。状态按 `prepared`、目录已移动、候选已激活或已归档、`committed` 推进，并通过临时文件替换原子更新。服务启动以及后续包操作前都会在持有跨进程租约时检查日志：未提交事务一律恢复旧活动版本和元数据，已提交事务完成备份与状态清理。损坏或缺少恢复材料的日志会让启动明确失败，不会猜测并继续加载不确定代码。恢复结果由 `GET /api/node-packages` 的 `recoveries` 返回，编辑器首次加载即显示中文提示。

已经开始的运行仍持有不可变节点快照。API 读取节点目录以及独立 Worker 领取下一次运行前，都会在同一租约下执行 fingerprint 检查并按需重扫，因此其他进程提交的包版本会传播到各自的注册表缓存。文件租约避免并发写入，但不会强行终止正在执行的旧节点代码。

包快照的 `lifecycle.installManaged` 区分安装器包与工作区源码包。只有安装器包可通过 `DELETE /api/node-packages/{package_id}` 删除；工作区包和内置包受保护。升级若移除仍被工作流引用的节点，或卸载整个被引用包，API 返回结构化 `409` 及引用位置。

每个历史修订由不可变包目录和 `metadata.json` 组成，记录修订 ID、包 ID、版本、来源文件、安装时间、归档时间与内容 SHA-256。读取和激活时都会校验元数据及目录内容；内容变化时返回 `node_package_revision_corrupt`，不会尝试导入。每个包保留最近 10 个修订，卸载包时一并清除。

`GET /api/node-packages/{package_id}/revisions` 只对安装器管理的活动包开放。`POST /api/node-packages/{package_id}/revisions/{revision_id}/activate` 会把历史目录复制到暂存区，再走与 ZIP 安装一致的预检和激活事务。该入口允许明确降级，但不绕过 `locked_version`、节点/凭据 ID 冲突和工作流引用保护；恢复前的当前版本也会成为新的历史修订。

## 运行参数与业务配置档

`workflow.parameters` 在主流程中声明唯一的运行输入契约。`fields` 每项支持 `name`、`label`、`type`、`required`、`default`、`options` 和 `description`；类型为 `string`、`file`（服务端文件路径）、`integer`、`number`、`boolean`、`date`、`json`。`input_path` 留空读取调用输入，可填写 `body` 等对象路径适配 Webhook。参数节点不能放在循环体，不能声明重复名称或敏感字段。

手动运行先显示参数表单。所有入口创建运行时，都在持久队列入队前完成参数校验并保存解析后的快照。运行参数节点 v2 仅为每个声明的参数提供同名动态输出端口，没有整包 `success` 输出；没有参数时没有输出端口。v1 配置迁移保留字段定义，旧图若连接了整包端口，需要改接具体字段端口。`success` 继续保留为参数名称禁用值，防止旧连线被误认成同名字段。参数也可通过 `{{ run_parameters.name }}` 引用。运行输入通过已有 `initial_input` 传入。字段默认值只在未传入时采用，不能代替凭据。环境、并发和总超时继续由平台调度配置管理。

节点包可在节点类声明 `profile_type = ProfileType(id, name, model, credential_type_ids)`；`model` 为 Pydantic 模型，节点配置必须声明字符串 `profile_id`。同一类型在多个节点上的声明必须一致。平台通过 `/api/profile-types` 暴露配置 Schema，在资源中心生成表单；`/api/profiles` 提供创建、读取、完整更新和删除。配置档的 `data` 只存非敏感配置，`credential_id` 单独引用凭据库。不能把密码、令牌或密钥放入配置档和运行参数。

`profile_id` 可以是固定 ID，也可以使用 `{{ project.connection }}` 选择环境中的配置档 ID。入队时只保存工作流引用的配置档快照和凭据 ID；运行节点通过 `ctx.profile` 读取配置档，通过 `ctx.get_credential(ctx.profile["credential_id"])` 读取经环境映射后的凭据。排队后修改配置档或环境不影响已有运行，重试保留原快照。凭据值不进入快照，执行时从凭据库读取。配置档被当前工作流引用、凭据被配置档引用时不能删除。未能静态解析的动态配置档引用会保守阻止删除。

`ctx.get_or_create_run_resource(key, factory)` 仅用于同一运行内共享客户端、会话等私有技术资源，不进入表达式上下文、事件或跨运行状态。业务任务、处理结果和失败信息必须通过端口传递，不能用资源字典、全局变量或跨运行状态替代连线。节点包负责资源的线程安全；有持久资源的 Adapter 应明确关闭资源。A3 包使用独立 HTTP 请求，不保持需要关闭的 HTTP 客户端。

需要同时支持枚举或数字类型与运行表达式的配置字段，可使用 SDK 的 `ConfigExpression` 联合类型，例如 `Literal["preview", "save"] | ConfigExpression`。保存时校验表达式语法，执行器先解析表达式，再由原配置模型校验实际值。

可能产生不可幂等外部写入的节点应声明 `retry_safe = False`。平台拒绝这类节点的自动重试策略；一次运行若已开始执行此类节点，也不能直接重试整个流程，必须先核对外部结果。该保护不提供分布式事务或自动断点续跑，外部系统已经成功的写入不会随工作流失败回滚。

## 表格数据与循环边界

### 工作流配置与节点绑定

`settings.configuration` 声明本工作流的固定非敏感配置，采用与运行参数相同的名称、标签、类型和默认值结构。设置界面独立管理这些值；画布端口继续表达业务数据流。凭据仍只在凭据库保存，不能写入工作流配置。

每个节点的 `configBindings` 独立于 `config` 存储，键为配置目标路径（如 `options.default_warehouse`），值为 `{ "source": "workflow", "key": "default_warehouse" }` 或 `source: "parameter"` 的运行参数引用。目标必须存在于节点配置 Schema，不能重叠，也不能绑定决定动态端口的字段。保存时校验引用和已知类型；尚无值的运行参数在启动时校验，缺失或不兼容时明确失败。

平台在入队时保存工作流配置快照，执行前解析绑定并校验，Python 节点继续接收普通类型化 `self.config`，不需要读取平台配置字典或修改 execute 签名。绑定值是数据，不会作为双花括号表达式再次执行。循环使用所属工作流的配置；调用其他工作流时使用被调用工作流自己的配置，重试保持原快照。旧工作流缺省配置和绑定为空，旧节点及旧连线继续可用。固定配置、运行参数、数据输入和运行策略分别管理，不新增公共可变缓存。

`nodeflow_sdk.datasets.RecordDataset` 定义文件无关的表格输入：`headers: string[]`、`rows: object[]`、可选 `line_numbers: integer[]`。行号必须与行一一对应；未提供时从 2 开始。读取、格式解析与业务校验分离：`data.csv_read` 从 `path` 输入端口读取文件路径，未连接时兼容固定路径配置，输出数据集和逐行数据项。`encoding=auto` 支持 UTF-8 BOM 和 GB18030；数据集携带来源行号。业务节点接收数据集，不应重新读取路径。同一契约也可由 HTTP、表格或其他来源构建。

`control.each_item.items` 接收数组，`control.foreach` 保留表达式入口。两者的循环体都可放置 `control.loop_input` 和一个 `control.loop_output`，业务节点只需连接普通输入输出：循环输入的 `item` → 业务处理 → 循环结果的 `value`。边界节点只能放在逐项循环体中；嵌套循环有各自的边界。

包含循环结果节点时，外层 `results` 输出按输入顺序排列的公共结果数组（Schema 见 `nodeflow_sdk.loops.LOOP_RESULTS_SCHEMA`）：

```json
[
  {"index": 0, "item": {"id": "a"}, "status": "succeeded", "output": {"value": 1}},
  {"index": 1, "item": {"id": "b"}, "status": "failed", "error": "处理失败"}
]
```

`output` 保留 `null`、`false`、`0` 等值。开启 `continue_on_error` 时保留失败项并处理后续项；未开启时中断循环。某项未到达结果节点（包括被分支跳过或节点错误策略继续）也算失败，不能复用上一项输出。空数组输出空结果。旧循环没有结果节点时保持原有 `done` 行为；连接 `results` 必须先配置结果节点。循环的技术上下文由引擎维护，业务节点不应自行读取 `loop.item` 或查找其他节点的隐式结果。

A3 采购包 0.3 的任务、查询、汇总节点为 v2：任务节点接收 `dataset` 并分别输出 `tasks`、`input_failures`；查询必须显式连接 `task`；汇总接收 `results`、`input_failures`。v1 配置迁移只迁移配置字段，完整工作流还必须按新端口重新连线，不能直接把旧图的版本号改成 2。采购示例已完成该结构迁移。

## 平台级预演

`WorkflowSettings.run_mode` 指定默认方式：`live` 或 `preview`。缺省为 `live`，兼容已有工作流。手动创建运行可在请求顶层覆盖 `run_mode`；业务 `initial_input` 中的同名字段不能覆盖策略。`RunInvocation.run_mode` 在入队时固化，Worker 重启、失败重试以及后续修改工作流默认方式都不改变已有运行。`execution_mode` 仍表示手动、Webhook、调度等来源，不承担预演语义。

子运行（包括错误处理工作流）强制继承父运行方式，不能降级为正式执行。循环在相同运行策略下执行。预演允许读取输入和声明为只读的远端查询，不使用画布固定输出替代执行；不提交根运行或子运行暂存的跨运行业务状态。运行日志和操作计划仍持久化。

节点通过 SDK 声明 `effect = "pure" | "read" | "write" | "unknown"` 和 `preview_support = "execute" | "plan" | "unsupported"`。默认未知且不支持预演，保留旧节点的正式执行行为。只有纯计算和只读节点可声明直接执行；有副作用的节点必须实现 `preview(ctx, inputs) -> PreviewResult`，并从只读属性 `ctx.run_mode` 查看策略。声明错误或声称支持但没有实现预演时，加载器报错。

创建手动预演运行前，以及 Worker/执行器开始执行前，会检查整个工作流、循环体和可确定目标的子工作流；不支持预演、递归调用或动态目标无法提前确定时明确拒绝，不回退到正式执行。检查是对可信节点代码所声明契约的验证，不是 Python 进程沙箱。

`PreviewResult.effects` 是 `PlannedEffect(operation, target, details, description)` 元组；`outputs` 仍使用原节点端口契约。默认 `complete=False`，表示无法生成真实执行所需的输出，执行器不运行其后续节点，记录 `node_not_verified`。不能伪造单据 ID、HTTP 成功响应或已写入路径来继续后续流程。只有节点能提供有明确预演语义的完整输出时才声明 `complete=True`。例如 A3 返回待提交 Payload、`status=previewed` 和空单据 ID，而不声称制单成功。

运行记录保留原有状态并新增 `run_mode` 和 `preview_status`（成功预演为 `complete` 或 `partial`）。`complete` 只表示可预演范围完成，不代表外部写入成功。时间线中的 `node_previewed` 包含操作计划；`node_not_verified` 标记缺少真实依赖的步骤，运行详情提供操作计划视图。循环中的此类条目以 `status=unverified` 返回，不能计作成功或执行失败。

内置 HTTP 节点增加 `operation` 声明：默认 `unknown`，预演只生成请求计划，不登录、不发请求。显式 `read` 才允许真实查询，支持用 POST 查询的系统；不能只用 HTTP 方法推断副作用。`write` 始终生成计划。文件报告与 Webhook 响应在预演中仅生成计划。其他内置计算、控制、参数和数据读取节点声明对应能力。

A3 包 0.4 新增普通业务节点 `a3.purchase_submit`，由平台策略控制保存或预演，配置只含配置档 ID。旧 `a3.purchase_save` 的节点级 `mode` 行为保持兼容；在平台预演下，即使其旧配置是 `save` 也只生成计划。新工作流使用 `a3.purchase_submit`，不在业务参数里声明预演开关。

## 兼容性

### 可配置数据处理与节点包模板

`data.records_prepare` 接收文件无关的 `dataset` 和可选 `options`，按 `columns` 配置执行字段映射、类型转换与校验，输出包含原始行号和错误的记录。`data.records_group` 使用一份 `common_fields` 公共字段规则：每项包含 `name`、可选显示名 `label`、`on_difference`（`split` 差异拆组 / `error` 差异时报错）、`allow_empty` 和 `emit`（是否输出到 `header`，默认 true）。拆组字段共同确定分组；报错字段检查组内一致性；全部设为报错时所有记录归为一组。`unique_items` 独立校验组内明细唯一性。旧版 `by` / `header_fields` / `optional_keys` 及其绑定仍按原语义读取，版本保持 v1；新配置只写 `common_fields`。旧配置转换保留仅分组字段的 `emit=false` 和原空值策略，保持下游输出结构。包含无效记录的整组只输出到 `failures`，不能把有效子集当作完整单据。

`data.compose` 仅从 `input`、`context`、`options` 输入端口取得数据；配置 `rules` 顺序计算中间字段，`fields` 组装输出对象，未配置 `fields` 时计算 `output`。规则可以声明 `each`、集合内部 `rules` 和 `fields`。集合内部变量为 `item` / `index`；不读取其它节点输出、运行参数或共享业务状态。表达式由受限 AST 解释器处理，有计算预算，不使用 Python eval；数据函数集中在 `nodeflow_sdk/data_recipes.py`。金额计算使用有限 Decimal，输出精确小数文本。`data.batch_summary` 汇总失败与循环结果，保留未验证条目，不把预演计划当作保存成功。

表单控件 `column_rules` 和 `mapping_rules` 分别编辑字段转换规则和递归对象/集合规则。配置仍是普通 JSON，界面使用可展开的字段表单；规则表达式使用自己的局部变量语法，不使用平台的双花括号运行表达式。节点设置 `resolve_config_expressions=False`，这些规则不会在执行前被平台错误替换。

节点包清单可声明 `templates: ["templates/example.json"]`，纯模板包允许 `nodeEntrypoints: []`。模板文件必须位于包内。`GET /api/node-templates` 返回节点库资源，其中包资源只来自已加载包，并检查引用节点和配置。模板类型为 `node`（`node` 字段）、`subflow`（`graph` 字段）、`workflow`（`workflow` 字段）。插入时复制配置并重新生成节点/连线 ID；工作流模板只插入空白工作流且强制预演，循环体模板只填充尚无业务节点的循环体，不覆盖已有编排。

节点库也支持用户资源：在“预设”页保存选中节点，在“模板”页保存当前工作流或当前循环体。`POST /api/node-templates` 校验节点契约、连线、配置引用与非敏感值后写入独立的 SQLite `user_templates` 表；`GET /api/node-templates` 合并返回用户资源（`source=user`）和包资源（`source=package`）。包文件不被改写，同名保存创建新资源。固定输出与运行数据不进入副本，工作流模板强制预演且停用自动触发。账号仅保留凭据/配置档 ID。

预设和循环体模板的 `configuration`、`variables` 携带配置依赖，`parameters` 声明运行参数要求。插入前检查同名配置冲突及参数类型，缺少参数时提示先在目标工作流声明；不偷偷创建运行参数节点。新增配置复制到目标工作流，已有不同配置明确拒绝覆盖。添加后的节点和配置可独立编辑，修改不会回写已保存资源。

个人资源可通过节点库菜单编辑内容、重命名或删除；包资源在界面和服务端均只读（修改返回 403）。`PUT /api/node-templates/{id}` 更新内容，`PATCH` 更新名称和说明，均要求 `expected_revision`；旧资源缺省修订为 1，成功后递增，过期修订返回 409。更新保留资源 ID 和创建时间，使用数据库原文条件更新防止多进程覆盖。`DELETE` 只移入回收站，默认列表隐藏；`GET ?include_deleted=true` 和 `POST /{id}/restore?expected_revision=N` 支持恢复，同样检查修订。

编辑内容使用独立画布草稿，保留原工作流的未保存内容、选择和循环位置；保存或放弃后完整恢复。编辑期间不提供运行或保存工作流入口，状态层也拒绝这些操作。保存仅更新节点库资源，已有工作流副本不受影响。新建资源的保存操作放在节点配置面板、循环体所属节点面板和工作流设置中；节点库负责查找、添加和管理。

A3 采购包 0.6 以这些通用节点提供预设与模板，不依赖 a3-tool。旧 `a3.*` 节点留在独立的 `a3.purchase.compatibility` 包，节点契约保持兼容，默认从节点库隐藏，可显示旧版兼容节点。请求和登录均由 HTTP 节点及 HTTP 配置档负责；纯数据节点没有 A3 特判。固定采购选项迁入工作流设置，通过独立绑定注入映射节点，移除单独的选项节点；账号迁移为加密的 HTTP 登录凭据，旧资源和工作流历史保留。`data.records_prepare` 的 `options` 配置支持绑定，连接同名输入时仍以输入为准，兼容旧图。

HTTP 节点可配置 `response_checks`（`path`、`in`、`message`）把业务错误转为错误输出；认证配置可声明 `login.reject_when` 和 `refresh_on`，认证字段只留在运行内会话中。会话按系统 origin、凭据和认证策略共享，不按业务请求路径拆分；同一会话的登录串行。SDK 的 `can_retry(config)` 默认继承静态 `retry_safe`，HTTP 根据操作语义判断重试安全性，正式写入已开始后不允许整体重试。

不要为了中文显示改动 workflow JSON 的 `sourceHandle`、`targetHandle` 或节点类型 `id`。这些值是稳定存储契约。产品化展示应通过 API 返回的 `displayName` 字段完成。
