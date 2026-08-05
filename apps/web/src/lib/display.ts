import type { JsonSchema, NodePort, NodeType, RunExecutionMode, RunStatus } from "../types";

const NODE_LABELS: Record<string, { name: string; description?: string }> = {
  "assert.contains": { name: "包含断言", description: "判断字段或响应内容是否包含期望值。" },
  "assert.equals": { name: "相等断言", description: "判断字段值是否等于期望值。" },
  "assert.status_code": { name: "状态码断言", description: "判断 HTTP 响应状态码是否符合预期。" },
  "control.each_item": { name: "逐项循环", description: "对输入数据项逐个执行循环体。" },
  "control.foreach": { name: "遍历循环", description: "对列表中的每一项执行循环体。" },
  "control.while": { name: "条件循环", description: "条件为真时反复执行循环体。" },
  "data.csv_read": { name: "读取 CSV", description: "读取 CSV 行和列，用于数据驱动测试。" },
  "data.extract": { name: "提取值", description: "从输入数据中按路径提取一个值。" },
  "data.filter_items": { name: "筛选数据项", description: "按字段比较保留匹配的数据项。" },
  "data.map_items": { name: "映射数据项", description: "为每个数据项构造新的输出值。" },
  "data.merge_items": { name: "合并数据项", description: "按到达顺序追加多个上游数据项流。" },
  "data.collect": { name: "命名汇聚", description: "将多个具名输入端口的值汇聚为一个对象。" },
  "http.request": { name: "HTTP 请求", description: "发送 HTTP 请求并按结果输出。" },
  "logic.if": { name: "条件判断", description: "根据表达式结果走“为真”或“为假”分支。" },
  "logic.switch": { name: "路由分支", description: "按配置的规则把输入路由到对应分支。" },
  "logic.set_variable": { name: "设置变量", description: "写入运行时变量，供后续节点读取。" },
  "manual.trigger": { name: "手动触发", description: "手动启动工作流。" },
  "schedule.trigger": { name: "定时触发", description: "按固定时间间隔自动启动已启用的工作流。" },
  "webhook.trigger": { name: "Webhook 触发", description: "收到 HTTP 请求时启动工作流。" },
  "webhook.respond": { name: "Webhook 响应", description: "为当前 Webhook 请求返回自定义 HTTP 响应。" },
  "workflow.trigger": { name: "工作流触发", description: "接收调用方传入的数据。" },
  "workflow.execute": { name: "执行工作流", description: "同步调用一个已保存的工作流。" },
  "workflow.return": { name: "工作流返回", description: "把数据显式返回给调用方。" },
  "test.record_result": { name: "记录测试结果", description: "把一次断言结果写入测试结果集。" },
  "test.summary": { name: "测试汇总", description: "汇总本次运行的通过和失败数量。" },
  "test.write_report": { name: "写入测试报告", description: "把测试汇总和明细写入报告文件。" },
  "utility.delay": { name: "延迟", description: "等待一段时间后继续。" },
  "utility.log": { name: "记录日志", description: "把一条消息写入运行日志。" },
  "utility.transform": { name: "转换", description: "用表达式生成新的输出值。" },
};

const NODE_NAME_LABELS: Record<string, { name: string; description?: string }> = {
  "For Each": NODE_LABELS["control.foreach"],
  "Each Item": NODE_LABELS["control.each_item"],
  Log: NODE_LABELS["utility.log"],
  "Manual Trigger": NODE_LABELS["manual.trigger"],
  While: NODE_LABELS["control.while"],
};

const CATEGORY_LABELS: Record<string, string> = {
  Actions: "操作",
  Assertions: "断言",
  Control: "控制",
  Data: "数据",
  Logic: "逻辑",
  Network: "网络",
  Other: "其他",
  Testing: "测试",
  Triggers: "触发器",
  Utility: "工具",
  Workflow: "工作流",
  action: "操作",
  assertions: "断言",
  control: "控制",
  data: "数据",
  testing: "测试",
  trigger: "触发器",
};

const TAG_LABELS: Record<string, string> = {
  api: "接口",
  automation: "自动化",
  assertion: "断言",
  branch: "分支",
  control: "控制",
  csv: "CSV",
  data: "数据",
  debug: "调试",
  file: "文件",
  http: "HTTP",
  items: "数据项",
  loop: "循环",
  filter: "筛选",
  merge: "合并",
  network: "网络",
  report: "报告",
  response: "响应",
  return: "返回",
  schedule: "定时",
  subworkflow: "子工作流",
  testing: "测试",
  transform: "转换",
  trigger: "触发",
  utility: "工具",
  workflow: "工作流",
  webhook: "Webhook",
  variable: "变量",
};

