# 第六阶段设计：测试工作流闭环

## 背景

当前工作流编辑器已经具备个人测试自动化工作台的核心形态：可以从空画布选择测试模板，可以配置 Python 节点，可以运行、取消、查看测试报告和运行事件。

第五阶段解决了“像产品”的第一层问题，但真实日常使用还缺少一个闭环：用户需要在运行前知道哪里没配好，运行后能从测试报告快速定位失败原因，并且 CSV 参数化测试的结果要更容易理解。

第六阶段目标是把链路打磨成：

`选择模板 -> 补配置 -> 运行前检查 -> 执行 -> 查看报告 -> 定位失败 -> 调整配置`

## 目标

1. 让模板应用后更容易直接进入配置。
2. 在运行前给出面向测试人员的中文配置检查。
3. 让测试报告成为默认排查入口，而不是只展示原始事件。
4. 改善 CSV 参数化测试的可理解性。
5. 保持当前单人开发者定位，不引入多用户、认证、分布式执行或在线 Python 编辑。

## 非目标

- 不做在线编辑 Python 节点源码。
- 不做多用户、权限、登录、审计。
- 不做分布式 worker 或任务队列。
- 不做完整静态数据流证明，只做测试工作流常见配置检查。
- 不把报告系统做成大型 BI 面板，本阶段只做运行结果排查闭环。

## 方案

推荐采用“运行前检查 + 报告闭环优先”的方案。

### 运行前配置检查

新增前端检查层，在点击“运行”前对当前 workflow 做测试工作流友好的校验。它不替代后端 validation，而是在后端校验前提供更可读、更具体的提示。

检查对象先限定为常用测试节点：

- `http.request`
  - URL 为空时提示：`HTTP 请求缺少 URL。`
  - method 为空时提示：`HTTP 请求缺少请求方法。`
- `data.csv_read`
  - path 为空时提示：`读取 CSV 缺少文件路径。`
- `assert.status_code`
  - actual/status expression 为空时提示：`状态码断言缺少实际状态码来源。`
  - expected 为空时提示：`状态码断言缺少期望状态码。`
- `test.write_report`
  - path 为空时提示：`写入测试报告缺少输出路径。`
- `control.foreach`
  - items_expression 为空时提示：`遍历循环缺少循环数据来源。`

校验结果显示在顶部消息和右侧/底部可读列表中。用户点击问题项后，应尽量选中对应节点。

### 模板应用后的引导

模板应用后不只把节点放到画布上，还要把用户带到下一步：

- 单接口模板应用后自动选中 `request` 节点。
- CSV 参数化模板应用后自动选中 `csv` 节点。
- 右侧配置面板显示已有中文 guidance。
- 后续可在空画布模板卡片上标注“需要配置：URL / CSV 文件 / 报告路径”。

模板数据继续保持前端不可变，节点类型必须和后端真实注册节点一致。`manual.trigger` 是真实起点节点，不再使用不存在的 `control.start`。

### 测试报告闭环

`RunPanel` 当前默认显示“测试报告”。第六阶段在此基础上增强：

- 摘要区继续显示总数、通过、失败、未知。
- 增加状态筛选：全部、失败、未知、通过。
- 失败和未知用例优先突出展示。
- 用例行显示：
  - 用例名称
  - 状态
  - 消息
  - 耗时
  - 来源节点
- 点击用例时：
  - 如果有 `sourceNodeId`，选中对应节点。
  - 如果能找到相关运行事件，切换或定位到对应事件。

如果当前报告只有 summary 没有 case 明细，继续显示“暂无明细”，但摘要不能丢失。

### CSV 参数化体验

CSV 参数化的核心问题是用户需要知道“循环实际跑了哪些行”。本阶段做轻量增强：

- `data.csv_read` 运行详情展示 headers、rows 数量、columns key。
- `control.foreach` 运行详情展示迭代次数和 items_expression。
- 配置引导中补充 `{{ loop.item.column_name }}` 的使用提示。
- README 补一段最小 CSV 示例。

