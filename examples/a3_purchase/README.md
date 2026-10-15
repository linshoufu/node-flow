# A3 采购入库：通用节点预设与模板

新工作流 `workflow.json` 只使用平台节点，不依赖 `a3-tool`。`nodes/a3_purchase` 是声明式模板包；旧 Python 节点移到 `nodes/a3_purchase_legacy` 的独立兼容包，已有节点 ID、版本和配置迁移语义保留。新建节点库默认隐藏带 `legacy` 标签的旧节点，可勾选显示。

## 配置方式

1. 资源中心建立 **HTTP 登录账号** 凭据，填写租户、用户名和密码。凭据仍由平台加密保存，工作流只保存引用。
2. 建立 HTTP 配置档，参考 `http-profile.example.json` 设置系统地址、公共请求头、登录请求和认证提取。示例环境为 `http://10.0.2.155`。将示例凭据占位 ID 换成自己的凭据 ID；不得填入明文密码或令牌。
3. 从节点库选 A3 工作流模板（空白工作流）、循环体模板（空白循环体）或单节点预设。模板展开后都是普通节点，其配置可继续修改。
4. 查询和提交 HTTP 节点选择上述 HTTP 配置档；在顶部“工作流设置”中填写菜单编码、类别字典和默认仓库。映射节点的“处理选项”中，每个字段通过“固定值 / 引用”选择这些配置并显示当前值。`workflow.json` 的 HTTP 配置档 ID 是占位值，需要绑定后才能运行。
5. 字段映射通过字段卡片配置来源表达式、目标类型、必填与小数最小值。组单通过字段卡片配置计算规则、集合来源和输出对象，不必直接编辑整份 JSON。

主流程：运行参数 → 读取 CSV → 字段映射与校验 → 分组聚合 → 逐组处理 → 批处理结果汇总。固定采购选项不再占画布节点：它们属于工作流设置，经独立的配置绑定注入映射节点的普通 `options` 配置；CSV 数据继续通过端口传递。每次运行固化配置快照，不使用共享可变业务缓存。

循环体：当前分组 → 组装查询条件 → HTTP 查询 → 对象组装与计算 → HTTP 提交 → 单项结果。当前分组另有显式连线接入组装节点，查询响应不夹带隐式任务上下文。认证会话仅在运行内由 HTTP 模块安全复用。

## 通用数据规则

- `data.records_prepare` 的表达式只读取 `row`（原始记录）、`values`（前面已映射字段）、`options`（节点配置；连接同名输入时以输入为准，兼容旧图）。日期严格为 ISO 日期；数量和金额采用有限 Decimal。
- `data.records_group` 配置一份公共字段清单，每项选择值不同时拆组或报错，并可设置允许空值；另外配置组内唯一字段。同组任意行校验失败时整组拒绝，保留原始行号。
- `data.compose` 按顺序计算规则，输入来自 `inputs.input` / `inputs.context` / `inputs.options`。集合规则配置 `each`、内部 `rules` 和输出 `fields`；集合内使用 `item`、从零开始的 `index`。字段可引用前面的计算值。
- 表达式支持字典/数组读取、条件、基础算术和有限数据函数：`decimal`、`round_decimal`、`text`、`quantity`、`date`、`unique`、`lookup`、`ensure`、`sum` 等。它是有计算预算的 AST 解释器，不使用 eval，不允许导入、任意函数调用、属性反射或 IO。它不替代 Python 进程沙箱。
- A3 预设声明了物料唯一匹配、税价、汇率、精度及舍入规则，业务规则位于模板配置中，通用节点没有 A3 分支。

## 预演语义

模板固定 `settings.run_mode=preview`、`active=false`。读取节点声明只读；HTTP 查询配置 `operation=read`，用户将来主动启动预演时会登录和查询。HTTP 提交配置 `operation=write`，预演仅记录请求计划，不发起写入，也不伪造单据 ID 或保存成功响应。因此依赖保存响应的后续步骤为未验证，批处理汇总保留 unverified 条目。不能把未验证计为已保存。

HTTP 配置可声明业务失败状态和认证失效刷新条件。会话按系统地址、凭据及认证策略在运行内共享；同一认证会话串行登录。HTTP 写入及未声明操作不支持自动重试，已开始写入的正式运行不允许直接整体重试。

本次迁移不创建运行，不访问 A3。

## 已保存示例迁移

从旧示例引用的业务配置档迁移菜单、类别、默认仓库及 HTTP 连接，复用原账号数据新建加密的通用 HTTP 登录凭据。旧凭据、配置档和历史版本保留。迁移脚本仅连接本机平台，不调用 A3，也不创建运行：

```powershell
uv run python -m examples.a3_purchase.configure a3_purchase_10_0_2_155
```

脚本在 `.tmp` 保存迁移前工作流备份，用版本号防止覆盖并发修改。现有业务配置档原样保留；新例通过工作流设置与节点配置绑定配置业务规则。`migrate_bindings.py` 提供纯数据迁移函数，将上一版示例的固定映射选项节点转为工作流设置；动态逻辑或冲突会明确拒绝迁移。`workflow.legacy.json` 仅用于旧节点兼容回归。

## 离线检查

```powershell
uv run python -m pytest tests/api/test_configurable_records.py tests/api/test_a3_generic_template.py tests/api/test_a3_purchase_nodes.py -q
uv run python -m apps.api.nodeflow_api.node_doctor nodes --strict
```

新示例的 HTTP 测试使用 MockTransport 和临时数据库，预演/正式分支均不连接真实环境。安装可选 `a3-tool` 后，额外与 baogong 的完整 Payload 作离线对照，并检查旧工作流兼容性。
