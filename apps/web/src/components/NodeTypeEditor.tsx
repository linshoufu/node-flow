import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Select,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  FileCode2,
  GripVertical,
  Layers3,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { apiClient } from "../api/client";
import type {
  NodeFormControl,
  NodeFormField,
  NodeFormGroup,
  NodeFormManifest,
  NodePortPresentation,
  NodeType,
} from "../types";
import { NodeTypeIcon } from "./NodeTypeIcon";
import { NodePortsPreview } from "./NodePortsPreview";

const ALL_CONTROLS: Array<{ value: NodeFormControl; label: string }> = [
  { value: "text", label: "单行文本" },
  { value: "textarea", label: "多行文本" },
  { value: "password", label: "密码" },
  { value: "number", label: "数字" },
  { value: "switch", label: "开关" },
  { value: "select", label: "下拉选择" },
  { value: "json", label: "JSON 编辑器" },
  { value: "dynamic_output_list", label: "动态输出列表" },
  { value: "dynamic_input_list", label: "动态输入列表" },
  { value: "url", label: "URL" },
  { value: "credential", label: "凭据" },
];

type NodeTypeEditorProps = {
  embedded?: boolean;
  nodeTypeId: string;
  nodeTypes: NodeType[];
  openingSourcePath?: string | null;
  onBack: () => void;
  onOpenSource?: (sourcePath: string) => void;
  onReload?: () => void;
};

type EditorSnapshot = {
  groups: NodeFormGroup[];
  defaults: Record<string, unknown>;
  placements: Record<string, "inline" | "panel">;
  portPresentation: PortPresentationState;
};

type PortDirection = "inputs" | "outputs";
type PortPresentationState = Partial<Record<PortDirection, Record<string, NodePortPresentation>>>;
type SelectedPort = { direction: PortDirection; handle: string };

