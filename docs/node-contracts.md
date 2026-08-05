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

## 兼容性

不要为了中文显示改动 workflow JSON 的 `sourceHandle`、`targetHandle` 或节点类型 `id`。这些值是稳定存储契约。产品化展示应通过 API 返回的 `displayName` 字段完成。
