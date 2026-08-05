# 本地凭据库设计

## 目标

为单用户桌面工作流提供可复用的本地凭据。工作流版本、导出文件、运行事件和前端响应不得保存或返回秘密明文；第一批由 HTTP 请求节点使用，后续节点可复用同一机制。

## 约束

- 当前目标平台为 Windows，秘密密文通过 Python 标准库 `ctypes` 调用 Windows DPAPI 保护。
- 凭据的主数据存 SQLite；DPAPI 保护后的密文只能由当前 Windows 用户解开。
- 非 Windows 平台不得回退为明文存储；凭据操作返回明确的“不支持安全存储”错误。
- 现有 `NODE_FLOW_SECRET_*` 环境变量继续作为 SDK 的兼容输入，不自动迁移或写入凭据库。
- API 和 UI 中的可见文本使用中文；存储 ID 与 Python 类型 ID 保持稳定英文。

## 数据模型

`credentials` 表：

| 字段 | 含义 |
| --- | --- |
| `id` | `cred_` 前缀的稳定 ID |
| `type_id` | 凭据类型，例如 `http.bearer` |
| `name` | 用户可读名称，同类型内唯一 |
| `encrypted_data` | DPAPI 返回的 base64 密文 JSON |
| `created_at` / `updated_at` | UTC ISO 时间 |

`CredentialType` 是后端注册表中的不可变描述：`id`、中文显示名、适用节点类型、字段 Schema 与注入函数。第一批类型：

- `http.bearer`：`token`，注入 `Authorization: Bearer <token>`。
- `http.basic`：`username`、`password`，注入 Basic Authorization。
- `http.header`：`header_name`、`header_value`，注入一个固定请求头。

凭据列表只返回 `id`、`type_id`、名称、显示类型、时间与引用数量；任何 API 响应都不包含 `encrypted_data` 或字段值。

## 存储与安全边界

新增 `CredentialVault`，负责 Windows DPAPI 加解密、JSON 结构检查和敏感值收集。`Storage` 只负责凭据记录和工作流引用检索，不处理明文。

执行器在每个节点调用前通过 `CredentialResolver` 按引用加载秘密。解析成功的字段只在该节点的 `NodeContext` 生命周期内存在；执行日志、事件载荷和执行数据继续通过统一脱敏器替换秘密值。凭据删除前由 Storage 查找已保存工作流版本中对该 ID 的引用，存在引用时拒绝删除并返回工作流名称与版本摘要。

## HTTP 节点集成

`HttpRequestConfig` 增加可选 `credential_id`。节点注册元数据声明支持三个 HTTP 凭据类型，前端配置面板据此展示“认证方式”和“凭据”选择器。运行时请求头优先级为：凭据注入 < 节点配置请求头 < 输入端口请求头；重复键使用后者覆盖，便于一次性测试覆盖默认认证头。

当凭据不存在、类型不支持该节点或无法解密时，验证阶段给出中文问题并阻止运行；运行时再次检查，防止已保存工作流在凭据删除或系统账户变化后出现非结构化异常。

## API 与前端

- `GET /api/credential-types`：可创建的凭据类型及字段 Schema。
- `GET /api/credentials`：不含秘密的凭据摘要。
- `POST /api/credentials`：创建并加密字段值。
- `PATCH /api/credentials/{id}`：重命名或替换字段值。
- `DELETE /api/credentials/{id}`：无引用时删除。
- `GET /api/credentials/{id}/references`：用于删除前的引用提示。

顶部工作流操作区增加“凭据”入口，打开独立管理面板。面板支持按名称或类型筛选、新建、编辑、删除和引用查看。编辑既有凭据时字段输入为空表示保持现有秘密不变；提交后不回显旧值。

## 错误与测试

所有验证问题包含稳定字段路径、中文消息和可选择的节点 ID。API 对不存在凭据返回 404，对类型或字段不合法返回 422，对被引用凭据删除返回 409。测试需覆盖：DPAPI 往返、无明文持久化、列表不泄密、删除保护、HTTP 三类注入、覆盖顺序、日志脱敏、前端不显示秘密与端到端选择凭据。
