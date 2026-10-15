# 节点开发指南

Node Flow 的节点是 `nodes/` 目录下的 Python 类，通过 `nodeflow_sdk` 的 `@node(...)` 装饰器注册。后端启动时会扫描节点目录，节点配置由 Pydantic 生成 JSON Schema，并在前端自动渲染成配置表单。

本文是上手教程。端口、动态端口、包生命周期与安装事务等规范性约定见[节点契约说明](node-contracts.md)。

- [最小节点](#最小节点)
- [注册与元数据](#注册与元数据)
- [输入与输出端口](#输入与输出端口)
- [声明式配置表单](#声明式配置表单)
- [凭据](#凭据)
- [跨运行状态](#跨运行状态)
- [执行数据项](#执行数据项)
- [节点版本升级](#节点版本升级)
- [本地节点包](#本地节点包)
- [自检与 CI](#自检与-ci)

## 最小节点

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

节点实现 `async def execute(self, ctx, inputs)`，并返回以输出端口名为键的字典。如果返回了未声明的输出端口，运行器会把它当成节点实现错误处理，避免工作流在隐式数据形状下继续运行。

## 注册与元数据

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

`id` 是稳定的内部类型标识，保存到 workflow JSON；`name`、`category`、`description`、`icon`、`tags` 和 `keywords` 面向产品界面和搜索。内置节点偏测试场景，但这些字段应保持通用，不要把底层模型写死为测试工具。

## 输入与输出端口

端口 handle 是工作流连线和执行器使用的稳定内部名称；面向用户的名称写在 `display_name`：

```python
from nodeflow_sdk import BaseNode, Input, NodeConfig, NodeContext, Output, node


@node(id="demo.add_one", name="Add One", category="Demo")
class AddOneNode(BaseNode[NodeConfig]):
    inputs = {
        "input": Input(
            display_name="数字输入",
            required=True,
            description="数字输入",
            schema={"type": "number"},
        )
    }
    outputs = {
        "success": Output(
            display_name="结果",
            description="加一后的数字",
            schema={"type": "number"},
        )
    }

    async def execute(self, ctx: NodeContext, inputs: dict):
        return {"success": inputs["input"] + 1}
```

端口名会成为连线句柄，例如 `success -> input`。常用选项：

| 选项 | 作用 |
| --- | --- |
| `schema` | 拖线校验和运行前校验使用的 JSON Schema。能声明就声明。`integer` 可以连接到 `number`，但 `string` 不能直接连接到 `number`。 |
| `required` | `required=True` 的输入端口必须被有效连接。 |
| `filter` | 约束另一端的节点类型：输入端口的 `filter` 匹配上游，输出端口匹配下游。`nodes` 是允许列表，`excludedNodes` 是排除列表且优先级更高。 |
| `max_connections` | 输入端口省略时为单连接，`None` 表示不限条数；输出端口默认允许多个下游，只有显式声明时才限制扇出。 |
| `data_mode` | `"items"` 表示该输入接收标准执行数据项列表，省略时保持原始 JSON 输入。 |
| `display_name` | 用户首先看到的端口名。新增内置节点时，所有输入/输出端口都必须声明。 |
| `category` | `category="error"` 只表示错误分支的产品展示和路由语义，不改变默认 `"data"` 通道。 |
| `connection_kind` | 端口连接用途，省略时为 `"data"`；一条连线两端必须使用相同通道。 |

只允许特定节点接入时：

```python
inputs = {
    "response": Input(filter={"nodes": ["http.request"]}),
}
outputs = {
    "error": Output(filter={"nodes": ["debug.log"]}),
}
```

这个约束会同时用于画布拖线提示、修复候选、保存前校验和后端权威校验。

汇聚多个上游结果时，把输入端口声明为多连接端口；运行时该输入会收到一个列表，顺序按上游结果到达顺序排列：

```python
inputs = {
    "items": Input(
        required=False,
        display_name="多个上游结果",
        max_connections=None,
    )
}
```

需要按数据项处理上游结果时，与 `data_mode="items"` 组合使用，此时 `inputs["items"]` 始终是 `[{"json": ...}, ...]` 形式的列表。

## 声明式配置表单

节点可以在 `@node(...)` 中可选声明 `form=NodeForm(...)`，描述配置面板的分组、字段顺序、控件类型、中文帮助文本、条件显示、下拉选项和可用凭据类型；编辑器会统一渲染这些元数据，因此新增通用连接器不需要为每个节点再写一套前端页面。

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

支持的控件包括 `text`、`textarea`、`password`、`number`、`switch`、`select`、`json`、`url`、`credential`、`parameter_list` 和 `string_list`。`parameter_list` 用于编辑 SDK `RunParameter` 数组，支持参数增删、排序、类型、默认值、必填项和文本选项；`workflow.parameters` 使用它提供可视化参数定义。`string_list` 将字符串数组显示为可增删的文本行，清空后写入 `null` 以采用默认配置，适用于可选分组字段等列表。`visible_when` 只控制界面显示，不改变 Pydantic 的后端校验规则；配置模型始终是唯一权威。未声明表单或表单描述无效的节点会安全回退到通用 JSON Schema 表单。

## 凭据

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

凭据的存储与脱敏规则见[工作台使用指南](workbench-guide.md#凭据管理)。

## 跨运行状态

Python 节点可以保存少量、可 JSON 序列化的跨运行状态，适合增量同步游标、去重标记和上次成功处理的时间。节点级状态按“工作流 ID + 节点 ID”隔离；工作流级状态由同一工作流中的所有节点共享：

```python
cursor = ctx.get_node_static_data("cursor", None)
ctx.set_node_static_data("cursor", next_cursor)

last_success = ctx.get_workflow_static_data("last_success", None)
ctx.set_workflow_static_data("last_success", {"at": "2026-07-30T10:00:00Z"})
```

也可使用对应的 `delete_node_static_data(...)` 和 `delete_workflow_static_data(...)` 删除键。状态修改会在根运行及其同步子工作流全部成功后一次性提交；运行失败、超时或取消时全部丢弃。错误处理工作流拥有独立事务，因此可在主流程失败后持久化自己的告警或去重状态。并发运行发生版本冲突时，系统会让该运行明确失败，而不会静默覆盖已有状态。

跨运行状态不是凭据存储：不要写入令牌、密码、固定鉴权头或大体积数据。状态值本身不会自动写入运行事件，但节点主动输出或记录它们时仍会出现在运行详情中。

## 执行数据项

节点可以直接输出普通 JSON。需要在批量数据流中保留来源配对关系或二进制描述时，可从 SDK 使用 `execution_item()` 返回标准数据项；运行详情会显示这些 item 及其元数据。下游端口只有显式声明 `Input(data_mode="items")` 时才会收到标准 item 列表，普通旧节点仍按原始 JSON 方式运行。

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

内置“读取 CSV”会通过 `items` 输出为每行产生一个标准数据项。将它连接到“逐项循环”的 `items` 输入后，循环体会依次执行，当前行可用 `{{ loop.item.列名 }}` 读取。这条路径不依赖 CSV 专用执行器，任何能输出 item 列表的 Python 节点都可以接入。

通用数据流可在循环前完成整理：`映射数据项` 用 `{{ item.字段 }}` 为每项构造新对象并保留来源元数据；`筛选数据项` 按字段值比较保留匹配项；`合并数据项` 将多个上游 item 流按到达顺序追加。它们均可直接连接到“逐项循环”的 `数据项` 输入。

## 节点版本升级

节点脚本调整配置模型时提高 `version`，并为每一步迁移提供 `migrate_config`：

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

节点升级在服务端的预览与应用接口，以及历史运行重试时的版本校验，见[服务端行为参考](platform-behavior.md#节点版本升级)。

## 本地节点包

### 可复用业务配置档

配置档类型由节点包通过 SDK 声明，不需要修改平台路由或前端。以下示例声明一份带类型校验的公共配置，并引用已有凭据类型：

```python
from nodeflow_sdk import BaseNode, NodeConfig, ProfileType


class ServiceSettings(NodeConfig):
    base_url: str
    region: str = "default"


class RequestConfig(NodeConfig):
    profile_id: str


class ServiceNode(BaseNode[RequestConfig]):
    profile_type = ProfileType(
        "example.service", "示例系统", ServiceSettings, ("http.bearer",)
    )

    async def execute(self, ctx, inputs):
        settings = ServiceSettings.model_validate(ctx.profile["data"])
        credential = ctx.get_credential(ctx.profile["credential_id"])
        # 在 Adapter 内使用 settings 与 credential，不输出凭据或登录令牌。
        return {"success": {"region": settings.region}}
```

实际节点仍需 `@node(...)` 注册和完整的端口声明。同一类型可供多个节点共享，平台从节点元数据生成资源表单和配置档选择器。业务配置档、运行参数、私有会话与跨运行状态各有用途，详细约定见[运行参数与业务配置档](node-contracts.md#运行参数与业务配置档)。完整实例见 `nodes/a3_purchase/purchase.py` 和 `examples/a3_purchase/`。

除了直接放在 `nodes/` 下的单个 Python 脚本外，也可以用本地节点包组织可复用连接器。一个包目录放置 `nodeflow-package.json`，只会加载 `nodeEntrypoints` 明确声明的入口文件：

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

`engines.nodeflow` 与 `engines.python` 使用 Python 标准版本范围语法；`pythonDependencies` 使用 PEP 508 分发包依赖语法，也支持环境标记。加载器只检查当前环境，不会自动执行 pip 安装。Node Flow/Python 版本不兼容、依赖缺失或已安装版本不满足时，整个包会在执行入口顶层代码之前停止加载，并返回稳定诊断。旧清单省略 `engines` 时仍可加载，但兼容状态为“未验证”，doctor 的 `--strict` 会将该警告视为失败。

`credentialTypes` 是可选数组。每个类型的 ID 在当前项目必须唯一，字段必须声明 `id`、中文 `label` 与是否为敏感字段的 `secret`，`nodeTypeIds` 只能引用该包已成功加载的节点。类型冲突或错误声明只会让该类型被跳过并记录包诊断，不会阻止包内其他正确节点加载。

本地节点包会执行 Python 模块顶层代码，因此与 `nodes/` 下的脚本一样属于受信任的本地开发者代码。ZIP 导入不会自动执行 pip 安装；依赖必须事先存在于当前 Python 环境。当前不提供在线市场、远程下载、包签名校验或代码沙箱。

### 节点包管理

节点包通过接口读取与管理。`GET /api/node-packages` 返回最近一次扫描的包快照、运行环境要求、兼容状态、生命周期与诊断，包快照用中文状态区分“兼容”“未验证”“不兼容”“已停用”和“版本待确认”。相关操作：

- 节点包状态区的“导入 ZIP”可以安装或升级一个包含单一清单的本地节点包。导入前会提示该包将执行受信 Python 代码。
- ZIP 会先在隔离暂存目录做路径、大小、清单、兼容性、依赖、节点、端口、表单和凭据类型预检，通过后才进入 `nodes/_installed/`。
- 升级会拒绝降级、工作区同 ID 包覆盖、版本锁冲突、节点 ID 冲突，以及删除仍被工作流引用的节点。激活后若全局扫描失败，会自动恢复原版本。
- 安装器会为成功升级或重装前的活动版本保留最多 10 个历史修订。展开包后点击“历史版本”可查看版本、归档时间和原始 ZIP 文件名，并主动恢复。
- 主动恢复允许从新版本回到已归档旧版本，但仍会重新预检内容并执行版本锁、节点冲突和工作流引用检查；当前活动版本会先归档，因此恢复操作本身也可追溯。
- 安装、升级、恢复、卸载和手动扫描共享跨进程文件租约；另一个 API 或 Worker 正在变更节点目录时，API 返回结构化 `409 node_package_mutation_busy`，不会并发改写安装槽。
- 每次目录切换都会写入 `.nodeflow-packages/transactions/` 原子事务日志。服务异常退出后，下次启动会恢复未提交操作或完成已提交清理，并在节点包状态区显示中文恢复提示。
- 只有通过安装器导入的包显示“卸载”，卸载前同样检查工作流引用；`nodes/` 中手写的工作区包和内置包不会被安装器删除。
- “启用节点包”只影响后续扫描和运行；已经开始的运行固定使用启动时节点快照。停用前会检查当前工作流引用，仍被使用时返回具体工作流与节点位置。
- “锁定当前版本”把包版本写入项目数据库。清单升级后若与锁定版本不同，入口不会被导入，需接受新版本或恢复原文件。

相关 API：

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/node-packages/install?filename=...` | 安装或升级节点包，请求体是 ZIP。 |
| `DELETE /api/node-packages/{package_id}` | 卸载安装器管理的包。 |
| `PUT /api/node-packages/{package_id}/settings` | 完整提交 `enabled` 与 `locked_version`。 |
| `GET /api/node-packages/{package_id}/revisions` | 列出历史修订。 |
| `POST /api/node-packages/{package_id}/revisions/{revision_id}/activate` | 恢复指定历史修订。 |

内置包由平台管理，不允许停用或单独锁定。API、嵌入式执行器和独立 Worker 读取同一份 SQLite 策略；各进程在读取节点目录或领取任务前会通过 fingerprint 检测并加载其他进程已经提交的包变更。

包的启用/停用、版本锁定、ZIP 安装与升级、历史修订恢复等生命周期和事务语义见[节点契约说明](node-contracts.md#节点包生命周期)。

## 声明预演能力

纯计算节点声明 `effect = "pure"`、`preview_support = "execute"`；读取文件或查询远端的节点声明 `effect = "read"`、`preview_support = "execute"`。有副作用的操作实现统一预演接口：

```python
from nodeflow_sdk import BaseNode, NodeConfig, NodeContext, PlannedEffect, PreviewResult

class CreateResourceNode(BaseNode[NodeConfig]):
    effect = "write"
    preview_support = "plan"

    async def preview(self, ctx: NodeContext, inputs: dict) -> PreviewResult:
        return PreviewResult(effects=(
            PlannedEffect("create_resource", "target-system", inputs),
        ))

    async def execute(self, ctx: NodeContext, inputs: dict):
        # Implement the actual operation here; the preview path never calls it.
        raise NotImplementedError
```

预演方法不能执行自己声明的写入；应复用无副作用的参数解析、业务校验与请求组装逻辑。默认不返回业务输出，后续依赖真实结果的节点标为未验证。可以提供有明确预演语义的输出时，填入 `outputs` 并设 `complete=True`，不得伪造真实 ID。SDK 的 `ctx.run_mode` 来自持久运行快照，不能由业务输入或节点赋值覆盖。未知或尚未适配的节点仍可正式执行，但预演会在开始前被拒绝。详见[平台级预演契约](node-contracts.md#平台级预演)。

## 自检与 CI

节点包接入编辑器前可以运行与正式加载链路一致的自检：

```powershell
# 检查整个节点目录
pnpm doctor:nodes

# 只检查一个节点包
python -m apps.api.nodeflow_api.node_doctor nodes/acme-tools

# CI 使用机器可读输出，并把无法完成的默认动态端口检查也视为失败
python -m apps.api.nodeflow_api.node_doctor nodes/acme-tools --json --strict
```

自检会先检查 Node Flow/Python 兼容范围和已安装的 Python 分发包，再加载入口并校验节点 ID、静态与动态端口、声明式表单、凭据类型及默认动态端口解析器。普通输出使用中文摘要；`--json` 返回稳定字段。退出码 `0` 表示通过，`1` 表示发现契约错误（或严格模式下存在警告），`2` 表示目标路径或命令参数无效。入口脚本没有注册节点、单文件脚本加载失败等问题也会给出具体诊断。

动态端口节点需要同时声明 `DynamicInputList` / `DynamicOutputList`，并实现对应的 `input_ports()` / `output_ports()`。解析器返回的是该节点实例的完整端口集合：必须保留静态端口，动态句柄及元数据必须与装饰器声明和当前配置一致。完整约定见[动态端口解析契约](node-contracts.md#动态端口解析契约)。
