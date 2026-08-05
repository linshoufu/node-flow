# 本地凭据库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 HTTP 和未来通用节点提供 Windows DPAPI 加密的本地凭据库，保证工作流和运行记录不泄露秘密。

**Architecture:** 后端以凭据类型注册表、DPAPI 凭据库和执行期解析器分层；SQLite 仅保存密文。HTTP 节点通过稳定的 `credential_id` 引用获取已注入请求头，前端从类型 Schema 生成凭据管理与选择体验。

**Tech Stack:** Python 3.11、FastAPI、Pydantic v2、SQLite、Windows DPAPI (`ctypes`)、React、TypeScript、Vitest、pytest。

## Global Constraints

- 任何 API、日志、事件、工作流 JSON 或 UI 状态不得回传凭据字段明文。
- Windows 上使用 DPAPI；非 Windows 不得写入明文凭据。
- API 可见文本为中文，稳定 ID、API 字段和 Python 类型名保持英文。
- 保留 `NODE_FLOW_SECRET_*` 兼容行为。
- 不提交 Git；工作区存在用户的未提交改动。

---

### Task 1: 凭据类型、DPAPI 凭据库与 SQLite 记录

**Files:**
- Create: `apps/api/nodeflow_api/credentials.py`
- Modify: `apps/api/nodeflow_api/storage.py`
- Modify: `apps/api/nodeflow_api/schemas.py`
- Test: `tests/api/test_credentials.py`

**Interfaces:**
- Produces `CredentialType`, `CredentialVault`, `CredentialSummary` 与 `CredentialRecord`。
- Produces Storage 方法 `create_credential`, `list_credentials`, `get_credential`, `update_credential`, `delete_credential`。

- [x] 写失败测试：DPAPI 加密后 SQLite 中不含 `token` 明文；列表摘要无 `data` 字段；非 Windows 加密返回 `CredentialStorageUnavailableError`。
- [x] 运行 `pytest tests/api/test_credentials.py -q`，确认实现前失败。
- [x] 实现凭据类型注册表、DPAPI base64 密文编解码、SQLite `credentials` 表和 Pydantic 摘要模型。
- [x] 运行 `pytest tests/api/test_credentials.py -q`，确认通过。

### Task 2: 凭据 API、引用保护与运行前校验

**Files:**
- Modify: `apps/api/nodeflow_api/main.py`
- Modify: `apps/api/nodeflow_api/storage.py`
- Modify: `apps/api/nodeflow_api/validation.py`
- Test: `tests/api/test_api_credentials.py`
- Test: `tests/api/test_validation.py`

**Interfaces:**
- Consumes Task 1 的 `CredentialVault` 与 Storage 凭据方法。
- Produces `/api/credential-types`、`/api/credentials`、`/api/credentials/{id}/references` API。

- [x] 写失败测试：创建、更新、列表、删除、404、422 与 409 的 HTTP 行为；运行前报告不存在和类型不匹配的 `credential_id`。
- [x] 运行精确 pytest 用例，确认失败原因是路由与校验尚未实现。
- [x] 增加 API 路由、引用查询与结构化中文验证问题；引用存在时拒绝删除。
- [x] 运行凭据 API 和校验测试，确认通过。

### Task 3: HTTP 节点凭据解析、覆盖和脱敏

**Files:**
- Modify: `nodes/builtin/http_request.py`
- Modify: `apps/api/nodeflow_api/executor.py`
- Modify: `nodeflow_sdk/core.py`
- Test: `tests/api/test_executor.py`
- Test: `tests/api/test_node_registry.py`

**Interfaces:**
- Consumes Task 1 的类型注册表与解密数据。
- `NodeContext.get_credential(credential_id: str) -> CredentialData | None` 返回仅当前节点可用的凭据。

- [x] 写失败测试：Bearer、Basic、固定 Header 的 HTTP 请求头注入；节点配置和输入端口请求头覆盖凭据头；运行事件中不出现 token/password。
- [x] 运行精确执行器测试，确认失败。
- [x] 在执行器中解析引用并扩展统一脱敏器；HTTP 节点声明支持类型、合并注入后的请求头。
- [x] 运行执行器、节点注册和 HTTP 测试，确认通过。

### Task 4: 前端凭据管理与 HTTP 配置选择

**Files:**
- Create: `apps/web/src/components/CredentialManager.tsx`
- Create: `apps/web/src/components/CredentialManager.test.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/api/client.test.ts`
- Test: `apps/web/src/components/ConfigPanel.test.tsx`

**Interfaces:**
- Consumes Task 2 的类型与摘要 API。
- Produces凭据管理面板，以及 HTTP 节点的认证方式和凭据下拉选择。

- [x] 写失败测试：列表不渲染秘密、创建凭据提交字段、HTTP 节点只能选择兼容类型、删除引用凭据显示中文阻止信息。
- [x] 运行相关 Vitest 文件，确认失败。
- [x] 实现 API Client、类型、管理器、顶部入口和配置面板选择器；秘密编辑字段只允许覆盖不回显。
- [x] 运行相关 Vitest 文件，确认通过。

### Task 5: 端到端回归与文档

**Files:**
- Modify: `README.md`
- Test: `tests/api/test_api_credentials.py`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes前四任务的完整 API 与 UI。
- Produces本地凭据的使用说明和端到端回归证据。

- [x] 写失败测试：创建 Bearer 凭据、保存使用该凭据的 HTTP 工作流、运行后日志与返回数据不含秘密。
- [x] 完成 API 与 UI 场景并运行该用例，确认通过。
- [x] 更新 README，说明 DPAPI 平台边界、凭据管理、HTTP 覆盖顺序和导出限制。
- [x] 运行 `pytest tests/api -q`、`pnpm --filter @node-flow/web test`、`pnpm build:web` 与 `git diff --check`。

## Self-Review

- 覆盖了密文持久化、类型注册、API、引用保护、执行注入、脱敏、UI 和端到端验证。
- 所有接口名称在前置任务定义，未使用占位符或明文回退。
- 每个任务都有独立失败测试、最小实现与验证入口。
