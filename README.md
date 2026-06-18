# Node Flow

Node Flow 是一个个人工作流节点编辑器。前端使用 React Flow，后端使用 FastAPI；`nodes/` 目录里的 Python 类通过 `@node(...)` 装饰器注册后，会自动变成可拖拽、可配置、可执行的工作流节点。

当前定位是个人测试自动化工作台：先服务单人开发者使用，重点覆盖接口测试、数据驱动测试、断言、循环和运行结果检查。

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

打开 `http://127.0.0.1:5173`。

## 基本使用

1. 在左侧节点库中拖拽节点到画布，也可以点击节点按钮快速添加。
2. 在画布中连接节点端口，例如把 `手动触发.success` 连接到后续节点输入。
3. 点击节点后，在右侧配置面板填写参数。
4. 点击“验证”检查节点类型、端口、配置和表达式语法。
5. 点击“运行”保存并执行工作流。
6. 运行中可以点击“取消”。取消是协作式的：不会强杀正在执行的 Python 节点，但当前节点返回后会停止后续节点和循环迭代。
7. 在底部运行日志查看事件；点击节点事件后，右侧“运行详情”会显示状态、耗时、输入、输出、日志、错误和循环范围。

节点运行状态包括：等待、运行中、成功、失败、已跳过、已取消。工作流运行状态包括：排队中、运行中、成功、失败、已取消。

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
{{ loop.item.username }}
{{ nodes.request.outputs.success.status_code }}
{{ variables.token }}
```

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
2. 选择“CSV 参数化接口测试”模板，或手动连接 `读取 CSV -> 遍历循环`，并在循环体里连接 `HTTP 请求 -> 断言 -> 记录测试结果`。
3. 点击 `读取 CSV` 节点，填写 CSV 文件路径，确认分隔符和表头设置。
4. 点击 `遍历循环` 节点，把循环输入指向 CSV 读取结果；循环体中的 HTTP 请求可以通过 `{{ loop.item.column_name }}` 引用当前行字段。
5. 循环结束后连接 `测试汇总 -> 写入测试报告`，运行完成后在底部“测试报告”查看用例通过、失败和未知结果。

运行与排查：

- 点击“运行”保存并执行当前工作流；运行中可点击“取消”停止后续节点和循环迭代。
- 底部面板的“测试报告”用于查看汇总和每条用例结果。
- 底部面板的“运行事件”用于查看节点级事件；点击事件后，右侧“运行详情”会显示输入、输出、日志、错误和循环范围。

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
- 分布式 worker 或独立任务队列。
- 生产级密钥管理。
- 工作流发布、回滚和环境管理 UI。
