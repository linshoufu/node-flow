# 声明式节点表单契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Python 节点包声明产品化配置表单，并以 HTTP 请求节点验证条件字段与凭据选择的通用渲染能力。

**Architecture:** SDK 提供不可变 `NodeForm` 元数据，注册表在不影响节点执行的前提下序列化并隔离无效表单描述。前端将条件判断和元数据防御放在纯函数模块，将字段渲染从 `ConfigPanel` 抽到 `NodeConfigForm`；无表单或无效表单始终回退到现有 JSON Schema 自动表单。

**Tech Stack:** Python 3.12、Pydantic、FastAPI、React、TypeScript、Vitest、pytest、React Testing Library。

## Global Constraints

- 工作流 `node.config`、节点类型 ID、端口 handle 和 Pydantic 配置模型保持兼容。
- Pydantic 后端校验是唯一配置权威；表单元数据不能放宽配置验证。
- 全部用户可见文本使用中文；不显示凭据明文或内部包 ID。
- 旧节点没有 `form` 时必须继续使用现有 JSON Schema 自动表单。
- 不提交、不暂存当前脏工作区中的任何改动。

---

### Task 1: SDK 表单契约与注册表 API 元数据

**Files:**
- Modify: `nodeflow_sdk/core.py`
- Modify: `nodeflow_sdk/__init__.py`
- Modify: `apps/api/nodeflow_api/node_registry.py`
- Create: `tests/api/test_node_form_contract.py`
- Modify: `tests/api/test_node_packages.py`

**Interfaces:**
- Produces `SelectOption`, `FormCondition`, `FormField`, `FormGroup`, `NodeForm` frozen dataclasses and `NodeMeta.form`.
- Produces `NodeForm.to_dict() -> dict[str, object] | None` and `RegisteredNodeType.form` serialized as API key `form`.
- Produces registry diagnostic code `node_form_invalid` when a declared form cannot safely map to its Pydantic JSON Schema.

- [ ] **Step 1: Write failing SDK and registry tests**

```python
def test_node_decorator_exposes_form_metadata_in_api_response():
    node_type = registry.get("example.form").to_api_dict()
    assert node_type["form"] == {
        "groups": [{
            "id": "request",
            "label": "请求",
            "fields": [{"key": "method", "control": "select", "options": [{"value": "GET", "label": "GET"}]}],
        }],
    }


def test_invalid_node_form_is_diagnostic_but_node_still_registers():
    result = NodeRegistry(nodes_dir=tmp_path).scan()
    assert result.diagnostics[0].code == "node_form_invalid"
    assert registry.get("example.invalid_form").to_api_dict()["form"] is None
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `uv run pytest tests/api/test_node_form_contract.py -q`

Expected: FAIL because `NodeForm` and the API `form` field do not exist.

- [ ] **Step 3: Add immutable SDK form declarations**

```python
@dataclass(frozen=True)
class FormField:
    key: str
    control: Literal["text", "textarea", "password", "number", "switch", "select", "json", "url", "credential"] = "text"
    label: str | None = None
    description: str | None = None
    placeholder: str | None = None
    options: tuple[SelectOption, ...] = ()
    visible_when: FormCondition | None = None
    expression: Literal["allowed", "disabled", "required"] | None = None
    credential_type_ids: tuple[str, ...] = ()
```

Export these types from `nodeflow_sdk/__init__.py`, add `form: NodeForm | None` to `NodeMeta`, and allow `@node(..., form=...)`.

- [ ] **Step 4: Compile safe form metadata in the registry**

```python
def _form_api_dict(self, node_class: type[BaseNode[Any]]) -> dict[str, object] | None:
    form = node_class.__node_meta__.form
    if form is None:
        return None
    validate_node_form(form, node_class.config_schema())
    return form.to_dict()
```

Call this while registering a node. On `ValueError`, append a Chinese `NodePackageDiagnostic(code="node_form_invalid", ...)`, retain the executable node, and store `form=None`.

- [ ] **Step 5: Run focused backend tests and SDK regression**

Run: `uv run pytest tests/api/test_node_form_contract.py tests/api/test_sdk.py -q`

Expected: PASS, including JSON serialization, invalid-form isolation, and existing SDK port tests.

### Task 2: Frontend contract types and pure visibility guard

**Files:**
- Modify: `apps/web/src/types.ts`
- Create: `apps/web/src/lib/nodeForm.ts`
- Create: `apps/web/src/lib/nodeForm.test.ts`

**Interfaces:**
- Produces `NodeForm`, `NodeFormGroup`, `NodeFormField`, `NodeFormCondition`, and `NodeFormControl` frontend types.
- Produces `resolveNodeForm(form, configSchema): ResolvedNodeForm | null` and `isNodeFormVisible(condition, config): boolean`.
- `resolveNodeForm` returns `null` for unsafe API metadata, telling UI callers to use the old automatic form.

- [ ] **Step 1: Write failing pure-function tests**

```ts
it("shows a field only when its controller matches one_of", () => {
  expect(isNodeFormVisible({ field: "method", oneOf: ["POST", "PUT"] }, { method: "POST" })).toBe(true);
  expect(isNodeFormVisible({ field: "method", oneOf: ["POST", "PUT"] }, { method: "GET" })).toBe(false);
});