function snapshotOf(snapshot: EditorSnapshot) {
  return JSON.stringify(snapshot);
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function NodeTypeEditor({
  embedded = false,
  nodeTypeId,
  nodeTypes,
  openingSourcePath,
  onBack,
  onOpenSource,
  onReload,
}: NodeTypeEditorProps) {
  const [nodeType, setNodeType] = useState<NodeType | null>(null);
  const [groups, setGroups] = useState<NodeFormGroup[]>([]);
  const [defaults, setDefaults] = useState<Record<string, unknown>>({});
  const [placements, setPlacements] = useState<Record<string, "inline" | "panel">>({});
  const [portPresentation, setPortPresentation] = useState<PortPresentationState>({});
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const [editorMode, setEditorMode] = useState<"form" | "ports">("form");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedPort, setSelectedPort] = useState<SelectedPort | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReadonly = Boolean(nodeType?.package?.id);
  const configProperties = useMemo(
    () => (nodeType?.configSchema?.properties ?? {}) as Record<string, unknown>,
    [nodeType],
  );
  const configKeys = useMemo(() => Object.keys(configProperties).sort(), [configProperties]);
  const currentSnapshot = useMemo(
    () => snapshotOf({ groups, defaults, placements, portPresentation }),
    [defaults, groups, placements, portPresentation],
  );
  const isDirty = Boolean(initialSnapshot && currentSnapshot !== initialSnapshot);
  const fieldCount = useMemo(() => groups.reduce((total, group) => total + group.fields.length, 0), [groups]);
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) ?? null,
    [groups, selectedGroupId],
  );
  const selectedFieldDefinition = useMemo(
    () => selectedGroup?.fields.find((field) => field.key === selectedField) ?? null,
    [selectedField, selectedGroup],
  );
  const displayedPorts = useMemo(
    () => nodeType ? applyPortPresentation(nodeType, portPresentation) : null,
    [nodeType, portPresentation],
  );
  const selectedPortDefinition = useMemo(() => {
    if (!displayedPorts || !selectedPort) return null;
    return displayedPorts[selectedPort.direction][selectedPort.handle] ?? null;
  }, [displayedPorts, selectedPort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaved(false);

    const cached = nodeTypes.find((candidate) => candidate.id === nodeTypeId) ?? null;
    setNodeType(cached);

    apiClient.getNodeTypeManifest(nodeTypeId)
      .then((manifest) => {
        if (cancelled) return;
        const nextGroups = manifest.form?.groups ?? cached?.form?.groups ?? [];
        const nextDefaults = manifest.defaults ?? {};
        const nextPlacements = manifest.placements ?? {};
        const nextPortPresentation = manifest.portPresentation ?? {};
        setGroups(nextGroups);
        setDefaults(nextDefaults);
        setPlacements(nextPlacements);
        setPortPresentation(nextPortPresentation);
        setInitialSnapshot(snapshotOf({ groups: nextGroups, defaults: nextDefaults, placements: nextPlacements, portPresentation: nextPortPresentation }));
      })
      .catch((loadError) => {
        if (cancelled) return;
        const nextGroups = cached?.form?.groups ?? [];
        setGroups(nextGroups);
        setDefaults({});
        setPlacements({});
        setPortPresentation({});
        setInitialSnapshot(snapshotOf({ groups: nextGroups, defaults: {}, placements: {}, portPresentation: {} }));
        if (!(loadError instanceof Error && loadError.message.includes("404"))) {
          setError(loadError instanceof Error ? loadError.message : "节点表单加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [nodeTypeId, nodeTypes]);

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedGroupId(null);
      setSelectedField(null);
      return;
    }
    if (!selectedGroupId || !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroup) return;
    if (selectedField && selectedGroup.fields.some((field) => field.key === selectedField)) return;
    setSelectedField(selectedGroup.fields[0]?.key ?? null);
  }, [selectedField, selectedGroup]);

  useEffect(() => {
    if (!displayedPorts) return;
    if (selectedPort && displayedPorts[selectedPort.direction][selectedPort.handle]) return;
    const firstInput = Object.keys(displayedPorts.inputs)[0];
    const firstOutput = Object.keys(displayedPorts.outputs)[0];
    setSelectedPort(firstInput ? { direction: "inputs", handle: firstInput } : firstOutput ? { direction: "outputs", handle: firstOutput } : null);
  }, [displayedPorts, selectedPort]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const selectFieldByKey = useCallback((fieldKey: string) => {
    const owner = groups.find((group) => group.fields.some((field) => field.key === fieldKey));
    if (!owner) return;
    setSelectedGroupId(owner.id);
    setSelectedField(fieldKey);
  }, [groups]);

  const addGroup = useCallback(() => {
    const id = makeId("group");
    setGroups((current) => [...current, { id, label: `分组 ${current.length + 1}`, fields: [] }]);
    setSelectedGroupId(id);
    setSelectedField(null);
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    setGroups((current) => current.filter((group) => group.id !== groupId));
  }, []);

  const updateGroup = useCallback((groupId: string, patch: Partial<NodeFormGroup>) => {
    setGroups((current) => current.map((group) => group.id === groupId ? { ...group, ...patch } : group));
  }, []);

  const moveGroup = useCallback((groupId: string, direction: -1 | 1) => {
    setGroups((current) => moveItem(current, current.findIndex((group) => group.id === groupId), direction));
  }, []);

  const addField = useCallback((groupId: string) => {
    const usedKeys = new Set(groups.flatMap((group) => group.fields.map((field) => field.key)));
    const key = configKeys.find((candidate) => !usedKeys.has(candidate)) ?? makeId("field");
    const field: NodeFormField = { key, control: "text", label: key, placement: "panel" };
    setGroups((current) => current.map((group) => (
      group.id === groupId ? { ...group, fields: [...group.fields, field] } : group
    )));
    setSelectedField(key);
  }, [configKeys, groups]);

  const deleteField = useCallback((groupId: string, fieldKey: string) => {
    setGroups((current) => current.map((group) => (
      group.id === groupId ? { ...group, fields: group.fields.filter((field) => field.key !== fieldKey) } : group
    )));
    setDefaults((current) => omitKey(current, fieldKey));
    setPlacements((current) => omitKey(current, fieldKey));
  }, []);

  const updateField = useCallback((groupId: string, fieldKey: string, patch: Partial<NodeFormField>) => {
    setGroups((current) => current.map((group) => group.id === groupId ? {
      ...group,
      fields: group.fields.map((field) => field.key === fieldKey ? { ...field, ...patch } : field),
    } : group));
    if (patch.key && patch.key !== fieldKey) {
      setDefaults((current) => renameKey(current, fieldKey, patch.key!));
      setPlacements((current) => renameKey(current, fieldKey, patch.key!));
      setSelectedField(patch.key);
    }
  }, []);

  const moveField = useCallback((groupId: string, fieldKey: string, direction: -1 | 1) => {
    setGroups((current) => current.map((group) => group.id === groupId ? {
      ...group,
      fields: moveItem(group.fields, group.fields.findIndex((field) => field.key === fieldKey), direction),
    } : group));
  }, []);

  const setFieldPlacement = useCallback((fieldKey: string, placement: "inline" | "panel") => {
    setPlacements((current) => placement === "panel" ? omitKey(current, fieldKey) : { ...current, [fieldKey]: placement });
    setGroups((current) => current.map((group) => ({
      ...group,
      fields: group.fields.map((field) => field.key === fieldKey ? { ...field, placement } : field),
    })));
  }, []);

  const updatePortPresentation = useCallback((direction: PortDirection, handle: string, patch: Partial<NodePortPresentation>) => {
    setPortPresentation((current) => ({
      ...current,
      [direction]: {
        ...(current[direction] ?? {}),
        [handle]: { ...(current[direction]?.[handle] ?? {}), ...patch },
      },
    }));
  }, []);

  const movePort = useCallback((direction: PortDirection, handle: string, shift: -1 | 1) => {
    if (!displayedPorts) return;
    const handles = Object.keys(displayedPorts[direction]);
    const currentIndex = handles.indexOf(handle);
    const targetIndex = currentIndex + shift;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= handles.length) return;
    [handles[currentIndex], handles[targetIndex]] = [handles[targetIndex], handles[currentIndex]];
    setPortPresentation((current) => ({
      ...current,
      [direction]: Object.fromEntries(handles.map((portHandle, index) => [
        portHandle,
        { ...(current[direction]?.[portHandle] ?? {}), order: index },
      ])),
    }));
  }, [displayedPorts]);

  const handleSave = useCallback(async () => {
    if (!nodeType || !isDirty) return;
    setSaving(true);
    setError(null);
    try {
      const cleanDefaults = Object.fromEntries(Object.entries(defaults).filter(([, value]) => value !== "" && value != null));
      const cleanPlacements = Object.fromEntries(Object.entries(placements).filter(([, value]) => value === "inline"));
      const payload: NodeFormManifest = {
        version: 1,
        form: { groups },
        ...(Object.keys(cleanDefaults).length ? { defaults: cleanDefaults } : {}),
        ...(Object.keys(cleanPlacements).length ? { placements: cleanPlacements } : {}),
        ...(hasPortPresentation(portPresentation) ? { portPresentation } : {}),
      };
      await apiClient.saveNodeTypeManifest(nodeType.id, payload);
      setInitialSnapshot(currentSnapshot);
      setSaved(true);
      onReload?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }, [currentSnapshot, defaults, groups, isDirty, nodeType, onReload, placements, portPresentation]);

  const handleReset = useCallback(async () => {
    if (!nodeType) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.deleteNodeTypeManifest(nodeType.id);
      const nextGroups = nodeType.form?.groups ?? [];
      setGroups(nextGroups);
      setDefaults({});
      setPlacements({});
      setPortPresentation({});
      setInitialSnapshot(snapshotOf({ groups: nextGroups, defaults: {}, placements: {}, portPresentation: {} }));
      setSaved(true);
      onReload?.();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "重置失败，请重试");
    } finally {
      setSaving(false);
    }
  }, [nodeType, onReload]);

  if (loading) return <div className="node-type-editor editor-loading">正在加载节点表单…</div>;

  if (!nodeType) {
    return (
      <div className="node-type-editor editor-fatal-state">
        <strong>找不到节点类型</strong>
        <p>节点 “{nodeTypeId}” 可能已被移动或删除，请刷新节点库后重试。</p>
        <button type="button" onClick={onBack}><ArrowLeft size={15} /> 返回节点资产</button>
      </div>
    );
  }

  return (
    <div className={`node-type-editor${embedded ? " is-embedded" : ""}`}>
      <header className="editor-header">
        {!embedded ? (
          <>
            <Button className="editor-back" leftSection={<ArrowLeft size={16} />} size="compact-sm" variant="subtle" onClick={onBack}>
              <span>节点资产</span>
            </Button>
            <ChevronRight className="editor-breadcrumb-separator" size={14} />
          </>
        ) : null}
        <div className="editor-node-info">
          <NodeTypeIcon icon={nodeType.icon} size={18} />
          <div>
            <strong>{nodeType.displayName || nodeType.name}</strong>
            <small>{nodeType.id}</small>
          </div>
          <Badge className={nodeType.package ? "editor-package-badge" : "editor-local-badge"} color={nodeType.package ? "indigo" : "teal"} radius="sm" size="xs" variant="light">
            {nodeType.package ? `${nodeType.package.name} · v${nodeType.package.version}` : "本地脚本"}
          </Badge>
        </div>
        <div className="editor-save-state" aria-live="polite">
          {saved ? <><Check size={14} /> 已保存</> : isDirty ? <><span /> 有未保存更改</> : null}
        </div>
        <div className="editor-actions">
          {nodeType.sourcePath && onOpenSource ? (
            <Button aria-label="打开源文件" disabled={openingSourcePath === nodeType.sourcePath} leftSection={<FileCode2 size={15} />} size="compact-sm" title="打开源文件" variant="default" onClick={() => onOpenSource(nodeType.sourcePath!)}><span>源文件</span></Button>
          ) : null}
          {!isReadonly ? (
            <>
              <Button aria-label="恢复源码定义" className="editor-reset-button" disabled={saving} leftSection={<RefreshCw size={15} />} size="compact-sm" title="恢复源码定义" variant="subtle" onClick={handleReset}><span>恢复源码定义</span></Button>
              <Button aria-label="保存更改" className="primary-button" disabled={saving || !isDirty} leftSection={<Save size={15} />} loading={saving} size="compact-sm" title="保存更改" onClick={handleSave}><span>{saving ? "保存中…" : "保存更改"}</span></Button>
            </>
          ) : null}
        </div>
      </header>

      {error ? <div className="editor-error" role="alert">{error}</div> : null}

      {isReadonly ? (
        <div className="editor-readonly-overlay">
          <Layers3 size={30} />
          <strong>这是已安装节点包中的只读节点</strong>
          <p>你可以查看它的表单结构。如需修改，请打开源文件或创建一个本地脚本节点。</p>
        </div>
      ) : (
        <div className="editor-body">
          <aside className="editor-left" aria-label="表单结构">
            <div className="editor-pane-title">
              <div><Text fw={750} size="sm">{editorMode === "form" ? "表单呈现" : "端口呈现"}</Text><Text c="dimmed" size="xs">{editorMode === "form" ? `${groups.length} 个分组 · ${fieldCount} 个字段` : "结构由 Python 源码定义"}</Text></div>
              {editorMode === "form" ? <Tooltip label="添加分组"><ActionIcon aria-label="添加分组" className="editor-icon-btn" size="lg" variant="light" onClick={addGroup}><Plus size={16} /></ActionIcon></Tooltip> : null}
            </div>
            <SegmentedControl
              aria-label="节点编辑范围"
              className="editor-mode-switch"
              data={[{ value: "form", label: "表单" }, { value: "ports", label: "端口呈现" }]}
              fullWidth
              value={editorMode}
              onChange={(value) => setEditorMode(value as "form" | "ports")}
            />

            {editorMode === "form" ? <ScrollArea className="editor-group-list" role="list" scrollbarSize={6} type="auto">
              {groups.length ? groups.map((group, groupIndex) => (
                <div className={`editor-group-block${group.id === selectedGroupId ? " is-selected" : ""}`} key={group.id} role="listitem">
                  <div className="editor-group-row">
                    <UnstyledButton className="editor-group-select" onClick={() => setSelectedGroupId(group.id)}>
                      <Layers3 size={14} />
                      <span><strong>{group.label}</strong><small>{group.fields.length} 个字段</small></span>
                    </UnstyledButton>
                    <div className="editor-row-actions">
                      <ActionIcon aria-label="上移分组" disabled={groupIndex === 0} size="sm" variant="subtle" onClick={() => moveGroup(group.id, -1)}><ArrowUp size={13} /></ActionIcon>
                      <ActionIcon aria-label="下移分组" disabled={groupIndex === groups.length - 1} size="sm" variant="subtle" onClick={() => moveGroup(group.id, 1)}><ArrowDown size={13} /></ActionIcon>
                      <ActionIcon aria-label="删除分组" className="is-danger" color="red" size="sm" variant="subtle" onClick={() => deleteGroup(group.id)}><Trash2 size={13} /></ActionIcon>
                    </div>
                  </div>

                  {group.id === selectedGroupId ? (
                    <div className="editor-field-list" role="list">
                      {group.fields.map((field, fieldIndex) => {
                        const placement = placements[field.key] ?? field.placement ?? "panel";
                        return (
                          <div className={`editor-field-item${field.key === selectedField ? " is-selected" : ""}`} key={field.key} role="listitem">
                            <UnstyledButton onClick={() => setSelectedField(field.key)}>
                              <GripVertical size={12} />
                              <span><strong>{field.label || field.key}</strong><small>{ALL_CONTROLS.find((control) => control.value === field.control)?.label}</small></span>
                              <em className={`editor-placement-badge is-${placement}`}>{placement === "inline" ? "卡片" : "面板"}</em>
                            </UnstyledButton>
                            <div className="editor-row-actions">
                              <ActionIcon aria-label="上移字段" disabled={fieldIndex === 0} size="sm" variant="subtle" onClick={() => moveField(group.id, field.key, -1)}><ArrowUp size={12} /></ActionIcon>
                              <ActionIcon aria-label="下移字段" disabled={fieldIndex === group.fields.length - 1} size="sm" variant="subtle" onClick={() => moveField(group.id, field.key, 1)}><ArrowDown size={12} /></ActionIcon>
                            </div>
                          </div>
                        );
                      })}
                      <Button className="editor-add-field" leftSection={<Plus size={14} />} size="compact-sm" variant="subtle" onClick={() => addField(group.id)}>添加字段</Button>
                    </div>
                  ) : null}
                </div>
              )) : (
                <div className="editor-structure-empty"><Layers3 size={24} /><strong>还没有表单分组</strong><span>先创建一个分组，再向里面添加字段。</span><Button leftSection={<Plus size={14} />} size="compact-sm" variant="light" onClick={addGroup}>创建第一个分组</Button></div>
              )}
            </ScrollArea> : displayedPorts ? <PortPresentationList
              nodeType={displayedPorts}
              selectedPort={selectedPort}
              onMove={movePort}
              onSelect={setSelectedPort}
            /> : null}
          </aside>

          <main className="editor-preview" aria-label="节点实时预览">
            <div className="editor-preview-heading">
              <div><strong>实时预览</strong><span>{editorMode === "ports" ? "端口显示会立即反映在节点卡片上" : "与工作流画布使用同一节点卡片"}</span></div>
              <span>画布节点</span>
            </div>
            <div className="editor-preview-stage">
              <NodePortsPreview
                defaults={defaults}
                groups={groups}
                nodeType={displayedPorts ?? nodeType}
                selectedField={selectedField}
                onSelectField={selectFieldByKey}
              />
            </div>
          </main>

          <aside className="editor-right" aria-label="属性设置">
            <div className="editor-pane-title"><div><Text fw={750} size="sm">属性设置</Text><Text c="dimmed" size="xs">{editorMode === "ports" ? "仅调整端口呈现，不改变 Python 契约" : selectedFieldDefinition ? "正在编辑字段" : "选择一个字段"}</Text></div></div>
            {editorMode === "ports" ? selectedPort && selectedPortDefinition ? (
              <div className="editor-inspector">
                <section className="editor-inspector-section editor-contract-note">
                  <strong>Python 端口契约</strong>
                  <span>handle、类型、必填和连接规则由源码控制；这里不会新增、删除或修改真实端口。</span>
                </section>
                <section className="editor-inspector-section">
                  <div className="editor-inspector-section-title"><span>{selectedPort.direction === "inputs" ? "输入端口" : "输出端口"}</span></div>
                  <PortPresentationEditor
                    handle={selectedPort.handle}
                    port={selectedPortDefinition}
                    presentation={portPresentation[selectedPort.direction]?.[selectedPort.handle]}
                    onChange={(patch) => updatePortPresentation(selectedPort.direction, selectedPort.handle, patch)}
                  />
                </section>
              </div>
            ) : <div className="editor-inspector-empty"><strong>没有可呈现的端口</strong><span>请在 Python 节点类中声明 inputs 或 outputs。</span></div> : selectedGroup ? (
              <div className="editor-inspector">
                <section className="editor-inspector-section">
                  <div className="editor-inspector-section-title"><span>分组</span></div>
                  <TextInput label="分组名称" maxLength={60} size="sm" value={selectedGroup.label} onChange={(event) => updateGroup(selectedGroup.id, { label: event.target.value })} />
                  <TextInput label="分组说明" maxLength={160} placeholder="可选，帮助理解这组配置" size="sm" value={selectedGroup.description ?? ""} onChange={(event) => updateGroup(selectedGroup.id, { description: event.target.value || undefined })} />
                </section>

                {selectedFieldDefinition ? (
                  <section className="editor-inspector-section">
                    <div className="editor-inspector-section-title"><span>字段</span><Button className="editor-delete-link" color="red" leftSection={<Trash2 size={13} />} size="compact-xs" variant="subtle" onClick={() => deleteField(selectedGroup.id, selectedFieldDefinition.key)}>删除</Button></div>
                    <FieldDetailEditor
                      configKeys={configKeys}
                      defaults={defaults}
                      field={selectedFieldDefinition}
                      groups={groups}
                      placement={placements[selectedFieldDefinition.key] ?? selectedFieldDefinition.placement ?? "panel"}
                      onDefaultChange={(value) => setDefaults((current) => ({ ...current, [selectedFieldDefinition.key]: value }))}
                      onPlacementChange={(placement) => setFieldPlacement(selectedFieldDefinition.key, placement)}
                      onUpdate={(patch) => updateField(selectedGroup.id, selectedFieldDefinition.key, patch)}
                    />
                  </section>
                ) : (
                  <div className="editor-inspector-empty"><strong>选择一个字段</strong><span>从左侧结构或中间预览中点击字段，在这里修改它的控件和展示方式。</span></div>
                )}
              </div>
            ) : <div className="editor-inspector-empty"><strong>选择一个分组</strong><span>创建或选择分组后即可编辑表单结构。</span></div>}
          </aside>
        </div>
      )}
    </div>
  );
}

type PortPresentationListProps = {
  nodeType: NodeType;
  selectedPort: SelectedPort | null;
  onMove: (direction: PortDirection, handle: string, shift: -1 | 1) => void;
  onSelect: (selection: SelectedPort) => void;
};

function PortPresentationList({ nodeType, selectedPort, onMove, onSelect }: PortPresentationListProps) {
  return (
    <ScrollArea className="editor-group-list editor-port-list" role="list" scrollbarSize={6} type="auto">
      <div className="editor-contract-banner">
        <strong>端口结构来自 Python</strong>
        <span>这里只调整用户看到的名称、说明、顺序和默认折叠状态。</span>
      </div>
      {(["inputs", "outputs"] as const).map((direction) => {
        const ports = Object.entries(nodeType[direction]);
        return (
          <section className="editor-port-section" key={direction}>
            <div className="editor-port-section-title"><span>{direction === "inputs" ? "输入" : "输出"}</span><small>{ports.length} 个</small></div>
            {ports.length ? ports.map(([handle, port], index) => {
              const selected = selectedPort?.direction === direction && selectedPort.handle === handle;
              return (
                <div className={`editor-port-item${selected ? " is-selected" : ""}`} key={handle} role="listitem">
                  <UnstyledButton onClick={() => onSelect({ direction, handle })}>
                    <GripVertical size={12} />
                    <span><strong>{port.displayName || handle}</strong><small>{handle}{port.collapsed ? " · 默认收起" : ""}</small></span>
                    <i className={direction === "inputs" ? "is-input" : "is-output"} />
                  </UnstyledButton>
                  <div className="editor-row-actions">
                    <ActionIcon aria-label="上移端口" disabled={index === 0} size="sm" variant="subtle" onClick={() => onMove(direction, handle, -1)}><ArrowUp size={12} /></ActionIcon>
                    <ActionIcon aria-label="下移端口" disabled={index === ports.length - 1} size="sm" variant="subtle" onClick={() => onMove(direction, handle, 1)}><ArrowDown size={12} /></ActionIcon>
                  </div>
                </div>
              );
            }) : <div className="editor-port-empty">Python 未声明{direction === "inputs" ? "输入" : "输出"}端口</div>}
          </section>
        );
      })}
    </ScrollArea>
  );
}

type PortPresentationEditorProps = {
  handle: string;
  port: NodeType["inputs"][string];
  presentation?: NodePortPresentation;
  onChange: (patch: Partial<NodePortPresentation>) => void;
};

function PortPresentationEditor({ handle, port, presentation, onChange }: PortPresentationEditorProps) {
  const schemaType = typeof port.schema?.type === "string" ? port.schema.type : "任意";
  return (
    <div className="editor-field-form">
      <TextInput label="端口 handle（源码只读）" readOnly value={handle} />
      <TextInput label="显示名称" maxLength={60} placeholder={handle} value={presentation?.displayName ?? port.displayName ?? ""} onChange={(event) => onChange({ displayName: event.target.value })} />
      <Textarea autosize label="说明文字" maxLength={200} minRows={3} placeholder="告诉用户这个端口传递什么数据（可选）" value={presentation?.description ?? port.description ?? ""} onChange={(event) => onChange({ description: event.target.value })} />
      <div className="editor-port-contract-grid" aria-label="Python 声明的端口规则">
        <span><small>数据类型</small><strong>{schemaType}</strong></span>
        {typeof port.required === "boolean" ? <span><small>必填</small><strong>{port.required ? "是" : "否"}</strong></span> : null}
        <span><small>最大连接</small><strong>{port.maxConnections == null ? "不限" : port.maxConnections}</strong></span>
      </div>
      <Switch checked={Boolean(presentation?.collapsed ?? port.collapsed)} label="默认收起到“更多端口”" labelPosition="left" onChange={(event) => onChange({ collapsed: event.currentTarget.checked })} />
      <Text c="dimmed" size="xs">收起只影响节点卡片呈现；不会删除端口、改变现有工作流连线或修改 Python 执行逻辑。</Text>
    </div>
  );
}

type FieldDetailEditorProps = {
  configKeys: string[];
  defaults: Record<string, unknown>;
  field: NodeFormField;
  groups: NodeFormGroup[];
  placement: "inline" | "panel";
  onDefaultChange: (value: unknown) => void;
  onPlacementChange: (placement: "inline" | "panel") => void;
  onUpdate: (patch: Partial<NodeFormField>) => void;
};

function FieldDetailEditor({ configKeys, defaults, field, groups, placement, onDefaultChange, onPlacementChange, onUpdate }: FieldDetailEditorProps) {
  const usedKeys = new Set(groups.flatMap((group) => group.fields.map((candidate) => candidate.key)).filter((key) => key !== field.key));
  const availableKeys = configKeys.filter((key) => !usedKeys.has(key));
  const defaultValue = defaults[field.key] ?? "";
  const keyOptions = [
    ...(!availableKeys.includes(field.key) ? [{ value: field.key, label: `${field.key}（自定义）` }] : []),
    ...availableKeys.map((key) => ({ value: key, label: key })),
  ];

  return (
    <div className="editor-field-form">
      <Select allowDeselect={false} data={keyOptions} label="配置键名" searchable value={field.key} onChange={(value) => value && onUpdate({ key: value })} />
      <TextInput label="字段名称" maxLength={60} placeholder="例如：请求地址" value={field.label ?? ""} onChange={(event) => onUpdate({ label: event.target.value || undefined })} />
      <Select allowDeselect={false} data={ALL_CONTROLS} label="控件类型" value={field.control} onChange={(value) => value && onUpdate({ control: value as NodeFormControl })} />
      <div className="editor-placement-control">
        <Text c="dimmed" fw={700} size="xs">展示位置</Text>
        <SegmentedControl
          fullWidth
          data={[
            { value: "panel", label: "配置面板" },
            { value: "inline", label: "节点卡片" },
          ]}
          value={placement}
          onChange={(value) => onPlacementChange(value as "inline" | "panel")}
        />
        <Text c="dimmed" size="xs">{placement === "inline" ? "用户可以直接在画布节点中操作" : "字段显示在节点右侧配置面板中"}</Text>
      </div>
      <Textarea autosize label="说明文字" maxLength={200} minRows={2} placeholder="告诉用户这个字段的用途（可选）" value={field.description ?? ""} onChange={(event) => onUpdate({ description: event.target.value || undefined })} />
      <TextInput label="占位提示" maxLength={100} placeholder="输入时显示的提示（可选）" value={field.placeholder ?? ""} onChange={(event) => onUpdate({ placeholder: event.target.value || undefined })} />
      {field.control === "switch" ? (
        <Switch checked={Boolean(defaultValue)} label="默认开启" labelPosition="left" onChange={(event) => onDefaultChange(event.currentTarget.checked)} />
      ) : field.control === "number" ? (
        <NumberInput label="默认值" value={typeof defaultValue === "number" ? defaultValue : ""} onChange={onDefaultChange} />
      ) : (
        <TextInput label="默认值" placeholder="可选" type={field.control === "password" ? "password" : "text"} value={typeof defaultValue === "string" ? defaultValue : ""} onChange={(event) => onDefaultChange(event.target.value)} />
      )}
    </div>
  );
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function renameKey<T>(record: Record<string, T>, previousKey: string, nextKey: string) {
  if (!(previousKey in record)) return record;
  const next = omitKey(record, previousKey);
  next[nextKey] = record[previousKey];
  return next;
}

function hasPortPresentation(value: PortPresentationState) {
  return Boolean(Object.values(value).some((direction) => direction && Object.keys(direction).length));
}

function applyPortPresentation(nodeType: NodeType, presentation: PortPresentationState): NodeType {
  const decorate = (direction: PortDirection) => {
    const ports = nodeType[direction];
    const overrides = presentation[direction] ?? {};
    return Object.fromEntries(
      Object.entries(ports)
        .map(([handle, port], sourceIndex) => ({
          handle,
          port: {
            ...port,
            ...(overrides[handle]?.displayName !== undefined ? { displayName: overrides[handle].displayName } : {}),
            ...(overrides[handle]?.description !== undefined ? { description: overrides[handle].description } : {}),
            ...(overrides[handle]?.collapsed !== undefined ? { collapsed: overrides[handle].collapsed } : {}),
          },
          sourceIndex,
          order: overrides[handle]?.order,
        }))
        .sort((left, right) => (left.order == null ? 1 : 0) - (right.order == null ? 1 : 0) || (left.order ?? left.sourceIndex) - (right.order ?? right.sourceIndex))
        .map(({ handle, port }) => [handle, port]),
    );
  };
  return { ...nodeType, inputs: decorate("inputs"), outputs: decorate("outputs") };
}

export default NodeTypeEditor;
