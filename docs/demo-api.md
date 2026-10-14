# 本地接口调用演示

首批使用者是项目作者本人。首个验收场景为接口调用，覆盖单次请求、登录后串联和 CSV 批量调用。批量中某条失败后继续处理其余数据，并记录每条结果。

## 启动

在仓库根目录打开三个终端，分别启动服务：

```powershell
uv run pnpm dev:api
```

```powershell
pnpm dev:web
```

```powershell
pnpm dev:demo-api
```

Node Flow API 使用 `127.0.0.1:8150`，工作台使用 `127.0.0.1:5273`。独立演示 API 使用 `127.0.0.1:8160`，接口文档位于 <http://127.0.0.1:8160/docs>。

三个服务启动后，在另一个终端初始化示例：

```powershell
pnpm demo:setup
```

初始化通过正常资源 API 创建一个演示登录凭据、两个 HTTP 配置档和三个未发布草稿。凭据使用跨平台服务 AES-256-GCM 加密；服务密钥配置见 [凭据存储](platform-behavior.md#凭据存储)。工作流只引用配置档 ID，账号密码不放入节点配置；登录取得的令牌只保留在本次运行的 HTTP 会话中。

脚本再次运行时复用资源，并保留已有演示草稿的修改。同名 HTTP 配置档设置不同或固定演示工作流 ID 被其他工作流占用时，会明确报错。导出的工作流位于 `.tmp/demo-workflows/`，其中配置档 ID 对应本次初始化的 Node Flow 数据库。

打开工作台的“工作流”列表并刷新页面，可以选择下列示例。修改参数后先保存，待保存完成再运行；当前运行执行的是服务器已保存的草稿。

## 验收流程

| 工作流 | 调用过程 | 预期结果 |
| --- | --- | --- |
| 演示 · 单次接口调用 | `GET /echo?message=hello-node-flow` | HTTP 200，响应 `message` 为 `hello-node-flow` |
| 演示 · 登录后串联接口 | 配置档自动登录 → 查询商品 → 引用首个商品 ID → 提交订单 | 查询 HTTP 200；订单 HTTP 201，商品 `pencil`，数量 2 |
| 演示 · CSV 批量接口调用 | 读取 CSV → 逐行提交订单 → 成功/错误分支记录 → 汇总并写报告 | 四行依次成功、失败、失败、成功；汇总 `total=4, passed=2, failed=2` |

批量数据位于 [`examples/demo-cases.csv`](../examples/demo-cases.csv)。第二行使用不存在的商品，接口返回 404；第三行数量为 0，接口返回 422；最后一行仍会执行。报告默认位于 `.tmp/demo-workflows/batch-report.json`，每条结果带有 `index` 和 `row`，能定位到来源数据。

整次批量工作流“成功”表示已完成全部处理；某些行的失败保留在汇总和报告中。循环体中成功、状态码异常和 HTTP 错误分别连接独立的记录节点；它们共用根运行的结果集合。可以进入“编辑循环体”查看这些分支。

批量 HTTP 节点采用错误出口策略，登录异常也会进入逐行失败记录。

## 演示接口

| 接口 | 认证 | 行为 |
| --- | --- | --- |
| `GET /health` | 无 | 返回演示服务标识和状态 |
| `GET /echo?message=...` | 无 | 回显请求参数 |
| `POST /login` | 演示账号 | 返回本次服务进程认可的登录令牌 |
| `GET /products` | 登录令牌 | 返回两个固定商品 |
| `POST /orders` | 登录令牌 | 校验商品和数量，计算演示订单并返回 201 |

公开的虚构演示账号是 `demo`，密码是 `demo-only-password`。令牌由服务随机生成，重启后旧令牌失效；后续 Node Flow 运行会重新登录。订单响应只做计算，重复运行不会积累业务记录。

当前 HTTP 会话按请求 URL 缓存：同一根运行里的 CSV 请求复用登录，不同 URL 的串联请求会分别完成登录。认证配置集中在“资源 → HTTP 配置档”的“Node Flow 演示 · 登录”中。

## 验证与停止

```powershell
uv run --extra test python -m pytest tests/api/test_demo_api.py -q
uv run ruff check examples/demo_api.py examples/demo_setup.py tests/api/test_demo_api.py
```

自动化检查使用临时数据库，并通过真实 HTTP 节点和执行器验证三个工作流、错误后继续处理、逐行报告、凭据脱敏及重复初始化。手动验收可在工作台逐一运行三个草稿，检查节点的“运行数据”和底部运行详情。

在服务终端按 `Ctrl+C` 停止服务。
