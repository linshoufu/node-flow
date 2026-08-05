import {
  BadgeCheck,
  BarChart3,
  Box,
  Braces,
  Clock,
  Equal,
  FileOutput,
  FileText,
  GitBranch,
  Globe,
  ListChecks,
  Play,
  Reply,
  Repeat,
  RotateCw,
  SearchCheck,
  Table,
  Variable,
  Wand,
  type LucideIcon,
} from "lucide-react";

type NodeTypeIconProps = {
  className?: string;
  icon?: string | null;
  size?: number;
};

const NODE_ICON_COMPONENTS: Record<string, LucideIcon> = {
  "badge-check": BadgeCheck,
  "bar-chart": BarChart3,
  braces: Braces,
  clock: Clock,
  equal: Equal,
  "file-output": FileOutput,
  "file-text": FileText,
  "git-branch": GitBranch,
  globe: Globe,
  "list-checks": ListChecks,
  play: Play,
  reply: Reply,
  repeat: Repeat,
  "rotate-cw": RotateCw,
  "search-check": SearchCheck,
  table: Table,
  variable: Variable,
  wand: Wand,
};

export function NodeTypeIcon({ className, icon, size = 14 }: NodeTypeIconProps) {
  const iconName = icon?.trim() || "node";
  const Icon = iconName in NODE_ICON_COMPONENTS ? NODE_ICON_COMPONENTS[iconName] : Box;

  return (
    <span aria-hidden="true" className={className} title={`节点图标：${iconName}`}>
      <Icon size={size} strokeWidth={2.2} />
    </span>
  );
}
