# 声明式节点表单契约设计

## 目标

让 Python 节点在声明运行配置模型的同时，可声明稳定、可复用的产品界面元数据。节点作者能控制字段分组、顺序、控件、选项、条件显示、表达式支持和凭据选择；工作流编辑器统一渲染这些信息，不为每个节点编写专用前端。

首个迁移节点为 `http.request`。它应展示操作选择、条件字段和现有本地凭据选择能力，证明该契约可支撑后续通用集成节点。

## 不变条件

- 已保存 workflow 的 `node.config` 仍为普通 JSON；本阶段不修改其字段名、结构或版本格式。
- Pydantic `config_model()` 和后端 `model_validate(..., extra="forbid")` 仍是配置正确性的唯一权威。`uiSchema` 不参与运行时配置放行。
- 没有声明表单元数据的旧节点继续由现有 JSON Schema 自动表单渲染。
- 无法识别的 UI 控件、无效条件和缺失选项不得阻止节点注册或工作流运行；前端安全降级到自动表单，同时节点包诊断给出中文提示。
- `sourceHandle`、`targetHandle`、节点类型 ID、配置键和端口语义保持兼容。

## Python 节点声明

`@node(...)` 增加可选 `form` 参数，类型为不可变的 `NodeForm`。它属于产品元数据，和 `inputs`、`outputs` 一样由节点注册表发往前端。

```python
from nodeflow_sdk import (
    BaseNode,
    FormCondition,
    FormField,
    FormGroup,
    NodeForm,
    SelectOption,
    node,
)


@node(
    id="http.request",
    name="HTTP Request",
    category="Network",
    form=NodeForm(
        groups=(
            FormGroup(
                id="request",
                label="请求",
                fields=(
                    FormField("method", control="select", options=(
                        SelectOption("GET", "GET"),
                        SelectOption("POST", "POST"),
                    )),
                    FormField("url", control="url", placeholder="https://api.example.com/users"),
                    FormField(
                        "body",
                        control="json",
                        visible_when=FormCondition("method", one_of=("POST",)),
                    ),
                ),
            ),
        ),
    ),
)
class HttpRequestNode(BaseNode[HttpRequestConfig]):
    pass
```

### 模型

`NodeForm`：

- `groups: tuple[FormGroup, ...]`，按声明顺序显示。

`FormGroup`：

- `id`：节点内稳定、唯一的技术标识。
- `label`：中文用户可见名称。
- `description`：可选帮助文字。
- `fields`：按声明顺序显示的字段。
- `visible_when`：可选条件，控制整个分组。

`FormField`：

- `key`：必须对应 Pydantic 配置模型的顶级字段。
- `control`：`text`、`textarea`、`password`、`number`、`switch`、`select`、`json`、`url` 或 `credential`。
- `label`、`description`、`placeholder`：可选展示覆盖；未设置时继承 JSON Schema。
- `options`：仅 `select` 使用，提供稳定值与显示名称。
- `visible_when`：可选条件。
- `expression`：`allowed`、`disabled` 或 `required`，默认由现有表达式能力决定；本阶段仅定义元数据和 UI 提示，不改变表达式求值规则。
- `credential_type_ids`：仅 `credential` 使用，筛选一个或多个现有凭据类型；为空时按节点可用凭据类型筛选。

`FormCondition`：

- `field`：同一配置对象的顶级字段。
- `equals`、`one_of` 或 `not_empty` 三者之一。
- 不支持嵌套布尔表达式、远端数据或运行时条件；避免前端与 Pydantic 条件校验出现两套难以维护的语言。

表单字段不能新增 Pydantic 未声明的配置键，也不能隐藏所有必填字段。注册期会校验可静态发现的错误；条件导致的必填约束仍由 Pydantic 及节点模型负责。

## API 与注册表

`RegisteredNodeType.to_api_dict()` 在现有 `configSchema` 同级返回可选 `form`：

```json
{
  "id": "http.request",
  "configSchema": { "type": "object" },
  "form": {
    "groups": [
      {
        "id": "request",
        "label": "请求",
        "fields": [
          { "key": "method", "control": "select", "options": [{ "value": "GET", "label": "GET" }] }
        ]
      }
    ]
  }
}
```