不在本阶段做大型表格预览，也不做 CSV 文件上传 UI。

### 错误与边界

- 前端运行前检查只拦截明确缺失的配置，不做复杂表达式路径证明。
- 如果运行前检查发现问题，不调用创建 run API。
- 后端 validation 仍然是最终防线。
- 报告提取继续兼容真实后端事件形状：
  - `outputs.success` 直接是 result
  - `outputs.success.result`
  - `outputs.success.case`
  - `outputs.success.summary`
  - `outputs.failed.summary`
- 普通 HTTP/CSV 节点输出不能被误识别成测试用例。

## 组件与模块

### 新增或调整的前端模块

- `apps/web/src/lib/preRunChecks.ts`
  - 导出 `buildPreRunIssues(workflow, nodeTypes)`。
  - 返回节点级问题列表。

- `apps/web/src/components/PreRunIssueList.tsx`
  - 展示运行前检查结果。
  - 支持点击问题选中节点。

- `apps/web/src/components/TestReportView.tsx`
  - 增加筛选和用例点击能力。

- `apps/web/src/components/ConfigPanel.tsx`
  - 增强 CSV / ForEach guidance。
  - 运行详情对 CSV 和循环输出做更友好展示。

- `apps/web/src/App.tsx`
  - 点击运行时先执行 pre-run checks。
  - 有阻塞问题时展示问题列表并停止运行。
  - 模板应用后自动选中首个需要配置的节点。

## 数据结构

运行前问题建议结构：

```ts
type PreRunIssueSeverity = "error" | "warning";

type PreRunIssue = {
  id: string;
  nodeId: string;
  nodeType: string;
  severity: PreRunIssueSeverity;
  title: string;
  message: string;
  field?: string;
};
```

本阶段只有 `error` 会阻止运行；`warning` 可预留但不作为主要能力。

## 测试策略

### 前端单元测试

- `preRunChecks.test.ts`
  - HTTP 缺 URL。
  - CSV 缺 path。
  - 状态码断言缺 expected。
  - report 缺 path。
  - ForEach 缺 items_expression。
  - 配置完整时无阻塞问题。

- `PreRunIssueList.test.tsx`
  - 渲染中文问题。
  - 点击问题调用 `onSelectNode(nodeId)`。

- `App.test.tsx`
  - 有运行前错误时点击“运行”不会调用 create run。
  - 点击问题后选中对应节点。
  - 应用单接口模板后选中 HTTP 请求节点。
  - 应用 CSV 模板后选中 CSV 节点。

- `TestReportView.test.tsx`
  - 状态筛选。
  - 点击用例选中来源节点。
  - failed summary 和 case 明细继续正确显示。

- `ConfigPanel.test.tsx`
  - CSV / ForEach 引导文案。
  - CSV 运行详情摘要展示。

### 全量验证

- `pnpm --filter @node-flow/web test`
- `pnpm build:web`
- `pytest tests/api -q`

### 浏览器烟测

- 从空画布应用单接口模板，确认自动选中 HTTP 请求。
- 不填 URL 直接运行，确认出现中文运行前问题且不创建 run。
- 填必要字段后运行，确认可进入报告页。
- 从空画布应用 CSV 模板，确认自动选中 CSV 节点。
- 切换测试报告筛选，点击失败用例定位节点。

## 风险

- 前端运行前检查可能和后端真实 schema 漂移。控制方式：只检查少数稳定节点和字段，并用测试锁定。
- 报告点击定位依赖 `sourceNodeId`，如果后端事件缺少足够信息，只能退化为选中记录结果节点。
- CSV 详情展示如果直接 dump 大量 rows 会影响体验。本阶段只显示数量和摘要，不展示完整数据。

## 交付标准

第六阶段完成时，用户应该可以：

1. 从模板开始搭一个接口测试工作流。
2. 在缺少关键配置时得到中文、可定位的运行前提示。
3. 运行后优先看到测试报告。
4. 从失败用例回到相关节点或事件。
5. 理解 CSV 参数化测试读了什么、循环了多少次。

