import {
  ArrowRightLeft, BarChart3, Braces, Calculator, CheckCheck, CircleCheck,
  Clock3, Combine, CornerDownLeft, FileOutput, Filter, FlaskConical, GitBranch, GitFork, Globe, Group,
  ListChecks, Map, Merge, Package, Play, Puzzle, Repeat2, Reply, RotateCw,
  Search, SearchCheck, Table2, Terminal, Variable, WandSparkles, Webhook, type LucideIcon,
} from "lucide-react";
import type { NodeType } from "@/types";

const BUILTIN: Record<string, [string, string]> = {
  "manual.trigger": ["手动触发", "手动启动工作流并传入初始数据"],
  "schedule.trigger": ["定时触发", "按设定间隔自动启动工作流"],
  "webhook.trigger": ["Webhook 触发", "接收外部 HTTP 请求并启动流程"],
  "webhook.respond": ["Webhook 响应", "为当前请求返回自定义响应"],
  "http.request": ["HTTP 请求", "调用接口，支持认证、请求头和请求体"],
  "assert.status_code": ["状态码断言", "检查接口响应的 HTTP 状态码"],
  "assert.equals": ["相等断言", "检查指定字段是否等于预期值"],
  "assert.contains": ["包含断言", "检查数据是否包含预期内容"],
  "control.foreach": ["逐项循环", "对列表中的每一项执行循环体"],
  "control.each_item": ["数据项循环", "逐个处理上游传来的数据项"],
  "control.while": ["条件循环", "在条件成立时重复执行循环体"],
  "data.csv_read": ["读取 CSV", "读取表格文件，输出行数据和数据项"],
  "data.extract": ["提取字段", "按数据路径提取需要的值"],
  "data.map_items": ["映射数据项", "为每个数据项生成新的对象"],
  "data.group_items": ["分组数据项", "按一个或多个字段对数据分组"],
  "data.lookup": ["查找记录", "按指定字段查找匹配的记录"],
  "data.json_template": ["JSON 模板", "用输入和表达式构造 JSON 数据"],
  "data.decimal_math": ["精确计算", "执行十进制计算并控制精度"],
  "data.filter_items": ["筛选数据项", "保留符合字段条件的数据项"],
  "data.merge_items": ["合并数据项", "按到达顺序合并多路数据"],
  "data.collect": ["汇聚输入", "将多个输入组合成一个对象"],
  "logic.if": ["条件分支", "根据条件选择后续执行路径"],
  "logic.switch": ["多路分支", "按规则将输入路由到不同出口"],
  "logic.set_variable": ["设置变量", "设置本次运行使用的变量"],
  "test.record_result": ["记录结果", "保存一条成功或失败的结果"],
  "test.summary": ["结果汇总", "汇总每条结果及成功、失败数量"],
  "test.write_report": ["写入报告", "将汇总结果保存为 JSON 文件"],
  "utility.transform": ["转换数据", "用表达式选择或构造新数据"],
  "utility.log": ["记录日志", "记录当前数据或处理信息"],
  "utility.delay": ["等待", "暂停指定时间后继续执行"],
  "workflow.trigger": ["子流程入口", "接收另一个工作流传入的数据"],
  "workflow.execute": ["调用工作流", "执行已保存的工作流并取得结果"],
  "workflow.return": ["结束并输出", "设置工作流的最终输出"],
};
const CATEGORIES: Record<string, string> = {
  assertions: "断言", assertion: "断言", control: "控制", data: "数据",
  logic: "逻辑", network: "网络", testing: "结果", triggers: "触发",
  utility: "工具", workflow: "子流程",
};
export function nodeName(node: NodeType): string {
  if (node.displayName && node.displayName !== node.name) return node.displayName;
  return BUILTIN[node.id]?.[0] ?? node.displayName ?? node.name;
}
export function nodeDescription(node: NodeType): string { return BUILTIN[node.id]?.[1] ?? node.description ?? ""; }
export function categoryName(category: string): string { return CATEGORIES[category.toLowerCase()] ?? category; }
export function categoryColor(category: string): string {
  return ({ 触发: "#88b5ff", 网络: "#65d9b6", 断言: "#fb91a0", 控制: "#bba0ff", 数据: "#78d0f5", 逻辑: "#e2bd74", 结果: "#ed9acb", 子流程: "#7dd7dc" } as Record<string, string>)[categoryName(category)] ?? "#9aaeff";
}
const ICONS: Record<string, LucideIcon> = {
  play: Play, "clock-3": Clock3, webhook: Webhook, reply: Reply, globe: Globe,
  "badge-check": CircleCheck, equal: CheckCheck, search: Search, "search-check": SearchCheck, repeat: Repeat2,
  "rotate-cw": RotateCw, table: Table2, brackets: Braces, wand: WandSparkles,
  group: Group, braces: Braces, calculator: Calculator, filter: Filter, merge: Merge,
  combine: Combine, "git-branch": GitBranch, "git-fork": GitFork, variable: Variable,
  "list-checks": ListChecks, "bar-chart": BarChart3, "file-output": FileOutput,
  "file-text": Terminal, workflow: ArrowRightLeft, package: Package, map: Map,
  clock: Clock3, "corner-down-left": CornerDownLeft, "flask-conical": FlaskConical,
};
export function nodeIcon(node: NodeType): LucideIcon { return ICONS[node.icon ?? ""] ?? Puzzle; }