`/api/node-types` 与 reload 响应格式保持数组结构，`/api/node-packages` 不变。未知控件、未声明字段、重复 group/field ID、错误条件或无效凭据类型记为 `node_form_invalid` 诊断；该节点仍可注册，但不输出 `form` 元数据。

## 前端渲染

新增纯函数模块：

- `nodeForm.ts`：验证传入的表单描述、计算每个组和字段的可见性、决定是否安全降级。
- `NodeConfigForm.tsx`：基于 `NodeType.configSchema`、`NodeType.form`、节点当前配置和凭据列表渲染表单。

`ConfigPanel` 继续拥有标签、端口、运行详情、固定数据和错误策略；配置标签页改为调用 `NodeConfigForm`。表单按 group 渲染，无卡片嵌套。每个控件复用已有无障碍标签、必填提示、字段错误和表达式插入能力。

渲染决策：

1. 无 `form`：完整使用现有 JSON Schema 自动表单。
2. 有效 `form`：按其 group 和 field 顺序渲染；未被 `form` 列出的 JSON Schema 字段在“其他参数”区域保留，防止新增后端字段消失。
3. 无效 `form`：完整回退到自动表单，并显示简短中文提示；不会隐藏配置或阻止保存。
4. `credential`：只显示匹配 `credential_type_ids` 的摘要，保存的仍是原配置字段中的凭据 ID；凭据明文永不进入表单值或浏览器响应。

表达式插入：字段声明 `expression="disabled"` 时不显示引用插入入口；其他字段沿用当前格式。`password` 字段默认关闭表达式插入。

## HTTP 请求节点迁移

`http.request` 保持现有 Pydantic 配置和执行语义。其 `form` 声明三组：

1. “请求”：方法、URL、超时。
2. “内容”：请求体和请求头；请求体仅在 `POST`、`PUT`、`PATCH` 时显示。
3. “认证”：按节点白名单筛选的本地凭据选择。

若当前节点包含过去版本遗留的字段，自动表单的“其他参数”仍应呈现并允许修正；保存时仍由现有清理和 Pydantic 校验处理。

## 错误处理与兼容

- SDK 在构建 `NodeForm` 时只做可本地发现的值范围检查，保持节点模块导入错误易读。
- 注册表在编译节点元数据时交叉检查配置模型字段；错误隔离为节点包诊断，不让一个节点的 UI 描述阻塞其他节点。
- 前端不信任 API 的 `form`；运行 `nodeForm` 的守卫校验，失败即回退。
- 后端验证不会从 UI 条件推导 required 规则；条件字段的最终合法性始终由 Pydantic validator 统一表达。

## 测试与验收

后端：

- SDK 序列化表单、选项和条件。
- 注册表对有效 `form` 返回 API 元数据。
- 未声明配置键、重复字段、未知控件、错误条件隔离为诊断，节点运行配置仍可使用。
- `http.request` 的原有配置、运行和凭据选择回归测试通过。

前端：

- 可见性纯函数覆盖 `equals`、`one_of`、`not_empty` 和失效回退。
- `NodeConfigForm` 渲染分组、选择控件、条件字段、凭据筛选、未列出字段和表达式开关。
- `ConfigPanel` 保持旧节点自动表单兼容。
- HTTP 节点在方法切换时正确显示/隐藏请求体，并保持已输入值。

浏览器验收：

1. 新建 HTTP 请求节点，确认“请求 / 内容 / 认证”分组均为中文。
2. 方法从 `GET` 切为 `POST`，请求体出现；切回后隐藏但不丢失值。
3. 选择凭据后只显示符合类型的凭据名称，不显示秘密。
4. 选择未迁移节点，仍可使用既有自动表单并保存、运行。

## 非目标

- 在线编辑 Python 节点代码。
- 任意 JavaScript 表达式、远端动态下拉选项或插件执行前端代码。
- 多层嵌套表单、数组构造器和可视化映射编辑器；这些在有真实节点需求时以独立契约扩展。
- 改写旧工作流 JSON、端口契约或凭据加密机制。
