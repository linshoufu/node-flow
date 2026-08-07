import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { AlertTriangle, FileCode2, Pencil, Puzzle, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { nodePortContractSummary } from "../lib/nodePortSummary";
import type { NodePackageDiagnostic, NodePackageScanResult, NodePackageSummary, NodeType } from "../types";
import { displayNodeName, filterNodeTypes } from "./NodePalette";
import { NodeTypeIcon } from "./NodeTypeIcon";

type AssetFilter = "all" | "local" | "attention";

type NodeAssetManagerProps = {
  embedded?: boolean;
  nodeTypes: NodeType[];
  scan: NodePackageScanResult | null;
  refreshing?: boolean;
  openingSourcePath?: string | null;
  selectedNodeTypeId?: string | null;
  onClose: () => void;
  onEditForm?: (nodeTypeId: string) => void;
  onSelectNode?: (nodeTypeId: string) => void;
  onRefresh?: () => void;
  onOpenSource?: (sourcePath: string) => void;
};

export function NodeAssetManager({
  embedded = false,
  nodeTypes,
  scan,
  refreshing = false,
  openingSourcePath = null,
  selectedNodeTypeId = null,
  onClose,
  onEditForm,
  onSelectNode,
  onRefresh,
  onOpenSource,
}: NodeAssetManagerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetFilter>("all");
  const diagnostics = scan?.diagnostics ?? [];
  const packages = scan?.packages ?? [];
  const localNodes = useMemo(() => nodeTypes.filter((nodeType) => !nodeType.package), [nodeTypes]);
  const filteredNodeTypes = useMemo(() => filterNodeTypes(nodeTypes, query), [nodeTypes, query]);
  const visibleDiagnostics = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalizedQuery) return diagnostics;
    return diagnostics.filter((diagnostic) =>
      [diagnostic.message, diagnostic.path, diagnostic.entrypoint, diagnostic.code]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(normalizedQuery)),
    );
  }, [diagnostics, query]);
  const groups = useMemo(() => {
    const matchedIds = new Set(filteredNodeTypes.map((nodeType) => nodeType.id));
    const next: Array<{ key: string; title: string; subtitle: string | null; nodes: NodeType[] }> = [];
    const localMatched = filteredNodeTypes.filter((nodeType) => !nodeType.package);
    if (localMatched.length) next.push({ key: "local", title: "本地脚本", subtitle: null, nodes: localMatched });
    for (const nodePackage of packages) {
      const nodes = filteredNodeTypes.filter((nodeType) => matchedIds.has(nodeType.id) && nodeType.package?.id === nodePackage.id);
      if (nodes.length) {
        next.push({ key: `package:${nodePackage.id}`, title: nodePackage.name, subtitle: packageGroupSubtitle(nodePackage), nodes });
      }
    }
    const groupedIds = new Set(next.flatMap((group) => group.nodes.map((nodeType) => nodeType.id)));
    const orphanNodes = filteredNodeTypes.filter((nodeType) => nodeType.package && !groupedIds.has(nodeType.id));
    if (orphanNodes.length) next.push({ key: "package:unknown", title: "其他节点包", subtitle: null, nodes: orphanNodes });
    return next;
  }, [filteredNodeTypes, packages]);
  const visibleGroups = groups.filter((group) => filter !== "local" || group.key === "local");

  return (
    <section
      aria-label="节点资产管理"
      aria-modal={embedded ? undefined : "true"}
      className={`node-package-manager node-asset-manager${embedded ? " is-embedded" : ""}`}
      role={embedded ? "region" : "dialog"}
    >
      <header className="node-asset-modern-header">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon color="indigo" radius="md" size={34} variant="light"><Puzzle size={18} /></ThemeIcon>
          <Box className="node-asset-modern-title">
            <Group gap={7} wrap="nowrap">
              <Text fw={750} size="sm">节点资源</Text>
              <Badge color="gray" radius="sm" size="xs" variant="light">{nodeTypes.length} 个节点</Badge>
            </Group>
            <Text c="dimmed" size="xs">选择节点后在右侧查看或编辑</Text>
          </Box>
        </Group>
        <Group gap={4} wrap="nowrap">
          {onRefresh ? (
            <Tooltip label="重新扫描节点库">
              <ActionIcon aria-label="重新扫描节点库" disabled={refreshing} size="lg" variant="subtle" onClick={onRefresh}>
                <RefreshCw className={refreshing ? "is-spinning" : undefined} size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip label="返回工作流">
            <ActionIcon aria-label="关闭节点资产管理" size="lg" variant="subtle" onClick={onClose}><X size={17} /></ActionIcon>
          </Tooltip>
        </Group>
      </header>

      <div className="node-asset-modern-toolbar">
        <TextInput
          aria-label="搜索节点资产"
          leftSection={<Search size={15} />}
          placeholder="搜索名称、分类或端口"
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div aria-label="节点资产筛选" className="node-asset-modern-filters" role="group">
          <Button.Group>
            <Button aria-pressed={filter === "all"} color="gray" size="compact-xs" variant={filter === "all" ? "light" : "subtle"} onClick={() => setFilter("all")}>全部 {nodeTypes.length}</Button>
            <Button aria-label={`本地脚本 ${localNodes.length}`} aria-pressed={filter === "local"} color="gray" size="compact-xs" variant={filter === "local" ? "light" : "subtle"} onClick={() => setFilter("local")}>本地 {localNodes.length}</Button>
            <Button aria-label={`有问题 ${diagnostics.length}`} aria-pressed={filter === "attention"} color={diagnostics.length ? "orange" : "gray"} size="compact-xs" variant={filter === "attention" ? "light" : "subtle"} onClick={() => setFilter("attention")}>问题 {diagnostics.length}</Button>
          </Button.Group>
        </div>
      </div>

      <ScrollArea className="node-asset-modern-scroll" scrollbarSize={6} type="auto">
        <div className="node-package-manager-content">
          {filter === "attention" ? (
            visibleDiagnostics.length ? (
              <Stack aria-label="节点加载问题" className="node-asset-diagnostics" gap={6} role="region">
                {visibleDiagnostics.map((diagnostic, index) => (
                  <DiagnosticRow diagnostic={diagnostic} key={`${diagnostic.code}-${diagnostic.path ?? index}`} opening={openingSourcePath === diagnostic.path} onOpenSource={onOpenSource} />
                ))}
              </Stack>
            ) : <EmptyState icon={<FileCode2 size={25} />} title={diagnostics.length ? "没有匹配的问题" : "节点加载正常"} description="重新扫描后发现的问题会显示在这里。" />
          ) : (
            <>
              {filter === "all" && diagnostics.length ? (
                <Stack aria-label="节点加载问题" className="node-asset-diagnostics node-asset-diagnostics-pinned" gap={6} role="region">
                  <Group gap={6}><AlertTriangle size={14} /><Text fw={700} size="xs">{diagnostics.length} 个脚本加载失败</Text></Group>
                  {diagnostics.map((diagnostic, index) => (
                    <DiagnosticRow diagnostic={diagnostic} key={`${diagnostic.code}-${diagnostic.path ?? index}`} opening={openingSourcePath === diagnostic.path} onOpenSource={onOpenSource} />
                  ))}
                </Stack>
              ) : null}
              {visibleGroups.length ? (
                <Stack className="node-asset-groups" gap="sm">
                  {visibleGroups.map((group) => (
                    <section aria-label={group.title} className="node-asset-group" key={group.key}>
                      <Group className="node-asset-modern-group-title" gap={6}>
                        <Text c="dimmed" fw={750} size="xs">{group.title}</Text>
                        <Badge color="gray" radius="sm" size="xs" variant="light">{group.nodes.length}</Badge>
                        {group.subtitle ? <Text c="dimmed" size="xs">{group.subtitle}</Text> : null}
                      </Group>
                      <ul>
                        {group.nodes.map((nodeType) => (
                          <NodeAssetRow
                            key={nodeType.id}
                            nodeType={nodeType}
                            opening={openingSourcePath === nodeType.sourcePath}
                            selected={selectedNodeTypeId === nodeType.id}
                            onEditForm={onEditForm}
                            onOpenSource={onOpenSource}
                            onSelectNode={onSelectNode}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </Stack>
              ) : <EmptyState icon={<FileCode2 size={25} />} title={nodeTypes.length ? "没有匹配的节点" : "还没有可用节点"} description={nodeTypes.length ? "调整搜索词或筛选条件后重试。" : "添加 Python 节点脚本后重新扫描。"} />}
            </>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

function NodeAssetRow({ nodeType, opening, selected, onEditForm, onOpenSource, onSelectNode }: {
  nodeType: NodeType;
  opening: boolean;
  selected: boolean;
  onEditForm?: (nodeTypeId: string) => void;
  onOpenSource?: (sourcePath: string) => void;
  onSelectNode?: (nodeTypeId: string) => void;
}) {
  const portSummary = nodePortContractSummary(nodeType);
  const sourcePath = nodeType.sourcePath ?? null;
  const isLocalNode = !nodeType.package;
  return (
    <li
      aria-current={selected ? "true" : undefined}
      className={`node-asset-row${selected ? " is-selected" : ""}`}
      tabIndex={0}
      onClick={() => onSelectNode?.(nodeType.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectNode?.(nodeType.id);
        }
      }}
    >
      <ThemeIcon className="node-asset-row-icon" color="indigo" radius="md" size={30} variant={selected ? "light" : "transparent"}>
        <NodeTypeIcon icon={nodeType.icon} size={16} />
      </ThemeIcon>
      <span className="node-asset-row-name">{displayNodeName(nodeType)}</span>
      <span className="node-asset-row-category">{nodeType.category}</span>
      <span className="node-asset-row-ports">{portSummary.text}</span>
      <Group className="node-asset-row-actions" gap={3} wrap="nowrap">
        {isLocalNode && onEditForm ? (
          <Tooltip label="编辑节点表单">
            <ActionIcon aria-label="编辑表单" color="indigo" size="md" variant="subtle" onClick={(event) => { event.stopPropagation(); onEditForm(nodeType.id); }}><Pencil size={14} /></ActionIcon>
          </Tooltip>
        ) : null}
        {sourcePath ? (
          <Tooltip label={opening ? "正在打开" : "打开源文件"}>
            <ActionIcon aria-label="打开源文件" disabled={!onOpenSource || opening} size="md" variant="subtle" onClick={(event) => { event.stopPropagation(); onOpenSource?.(sourcePath); }}><FileCode2 size={14} /></ActionIcon>
          </Tooltip>
        ) : <Badge color="gray" radius="sm" size="xs" variant="outline">无源文件</Badge>}
      </Group>
      <div aria-hidden="true" className="node-asset-row-preview"><strong>{displayNodeName(nodeType)}</strong>{nodeType.description ? <p>{nodeType.description}</p> : null}<span className="node-asset-row-preview-path">{sourcePath ?? "该节点没有关联的源文件"}</span></div>
    </li>
  );
}

function DiagnosticRow({ diagnostic, opening, onOpenSource }: { diagnostic: NodePackageDiagnostic; opening: boolean; onOpenSource?: (sourcePath: string) => void }) {
  const path = diagnostic.path ?? null;
  return (
    <div className={`node-asset-diagnostic${diagnostic.level === "error" ? " is-error" : ""}`}>
      <AlertTriangle size={15} />
      <div className="node-asset-diagnostic-body"><p>{diagnostic.message}</p>{path ? <span className="node-asset-diagnostic-path">{path}</span> : null}</div>
      {path && onOpenSource ? <Button disabled={opening} size="compact-xs" variant="light" onClick={() => onOpenSource(path)}>{opening ? "正在打开" : "打开文件"}</Button> : null}
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <Stack align="center" className="node-package-manager-empty" gap={5}>{icon}<Text fw={700} size="sm">{title}</Text><Text c="dimmed" size="xs">{description}</Text></Stack>;
}

function packageGroupSubtitle(nodePackage: NodePackageSummary): string {
  const parts = [`v${nodePackage.version}`];
  if (nodePackage.lifecycle?.enabled === false) parts.push("已停用");
  return parts.join(" · ");
}
