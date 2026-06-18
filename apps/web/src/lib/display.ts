import type { JsonSchema, NodeType, RunStatus } from "../types";

const NODE_LABELS: Record<string, { name: string; description?: string }> = {
  "assert.contains": { name: "包含断言", description: "判断字段或响应内容是否包含期望值。" },
  "assert.equals": { name: "相等断言", description: "判断字段值是否等于期望值。" },
  "assert.status_code": { name: "状态码断言", description: "判断 HTTP 响应状态码是否符合预期。" },
  "control.foreach": { name: "遍历循环", description: "对列表中的每一项执行循环体。" },
  "control.while": { name: "条件循环", description: "条件为真时反复执行循环体。" },
  "data.csv_read": { name: "读取 CSV", description: "读取 CSV 行和列，用于数据驱动测试。" },
  "data.extract": { name: "提取值", description: "从输入数据中按路径提取一个值。" },
  "http.request": { name: "HTTP 请求", description: "发送 HTTP 请求并按结果输出。" },
  "logic.if": { name: "条件判断", description: "根据表达式结果走 true 或 false 分支。" },
  "logic.set_variable": { name: "设置变量", description: "写入运行时变量，供后续节点读取。" },
  "manual.trigger": { name: "手动触发", description: "手动启动工作流。" },
  "test.record_result": { name: "记录测试结果", description: "把一次断言结果写入测试结果集。" },
  "test.summary": { name: "测试汇总", description: "汇总本次运行的通过和失败数量。" },
  "test.write_report": { name: "写入测试报告", description: "把测试汇总和明细写入报告文件。" },
  "utility.delay": { name: "延迟", description: "等待一段时间后继续。" },
  "utility.log": { name: "记录日志", description: "把一条消息写入运行日志。" },
  "utility.transform": { name: "转换", description: "用表达式生成新的输出值。" },
};

const NODE_NAME_LABELS: Record<string, { name: string; description?: string }> = {
  "For Each": NODE_LABELS["control.foreach"],
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
  action: "操作",
  assertions: "断言",
  control: "控制",
  data: "数据",
  testing: "测试",
  trigger: "触发器",
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
  items_path: "项目路径",
  max_items: "最大项目数",
  max_iterations: "最大循环次数",
  message: "消息",
  method: "方法",
  name: "变量名",
  path: "路径",
  payload: "载荷",
  seconds: "秒数",
  timeout_seconds: "超时秒数",
  url: "URL",
  value: "值表达式",
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
  node_failed: "节点失败",
  node_started: "节点开始",
  node_succeeded: "节点成功",
  run_cancel_requested: "请求取消",
  run_cancelled: "运行已取消",
  run_failed: "运行失败",
  run_succeeded: "运行成功",
  "workflow.completed": "工作流完成",
};

export function localizeNodeType(nodeType: NodeType): NodeType {
  const label = NODE_LABELS[nodeType.id] ?? NODE_NAME_LABELS[nodeType.name];

  return {
    ...nodeType,
    name: label?.name ?? nodeType.name,
    category: translateCategory(nodeType.category),
    description: label?.description ?? nodeType.description,
    configSchema: localizeSchema(nodeType.configSchema),
  };
}

export function translateCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function translateFieldLabel(name: string, fallback?: string): string {
  return FIELD_LABELS[name] ?? fallback ?? name;
}

export function translateRunStatus(status: RunStatus | "idle"): string {
  return STATUS_LABELS[status] ?? status;
}

export function translateEventType(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

export function translateSubflowName(name: string): string {
  return name === "body" ? "循环体" : name;
}

function localizeSchema(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    properties: schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, property]) => [
            key,
            {
              ...localizeSchema(property),
              title: translateFieldLabel(key, property.title),
            },
          ])
        )
      : undefined,
  };
}
