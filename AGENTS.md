# Node Flow

## 工作约定

实现请求的完成标准是：行为可用、受影响的检查通过、由本次修改引入的问题已修复。常规本地编辑、检查和修复可连续推进；需要用户决定的产品歧义才提问。已有工作区改动是当前输入，保留与任务无关的修改。

按任务读取上下文。产品行为查 [PRODUCT.md](PRODUCT.md)；界面设计查 [DESIGN.md](DESIGN.md) 和实际组件；节点、表单或端口契约查 [docs/node-contracts.md](docs/node-contracts.md)。`docs/superpowers/` 中的旧计划是历史背景，不是新任务的授权或必经流程。

## 实现入口

- 前端：`apps/web/src/`；工作流状态在 `store/workflow.ts`，界面在 `components/`，API 调用在 `api/client.ts`。以当前实现为准，旧版 `hooks/use*Controller` 已移除。
- 后端：`apps/api/nodeflow_api/`；`main.py`、`routes/`、`storage/`、`worker.py`。
- SDK：`nodeflow_sdk/`；节点：`nodes/`。节点包由 `nodeflow-package.json` 组织。

## 必须保持的约束

- API 使用 `127.0.0.1:8150`；前端使用 `5273`，备用 `5274`。额外 CORS 来源通过 `NODE_FLOW_EXTRA_CORS_ORIGINS` 配置。Webhook 生产路径为 `/webhooks/<path>`，调试路径为 `/webhooks-test/<workflow_id>/<path>`。
- 凭据统一使用跨平台 AES-256-GCM，服务密钥从环境变量或独立密钥文件读取，SQLite 只保存密文。密钥不可用时明确失败，不降级存储。密钥、令牌和密码不得写入工作流、跨运行状态、项目变量或日志；工作流只保存凭据 ID，运行日志脱敏签名头和凭据字段。配置见 [服务端行为参考](docs/platform-behavior.md#凭据存储)。
- 默认全局并发上限为 `4`，超时为 `600` 秒。取消是协作式的，不强杀节点。Worker 的 `--concurrency` 是所有 Worker 共享的全局上限；工作流并发为 `1` 时串行。
- 跨运行状态仅在根运行成功后一次性提交，失败时丢弃。并发版本冲突明确失败，不静默覆盖；节点包安装保留原子事务日志的一致性保证。
- 节点声明 `Input`/`Output`，动态端口保留静态端口；`string` 不能连 `number`，`integer` 可连 `number`。配置通过 `migrate_config` 逐版本迁移。节点过滤支持 `nodes` / `excludedNodes`。

## 验证与运行

按改动选择检查；通过后，只有新修改、失败或尚未解决的风险才需要扩大或重复验证。纯文档改动检查内容和链接即可。本地测试应使用临时数据库或 fixtures；不要把仓库的 `node-flow.sqlite3` 当作可丢弃测试数据。

| 改动 | 常用检查 |
| --- | --- |
| 前端逻辑 | `pnpm --filter @node-flow/web test <受影响测试文件>`；`pnpm lint:web` |
| 前端构建或依赖 | `pnpm build:web` |
| 后端或 SDK | `uv run python -m pytest tests/api/<受影响文件> -q`；`pnpm lint:api` |
| 节点、表单、端口或包清单 | `uv run python -m apps.api.nodeflow_api.node_doctor <节点目录> --strict` |
| 跨模块回归或要求完整验证 | `pnpm test`；发布检查以 `.github/workflows/ci.yml` 为准 |

启动命令、依赖和检查的权威定义在 `package.json`、`apps/web/package.json`、`pyproject.toml`。本地前后端分别用 `pnpm dev:web`、`pnpm dev:api`；Python 命令使用项目虚拟环境或 `uv run`。

## Mac 开发与本次同步

本机使用 Node 24、pnpm 10 和 uv 管理的 Python 3.12 虚拟环境；VS Code 与 Codex 共用此 checkout。命令入口 `.codex/run.sh` 会切换到当前仓库并设置 PATH，后端使用项目虚拟环境。开发配置和 Codex 添加步骤见 [Mac 开发说明](docs/mac-development.md)，变更运行配置前读取它。

当前工作只保留本地，未经本人后续明确指示不推送代码或创建远端 PR。保留与任务无关的改动。

代码检索遵循本机 `/Users/hayashijutomi/.codex/docs/code-retrieval.md`（存在时）：CodeGraph 查跨模块流程与广泛影响；Serena 查精确符号/引用和重构；普通工具查字面文本、配置和文件。激活实际仓库或 worktree，复用有效结果。