const PORT_DESCRIPTION_LABELS: Record<string, string> = {
  "All iterations completed": "全部迭代已完成",
  "All items completed": "全部数据项已完成",
  "Appended execution items": "已追加的执行数据项",
  "Assertion failed": "断言失败",
  "Assertion passed": "断言通过",
  "Assertion result": "断言结果",
  "CSV read error": "CSV 读取错误",
  "CSV rows, headers, and columns": "CSV 行、表头和列数据",
  "Caller input": "调用方传入的数据",
  "Child workflow error": "子工作流错误",
  "Child workflow result": "子工作流结果",
  "Condition became false": "条件变为假",
  "Condition is falsey": "条件结果为假时输出",
  "Condition is truthy": "条件结果为真时输出",
  "Execution items to filter": "待筛选的执行数据项",
  "Execution items to map": "待映射的执行数据项",
  "Extract error": "提取错误",
  "Extracted value": "提取出的值",
  "Incoming request": "收到的请求数据",
  "Initial payload": "初始数据",
  "Input passthrough": "原样传递的输入数据",
  "Item loop failed": "逐项循环失败",
  "Item streams to append in arrival order": "按到达顺序追加的数据项流",
  "Items that match the configured comparison": "符合配置比较条件的数据项",
  "Loop failed": "循环执行失败",
  "Mapped execution items": "映射后的执行数据项",
  "Matched route input": "命中路由的输入数据",
  "Maximum iterations reached": "已达到最大迭代次数",
  "No failures or failure is tolerated": "没有失败，或允许存在失败",
  "No route matched": "没有匹配到路由规则",
  "One execution item per CSV row": "每个 CSV 行对应一条执行数据项",
  "Recorded failures found": "发现已记录的失败结果",
  "Recorded result": "已记录的结果",
  "Report data": "报告数据",
  "Request body": "请求体",
  "Request error": "请求错误",
  "Request headers": "请求头",
  "Response body": "响应内容",
  "Response data": "响应数据",
  "Returned value": "返回的数据",
  "Schedule trigger details": "定时触发信息",
  "Source data": "来源数据",
  "Transformed value": "转换后的值",
  "Updated variables": "更新后的变量",
  "Upstream completion": "上游完成信号",
  "Written report": "已写入的报告",
  "Write error": "写入错误",
};

const FIELD_LABELS: Record<string, string> = {
  actual_path: "实际值路径",
  body: "请求体",
  condition: "条件表达式",
  continue_on_error: "出错后继续",
  delimiter: "分隔符",
  encoding: "编码",
  expected: "期望值",
  fail_run_on_failed: "有失败时走失败分支",
  has_header: "包含表头",
  headers: "请求头",
  items: "项目",
  items_expression: "项目表达式",
  expected_value: "期望值",
  items_path: "项目路径",
  max_items: "最大项目数",
  max_iterations: "最大循环次数",
  message: "消息",
  method: "请求方法",
  operator: "比较方式",
  name: "变量名",
  path: "路径",
  payload: "载荷",
  seconds: "秒数",
  interval_seconds: "间隔秒数",
  status_code: "响应状态码",
  timeout_seconds: "超时秒数",
  url: "URL",
  value: "值表达式",
  value_expression: "数据项值表达式",
  workflow_id: "目标工作流",
};

const NODE_ENUM_LABELS: Record<string, Record<string, Record<string, string>>> = {
  "data.filter_items": {
    operator: {
      equals: "等于",
      not_equals: "不等于",
      exists: "存在",
      is_empty: "为空",
      is_not_empty: "不为空",
    },
  },
};

const STATUS_LABELS: Record<RunStatus | "idle", string> = {
  cancelled: "已取消",
  failed: "失败",
  idle: "空闲",
  queued: "排队中",
  running: "运行中",
  succeeded: "成功",
};