it("rejects a form field absent from configSchema", () => {
  expect(resolveNodeForm(badForm, { properties: { url: { type: "string" } } })).toBeNull();
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm --filter @node-flow/web test -- nodeForm.test.ts`

Expected: FAIL because `nodeForm.ts` does not exist.

- [ ] **Step 3: Define API-aligned TypeScript types and guard**

```ts
export function resolveNodeForm(form: NodeForm | undefined | null, schema: JsonSchema): ResolvedNodeForm | null {
  if (!form || !isRecord(schema.properties)) return null;
  const knownKeys = new Set(Object.keys(schema.properties));
  return form.groups.every((group) => group.fields.every((field) => knownKeys.has(field.key)))
    ? { groups: form.groups }
    : null;
}
```

Validate supported controls, unique group IDs, unique field keys, condition controller keys, `select` options, and `credentialTypeIds` shape before returning a resolved form.

- [ ] **Step 4: Run focused tests and type check**

Run: `pnpm --filter @node-flow/web test -- nodeForm.test.ts`

Expected: PASS.

Run: `pnpm --filter @node-flow/web exec tsc --noEmit`

Expected: exit code 0.

### Task 3: Generic grouped form renderer with compatibility fallback

**Files:**
- Create: `apps/web/src/components/NodeConfigForm.tsx`
- Create: `apps/web/src/components/NodeConfigForm.test.tsx`
- Modify: `apps/web/src/components/ConfigPanel.tsx`
- Modify: `apps/web/src/components/ConfigPanel.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `NodeConfigForm` consumes `node`, `nodeType`, credentials, expression references, field errors, and the existing `onConfigChange` callback.
- `NodeConfigForm` exposes `onFocusedFieldChange(key: string | null)` so `ConfigPanel` retains expression insertion behavior.
- Produces grouped rendering for valid forms, an “其他参数” fallback for schema fields not listed in form metadata, and full automatic-form fallback for missing/invalid metadata.

- [ ] **Step 1: Write failing renderer tests**

```tsx
it("renders declared groups and preserves hidden field values", async () => {
  render(<NodeConfigForm node={postNode} nodeType={httpNodeType} onConfigChange={onConfigChange} />);
  expect(screen.getByText("内容")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("请求方法"), "GET");
  expect(screen.queryByLabelText("请求体")).not.toBeInTheDocument();
  expect(postNode.config.body).toEqual({ enabled: true });
});

it("falls back to the automatic form when form metadata is unsafe", () => {
  render(<NodeConfigForm node={legacyNode} nodeType={invalidFormNodeType} onConfigChange={vi.fn()} />);
  expect(screen.getByLabelText("URL")).toBeVisible();
  expect(screen.getByText("节点表单描述无效，已使用通用配置表单。")).toBeVisible();
});
```

- [ ] **Step 2: Run focused renderer tests and verify red**

Run: `pnpm --filter @node-flow/web test -- NodeConfigForm.test.tsx`

Expected: FAIL because `NodeConfigForm` does not exist.

- [ ] **Step 3: Extract existing schema field controls into NodeConfigForm**

Move the existing `SchemaField`, `JsonField`, select, boolean, numeric, credential, validation, and field-description paths from `ConfigPanel.tsx` into the new component. Do not create a second implementation of controls. Render `fieldset` groups with Chinese legends, then append schema properties absent from the resolved form in an “其他参数” group.

- [ ] **Step 4: Integrate ConfigPanel without changing its public callback contract**

```tsx
<NodeConfigForm
  credentials={credentials}
  credentialTypes={credentialTypes}
  node={node}
  nodeType={nodeType}
  onConfigChange={onConfigChange}
  onFocusedFieldChange={setFocusedConfigKey}
  onOpenCredentialManager={onOpenCredentialManager}
/>
```

Keep ConfigPanel-owned runtime, ports, pinned output, execution policy, focus requests and tab behavior intact.

- [ ] **Step 5: Run focused component and existing ConfigPanel tests**

Run: `pnpm --filter @node-flow/web test -- NodeConfigForm.test.tsx ConfigPanel.test.tsx`

Expected: PASS; existing legacy JSON Schema, credential, expression and runtime-panel cases remain green.

### Task 4: Migrate HTTP Request node and add end-to-end contract coverage

**Files:**
- Modify: `nodes/builtin/http_request.py`
- Modify: `tests/api/test_node_form_contract.py`
- Modify: `apps/web/src/components/ConfigPanel.test.tsx`
- Modify: `README.md`

**Interfaces:**
- `HttpRequestNode` declares a `NodeForm` with “请求”, “内容”, “认证” groups and a credential-type whitelist.
- `credential_id` declares `credential_type_ids=("http.bearer", "http.basic", "http.header")`.
- `body` is visible only for `POST`, `PUT`, and `PATCH`.

- [ ] **Step 1: Write failing HTTP metadata and UI interaction tests**

```python
def test_http_request_advertises_grouped_form_contract():
    form = NodeRegistry(nodes_dir=Path("nodes")).get("http.request").to_api_dict()["form"]
    assert [group["label"] for group in form["groups"]] == ["请求", "内容", "认证"]
    assert next(field for field in form["groups"][1]["fields"] if field["key"] == "body")["visibleWhen"] == {
        "field": "method", "oneOf": ["POST", "PUT", "PATCH"]
    }
```

```tsx
it("shows request body when HTTP method becomes POST without clearing its value", async () => {
  renderHttpConfig({ method: "GET", body: { sample: true } });
  expect(screen.queryByLabelText("请求体")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("请求方法"), "POST");
  expect(screen.getByLabelText("请求体")).toHaveValue(JSON.stringify({ sample: true }, null, 2));
});
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `uv run pytest tests/api/test_node_form_contract.py -k http_request_advertises_grouped_form_contract -q`

Expected: FAIL because HTTP node does not declare `form`.

Run: `pnpm --filter @node-flow/web test -- ConfigPanel.test.tsx -t "shows request body when HTTP method becomes POST"`

Expected: FAIL because the HTTP node has no grouped form metadata.

- [ ] **Step 3: Declare HTTP form metadata**

```python
form=NodeForm(groups=(
    FormGroup("request", "请求", fields=(
        FormField("method", control="select", label="请求方法", options=HTTP_METHOD_OPTIONS),
        FormField("url", control="url", label="URL"),
        FormField("timeout_seconds", control="number", label="超时（秒）"),
    )),
    FormGroup("content", "内容", fields=(
        FormField("body", control="json", label="请求体", visible_when=METHOD_WITH_BODY),
        FormField("headers", control="json", label="请求头"),
    )),
    FormGroup("auth", "认证", fields=(
        FormField("credential_id", control="credential", label="凭据", credential_type_ids=HTTP_CREDENTIAL_TYPES),
    )),
))
```

- [ ] **Step 4: Update concise author documentation**

Add one README section showing `@node(..., form=NodeForm(...))`, the supported controls and the rule that Pydantic remains the authoritative validator. State explicitly that UI-only conditions do not alter backend required-field rules.

- [ ] **Step 5: Run backend and frontend feature suites**

Run: `uv run pytest tests/api/test_node_form_contract.py tests/api/test_node_packages.py tests/api/test_sdk.py -q`

Expected: PASS.

Run: `pnpm --filter @node-flow/web test -- NodeConfigForm.test.tsx ConfigPanel.test.tsx nodeForm.test.ts`

Expected: PASS.

### Task 5: Full verification and browser smoke

**Files:**
- Verify only; no product source changes expected.

- [ ] **Step 1: Run complete frontend suite**

Run: `pnpm --filter @node-flow/web test`

Expected: all test files pass.

- [ ] **Step 2: Run production build**

Run: `pnpm --filter @node-flow/web build`

Expected: TypeScript and Vite build exit code 0.

- [ ] **Step 3: Run scoped backend regression**

Run: `uv run pytest tests/api/test_node_form_contract.py tests/api/test_node_packages.py tests/api/test_sdk.py tests/api/test_api_node_packages.py -q`

Expected: PASS. Do not use the known malformed pre-existing `tests/api/test_node_registry.py` as evidence of this feature’s status.

- [ ] **Step 4: Browser smoke the four supported paths**

Open `http://127.0.0.1:5273`, add an HTTP 请求 node, and verify the three Chinese groups. Switch GET to POST and confirm 请求体 appears without lost value. Select a compatible saved HTTP credential and confirm only its display name appears. Add a legacy non-migrated node and confirm its existing automatic form still saves.

- [ ] **Step 5: Check scoped diff hygiene**

Run: `git diff --check -- nodeflow_sdk/core.py nodeflow_sdk/__init__.py apps/api/nodeflow_api/node_registry.py nodes/builtin/http_request.py apps/web/src/types.ts apps/web/src/lib/nodeForm.ts apps/web/src/components/NodeConfigForm.tsx apps/web/src/components/ConfigPanel.tsx apps/web/src/styles.css README.md`

Expected: exit code 0.
