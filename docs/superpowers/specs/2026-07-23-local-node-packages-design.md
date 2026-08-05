# 本地节点包与加载诊断设计

## 目标

为 Node Flow 建立可复用的本地 Python 节点包机制。节点包以受信任工作区中的目录形式存在，通过显式清单声明身份、版本和节点入口。运行时向 API 与前端暴露可读的加载诊断。

本设计服务于通用工作流平台的节点生态，而不是测试节点专用能力。首批内置节点仍可保留测试自动化倾向，但扩展机制不绑定测试领域。

## 范围与非目标

首期支持本地目录发现、清单校验、节点入口加载、旧脚本兼容、包级诊断和节点来源展示。

首期不支持 ZIP 导入、pip 安装、在线市场、包签名、依赖自动安装、远程更新、权限沙箱或在线编辑 Python。节点代码与现有机制一样，视为本地开发者信任的代码。

## 目录与清单

节点根目录默认为 `nodes/`。含有 `nodeflow-package.json` 的子目录是一个节点包：

```text
nodes/
  builtin/
    nodeflow-package.json
    http_request.py
    control.py
  my-tools/
    nodeflow-package.json
    json_tools.py
  scratch.py
```

清单使用 UTF-8 JSON，版本号格式采用非空字符串。首期 schema：

```json
{
  "id": "nodeflow.builtin",
  "name": "内置节点",
  "version": "1.0.0",
  "description": "Node Flow 自带的通用节点。",
  "nodeEntrypoints": ["http_request.py", "control.py"],
  "documentationUrl": "https://example.invalid/docs",
  "icon": "boxes",
  "author": "Node Flow"
}
```

`id`、`name`、`version` 和非空的 `nodeEntrypoints` 为必填字段。`description`、`documentationUrl`、`icon`、`author` 可选。入口必须是包目录内、后缀为 `.py` 的相对路径；不得穿越包根目录。相同包 ID 不允许同时出现。

## 兼容与发现规则

注册器扫描节点根目录时：

1. 发现每个 `nodeflow-package.json`，解析为一个候选包。
2. 校验清单与包 ID 唯一性后，仅加载其 `nodeEntrypoints`。
3. 将入口中经 `@node(...)` 注册的节点关联到该包。
4. 继续扫描不属于任何清单包目录的旧 `.py` 文件，作为 `legacy` 来源加载。

清单包目录中的未声明 Python 文件不会被隐式加载。它们可以作为入口模块的普通导入依赖，但不会自行暴露节点。旧节点不需要立刻迁移；其 API 来源为兼容标记，而非伪造包身份。

内置节点迁移为 `nodes/builtin/nodeflow-package.json`，从而与未来的扩展节点遵守相同协议。

节点 ID 保持全局唯一。若两个包或旧脚本注册同一节点 ID，后出现的节点不覆盖先出现的节点，并写入明确诊断。这样节点类型 API 和已保存工作流的解析结果保持确定性。

## 数据模型与 API

注册器新增不可变的包与诊断模型：

- `RegisteredNodePackage`：包 ID、名称、版本、可选元数据、根目录、状态、已加载节点 ID。
- `NodePackageDiagnostic`：稳定代码、级别（`error` 或 `warning`）、包 ID 或路径、中文消息与可选入口路径。
- `NodeRegistryScanResult`：包列表、遗留节点数量与诊断列表。

`RegisteredNodeType` 与现有节点类型 API 增加可选 `package` 字段：包 ID、名称、版本；旧脚本返回 `null`。这不修改节点 ID、端口、配置 schema 或工作流文档格式。

保留 `GET /api/node-types` 与 `POST /api/node-types/reload` 的现有职责和返回节点列表，以避免前端和外部调用方破坏。新增 `GET /api/node-packages` 返回最近一次扫描的包与诊断；重载成功或部分失败后均更新此快照。

## 失败处理

扫描应尽可能隔离错误。单个包的 JSON 语法错误、字段错误、缺失入口或入口导入异常只使该包失败，不阻止其他包和旧脚本加载。

以下是首期稳定诊断代码：

| 代码 | 情形 |
| --- | --- |
| `package_manifest_invalid` | JSON 无法解析或必填字段/字段类型无效 |
| `package_id_duplicate` | 多个清单使用同一个包 ID |
| `package_entrypoint_invalid` | 入口不是包内 Python 相对路径 |
| `package_entrypoint_missing` | 声明的入口文件不存在 |
| `package_entrypoint_load_failed` | 入口导入或注册失败 |
| `node_id_duplicate` | 节点 ID 与已加载节点冲突 |

包状态为 `loaded`、`partial` 或 `failed`。任一入口失败时，不影响同包中其余独立入口的尝试；至少一个节点成功加载且存在诊断时为 `partial`。没有可用节点或清单无法继续处理时为 `failed`。这使开发者可以在编辑节点脚本时继续使用其他节点。

## 前端体验

节点库卡片在现有节点名称、类别、端口摘要与标签之外，增加来源文字，例如“内置节点 v1.0.0”；旧脚本显示“本地脚本”。不把路径暴露给普通节点选择界面。

“重新加载节点”完成后，前端请求包诊断。无问题时使用简短中文成功反馈；有问题时显示可展开的中文诊断面板，按包分组，包含包名、入口和可操作原因。加载失败不会清空已经从上一次成功扫描获得的节点库；当本次扫描成功加载某个节点时，节点库才使用新快照。

前端不提供安装、删除或编辑包文件的按钮。文件系统是首期唯一的包管理入口。

## 安全与运行边界

加载 Python 节点会执行模块顶层代码，因此本地节点包与现有 `nodes/` 脚本同属受信任代码边界。清单校验只限制入口路径和格式，不宣称提供代码沙箱。凭据仍通过现有本地凭据库与运行级脱敏上下文传给节点，不写入清单或诊断。

## 测试与验收

后端测试覆盖：

- 有效清单仅加载声明入口，并将来源信息带入节点类型 API。
- 未声明目录外的旧脚本仍能加载；清单包中未声明的 Python 文件不加载。
- 内置节点通过清单包发现。
- 损坏清单、重复包 ID、越界入口、缺失入口和导入失败生成对应诊断，且不阻塞其他包。
- 重复节点 ID 结果稳定、不会静默覆盖。
- `GET /api/node-packages` 返回最近扫描诊断，节点类型重载兼容原响应。

前端测试覆盖：

- 节点库展示包来源或“本地脚本”。
- 重新加载后能够请求并显示中文包诊断。
- 有失败包时，其他已加载节点仍可添加到画布。

全量验证至少运行 `pytest tests/api -q`、`pnpm --filter @node-flow/web test`、`pnpm build:web`，并在浏览器中确认一个有效包与一个故意损坏的包同时存在时，节点库和诊断表现符合预期。