const EVENT_LABELS: Record<string, string> = {
  node_error_handled: "节点错误已处理",
  node_failed: "节点失败",
  node_pinned_data_used: "已使用固定输出",
  node_retry_scheduled: "节点已安排重试",
  node_started: "节点开始",
  node_succeeded: "节点成功",
  webhook_response_set: "已设置 Webhook 响应",
  child_run_started: "子运行已启动",
  child_run_succeeded: "子运行成功",
  child_run_failed: "子运行失败",
  error_workflow_started: "错误处理已启动",
  error_workflow_succeeded: "错误处理成功",
  error_workflow_failed: "错误处理失败",
  error_workflow_skipped: "错误处理已跳过",
  run_retry_requested: "已请求重新运行",
  run_retried: "由历史运行重新启动",
  run_cancel_requested: "请求取消",
  run_cancelled: "运行已取消",
  run_failed: "运行失败",
  run_succeeded: "运行成功",
  "workflow.completed": "工作流完成",
};

export function localizeNodeType(nodeType: NodeType): NodeType {
  const label = NODE_LABELS[nodeType.id] ?? NODE_NAME_LABELS[nodeType.name];
  const localizedCategory = translateCategory(nodeType.category);
  const localizedTags = nodeType.tags?.map(translateTag);

  return {
    ...nodeType,
    name: label?.name ?? nodeType.name,
    displayName: label?.name ?? nodeType.displayName ?? nodeType.name,
    category: localizedCategory,
    tags: localizedTags,
    inputs: localizePorts(nodeType.inputs),
    outputs: localizePorts(nodeType.outputs),
    dynamicInputs: nodeType.dynamicInputs
      ? {
          ...nodeType.dynamicInputs,
          input: localizePort(nodeType.dynamicInputs.input),
        }
      : nodeType.dynamicInputs,
    dynamicOutputs: nodeType.dynamicOutputs
      ? {
          ...nodeType.dynamicOutputs,
          output: localizePort(nodeType.dynamicOutputs.output),
        }
      : nodeType.dynamicOutputs,
    keywords: searchKeywords([
      nodeType.category,
      localizedCategory,
      ...(nodeType.tags ?? []),
      ...(localizedTags ?? []),
      ...(nodeType.keywords ?? []),
    ]),
    description: label?.description ?? nodeType.description,
    configSchema: localizeSchema(nodeType.configSchema, nodeType.id),
  };
}

function localizePorts(ports: Record<string, NodePort>): Record<string, NodePort> {
  return Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, localizePort(port)]));
}

function localizePort(port: NodePort): NodePort {
  return {
    ...port,
    description: port.description ? translatePortDescription(port.description) : undefined,
  };
}

export function translateCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function translateTag(tag: string): string {
  return TAG_LABELS[tag] ?? TAG_LABELS[tag.toLowerCase()] ?? tag;
}

export function translatePortDescription(description: string): string {
  return PORT_DESCRIPTION_LABELS[description] ?? description;
}

export function translateFieldLabel(name: string, fallback?: string): string {
  return FIELD_LABELS[name] ?? fallback ?? name;
}

export function translateRunStatus(status: RunStatus | "idle"): string {
  return STATUS_LABELS[status] ?? status;
}

export function translateRunExecutionMode(mode?: RunExecutionMode): string {
  switch (mode) {
    case "schedule":
      return "定时触发";
    case "webhook":
      return "生产 Webhook";
    case "webhook_test":
      return "调试 Webhook";
    case "child":
      return "子工作流";
    case "error":
      return "错误处理";
    default:
      return "手动运行";
  }
}

export function translateEventType(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function translateSubflowName(name: string): string {
  return name === "body" ? "循环体" : name;
}

function localizeSchema(schema: JsonSchema, nodeTypeId?: string, fieldName?: string): JsonSchema {
  const enumLabels = nodeTypeId && fieldName ? NODE_ENUM_LABELS[nodeTypeId]?.[fieldName] : undefined;

  return {
    ...schema,
    ...(enumLabels ? { enumLabels } : {}),
    properties: schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, property]) => [
            key,
            {
              ...localizeSchema(property, nodeTypeId, key),
              title: translateNodeFieldLabel(nodeTypeId, key, property.title),
            },
          ])
        )
      : undefined,
  };
}

function translateNodeFieldLabel(nodeTypeId: string | undefined, name: string, fallback?: string): string {
  if (nodeTypeId === "data.map_items" && name === "value") {
    return "映射对象";
  }
  if (nodeTypeId === "webhook.respond" && name === "headers") {
    return "响应头";
  }
  return translateFieldLabel(name, fallback);
}

function searchKeywords(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
