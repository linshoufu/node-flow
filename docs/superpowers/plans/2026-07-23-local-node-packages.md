# Local Node Packages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manifest-defined local Python node packages with isolated load diagnostics while preserving legacy script discovery and the existing node type API.

**Architecture:** `NodeRegistry` becomes the single owner of discovery, package metadata, provenance, and the latest scan snapshot. FastAPI exposes the snapshot through a new read-only endpoint while preserving `/api/node-types` and its reload response. The web client consumes package data after a reload and displays provenance plus Chinese diagnostics without preventing healthy nodes from being used.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic, pytest, React 18, TypeScript, Vitest, Testing Library.

## Global Constraints

- Package manifests are UTF-8 JSON files named exactly `nodeflow-package.json`.
- Required manifest fields are non-empty string `id`, `name`, `version`, and non-empty string array `nodeEntrypoints`.
- Entrypoints must be `.py` files resolved inside their package directory.
- Existing loose `.py` node scripts outside manifest package directories remain loadable as legacy nodes.
- A malformed or failing package must not prevent other packages or legacy nodes from loading.
- Existing `GET /api/node-types` and `POST /api/node-types/reload` continue returning only node type arrays.
- User-visible new copy is Chinese; implementation identifiers and source structure remain English.
- The worktree is already dirty: do not reset, revert, stage, or commit unrelated work.

---

### Task 1: Build the registry package and diagnostic model

**Files:**
- Modify: `apps/api/nodeflow_api/node_registry.py`
- Modify: `tests/api/test_node_registry.py`

**Interfaces:**
- Produces `NodePackageInfo(id, name, version, description, documentation_url, icon, author, root_path, status, node_ids)`.
- Produces `NodePackageDiagnostic(code, level, message, package_id, path, entrypoint)`.
- Produces `NodeRegistryScanResult(packages, diagnostics, legacy_node_count)` from `NodeRegistry.scan()`.
- Extends `RegisteredNodeType` with `package: NodePackageInfo | None` and serializes it as camelCase `package` in `to_api_dict()`.
- Produces `NodeRegistry.list_packages()` and `NodeRegistry.scan_result` for later API work.

- [ ] **Step 1: Write registry tests for a valid manifest package and legacy compatibility**

Add helpers to `tests/api/test_node_registry.py` that write a `nodeflow-package.json` and node modules. Add these tests:

```python
def test_registry_loads_only_declared_package_entrypoints_and_records_provenance(tmp_path: Path):
    write_package_manifest(
        tmp_path / "tools",
        package_id="example.tools",
        entrypoints=["declared.py"],
    )
    write_node_file(tmp_path / "tools" / "declared.py", node_id="example.declared")
    write_node_file(tmp_path / "tools" / "ignored.py", node_id="example.ignored")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.declared")
    assert not registry.has("example.ignored")
    assert registry.get("example.declared").to_api_dict()["package"] == {
        "id": "example.tools", "name": "Tools", "version": "1.0.0"
    }
    assert result.packages[0].status == "loaded"


def test_registry_keeps_loose_scripts_outside_manifest_directories_as_legacy(tmp_path: Path):
    write_node_file(tmp_path / "scratch.py", node_id="example.legacy")
    write_package_manifest(tmp_path / "tools", package_id="example.tools", entrypoints=[])

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.get("example.legacy").to_api_dict()["package"] is None
    assert result.legacy_node_count == 1
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pytest tests/api/test_node_registry.py -k "declared_package_entrypoints or loose_scripts_outside_manifest" -q`

Expected: FAIL because `scan()` returns no result and node API lacks `package`.

- [ ] **Step 3: Add immutable package, diagnostic, and scan-result dataclasses**

In `apps/api/nodeflow_api/node_registry.py`, define the models near `RegisteredNodeType` and give each an API serializer. Use only path strings relative to `nodes_dir` in API-safe values. The minimum serialized shapes are:

```python
@dataclass(frozen=True)
class NodePackageInfo:
    id: str
    name: str
    version: str
    description: str | None
    documentation_url: str | None
    icon: str | None
    author: str | None
    root_path: Path
    status: Literal["loaded", "partial", "failed"]
    node_ids: tuple[str, ...]

    def to_api_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "documentationUrl": self.documentation_url,
            "icon": self.icon,
            "author": self.author,
            "status": self.status,
            "nodeIds": list(self.node_ids),
        }


@dataclass(frozen=True)
class NodePackageDiagnostic:
    code: str
    level: Literal["error", "warning"]
    message: str
    package_id: str | None = None
    path: str | None = None
    entrypoint: str | None = None
```

Add `package: NodePackageInfo | None` to `RegisteredNodeType`; `to_api_dict()` must emit only `id`, `name`, and `version` for a non-null package, otherwise `None`.

- [ ] **Step 4: Implement manifest discovery with explicit-entrypoint loading and legacy filtering**

Replace the current monolithic `scan()` loop with these focused methods:

```python
def scan(self) -> NodeRegistryScanResult:
    self._reset_scan_state()
    manifests = self._discover_manifests()
    self._load_manifest_packages(manifests)
    self._load_legacy_files(self._manifest_package_roots)
    self._scan_result = NodeRegistryScanResult(
        packages=tuple(self._packages),
        diagnostics=tuple(self._diagnostics),
        legacy_node_count=self._legacy_node_count,
    )
    return self._scan_result

def _discover_manifests(self) -> list[Path]:
    return sorted(self.nodes_dir.rglob("nodeflow-package.json"))

def _load_manifest_packages(self, manifest_paths: list[Path]) -> None:
    for manifest_path in manifest_paths:
        self._load_manifest_package(manifest_path)

def _load_legacy_files(self, package_roots: set[Path]) -> None:
    for file_path in sorted(self.nodes_dir.rglob("*.py")):
        if not any(file_path.resolve().is_relative_to(root) for root in package_roots):
            self._load_legacy_file(file_path)

def _load_file(self, file_path: Path, package: NodePackageInfo | None = None) -> list[str]:
    return self._register_module_classes(file_path, package)
```

Parse JSON with `json.loads(manifest_path.read_text(encoding="utf-8"))`. Track every directory containing a manifest, even invalid ones, so their nested Python files are never accidentally reinterpreted as legacy nodes. Use `file_path.resolve().is_relative_to(package_root.resolve())` after resolving each entrypoint and reject `.py` paths that escape the root. Keep `scan()` deterministic by sorting manifests and entrypoints.

When an entrypoint succeeds, attach the candidate package to each newly registered node. Do not replace an existing registered node ID. Preserve the old public `get()`, `has()`, and `list_node_types()` methods.

- [ ] **Step 5: Run the registry tests to verify the valid-package path passes**

Run: `pytest tests/api/test_node_registry.py -k "declared_package_entrypoints or loose_scripts_outside_manifest" -q`

Expected: PASS.

### Task 2: Isolate manifest failures and duplicate conflicts

**Files:**
- Modify: `apps/api/nodeflow_api/node_registry.py`
- Modify: `tests/api/test_node_registry.py`

**Interfaces:**
- Consumes the Task 1 scan model.
- Produces stable diagnostic codes: `package_manifest_invalid`, `package_id_duplicate`, `package_entrypoint_invalid`, `package_entrypoint_missing`, `package_entrypoint_load_failed`, and `node_id_duplicate`.
- `NodeRegistry.scan()` never raises because one discovered package is malformed or one package entrypoint fails.

- [ ] **Step 1: Write failure-isolation tests**

Add these parametrized or individual tests to `tests/api/test_node_registry.py`:

```python
def test_invalid_manifest_is_diagnostic_and_does_not_block_other_nodes(tmp_path: Path):
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "nodeflow-package.json").write_text("{", encoding="utf-8")
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")

    result = NodeRegistry(nodes_dir=tmp_path).scan()

    assert {issue.code for issue in result.diagnostics} == {"package_manifest_invalid"}
    assert result.legacy_node_count == 1


def test_missing_and_failing_entrypoints_are_isolated_with_diagnostics(tmp_path: Path):
    write_package_manifest(
        tmp_path / "tools", package_id="example.tools", entrypoints=["missing.py", "broken.py", "ok.py"]
    )
    (tmp_path / "tools" / "broken.py").write_text("raise RuntimeError('boom')", encoding="utf-8")
    write_node_file(tmp_path / "tools" / "ok.py", node_id="example.ok")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.has("example.ok")
    assert {issue.code for issue in result.diagnostics} == {
        "package_entrypoint_missing", "package_entrypoint_load_failed"
    }
    assert result.packages[0].status == "partial"


def test_duplicate_package_ids_are_diagnostics_with_stable_first_winner(tmp_path: Path):
    write_package_manifest(tmp_path / "a", package_id="example.same", entrypoints=["node.py"])
    write_package_manifest(tmp_path / "b", package_id="example.same", entrypoints=["node.py"])
    write_node_file(tmp_path / "a" / "node.py", node_id="example.first", class_name="FirstNode")
    write_node_file(tmp_path / "b" / "node.py", node_id="example.second", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.get("example.first").name == "FirstNode"
    assert not registry.has("example.second")
    assert [issue.code for issue in result.diagnostics] == ["package_id_duplicate"]
    assert [package.status for package in result.packages] == ["loaded", "failed"]


def test_duplicate_node_ids_are_diagnostic_with_stable_first_winner(tmp_path: Path):
    write_node_file(tmp_path / "a.py", node_id="example.duplicate", class_name="FirstNode")
    write_node_file(tmp_path / "b.py", node_id="example.duplicate", class_name="SecondNode")

    registry = NodeRegistry(nodes_dir=tmp_path)
    result = registry.scan()

    assert registry.get("example.duplicate").name == "FirstNode"
    assert [issue.code for issue in result.diagnostics] == ["node_id_duplicate"]
```

Also cover `../outside.py` and a non-`.py` entrypoint, asserting `package_entrypoint_invalid`.

- [ ] **Step 2: Run failure tests to verify they fail**

Run: `pytest tests/api/test_node_registry.py -k "invalid_manifest or missing_and_failing or duplicate_package or entrypoint_invalid" -q`

Expected: FAIL because malformed files still raise or do not yield diagnostics.

- [ ] **Step 3: Convert package parsing and entrypoint load errors into diagnostics**

Implement a small `_record_diagnostic()` helper that appends immutable diagnostic values. Validate manifest values before constructing a package. On duplicate package ID, mark the later package failed and do not load its entries. Wrap each `_load_file()` invocation in `try/except Exception` at package entrypoint scope; record only `str(exc)` inside a Chinese developer-facing message, never a traceback.

Change `_register()` to receive `file_path` and `package` and return `bool`. If the ID already exists, append `node_id_duplicate`, leave the first node intact, and return `False` rather than raising. This changes duplicate behavior only during scanning, so direct validation users still receive deterministic registered types rather than a partially overwritten registry.

Compute package `status` after all entrypoints: `loaded` when it has nodes and no errors; `partial` when it has nodes plus errors; otherwise `failed`.

- [ ] **Step 4: Run the full registry suite**

Run: `pytest tests/api/test_node_registry.py -q`

Expected: PASS, including existing tests. Update the previous `test_registry_rejects_duplicate_node_ids` expectation to assert a `node_id_duplicate` diagnostic and the first node remains registered.

### Task 3: Expose scan diagnostics and migrate built-in nodes

**Files:**
- Modify: `apps/api/nodeflow_api/main.py`
- Modify: `tests/api/test_api_basics.py`
- Create: `nodes/builtin/nodeflow-package.json`
- Modify: `README.md`

**Interfaces:**
- Produces `GET /api/node-packages -> {"packages": NodePackageSummary[], "diagnostics": NodePackageDiagnostic[], "legacyNodeCount": number}`.
- Retains `GET /api/node-types -> NodeType[]` and `POST /api/node-types/reload -> NodeType[]` exactly.
- `nodes/builtin/nodeflow-package.json` declares every built-in public node source module and `id: "nodeflow.builtin"`.

- [ ] **Step 1: Write API contract tests before adding the route**

Add local `write_package_manifest()` and `write_node_file()` helpers near the existing temporary-node helpers in `tests/api/test_api_basics.py`, then add:

```python
def test_node_packages_endpoint_returns_scan_snapshot_and_node_provenance(tmp_path: Path):
    write_package_manifest(tmp_path / "tools", package_id="example.tools", entrypoints=["node.py"])
    write_node_file(tmp_path / "tools" / "node.py", node_id="example.node")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))

    assert client.get("/api/node-types").json()[0]["package"] == {
        "id": "example.tools", "name": "Tools", "version": "1.0.0"
    }
    package_scan = client.get("/api/node-packages").json()
    assert package_scan["diagnostics"] == []
    assert package_scan["legacyNodeCount"] == 0
    assert package_scan["packages"] == [
        {
            "id": "example.tools",
            "name": "Tools",
            "version": "1.0.0",
            "description": None,
            "documentationUrl": None,
            "icon": None,
            "author": None,
            "status": "loaded",
            "nodeIds": ["example.node"],
        }
    ]


def test_node_type_reload_keeps_array_response_and_updates_package_diagnostics(tmp_path: Path):
    write_node_file(tmp_path / "healthy.py", node_id="example.healthy")
    client = TestClient(create_app(database_path=":memory:", nodes_dir=tmp_path))
    (tmp_path / "broken").mkdir()
    (tmp_path / "broken" / "nodeflow-package.json").write_text("{", encoding="utf-8")

    reload_response = client.post("/api/node-types/reload")

    assert isinstance(reload_response.json(), list)
    assert reload_response.json()[0]["id"] == "example.healthy"
    assert client.get("/api/node-packages").json()["diagnostics"][0]["code"] == "package_manifest_invalid"
```

- [ ] **Step 2: Run API tests to verify they fail**

Run: `pytest tests/api/test_api_basics.py -k "node_packages_endpoint or package_diagnostics" -q`

Expected: FAIL with 404 for `/api/node-packages`.

- [ ] **Step 3: Add the read-only package route**

In `create_app()` in `apps/api/nodeflow_api/main.py`, add:

```python
@app.get("/api/node-packages")
def node_packages() -> dict[str, object]:
    return registry.scan_result.to_api_dict()
```

Do not change the two existing node-types handlers except that the existing reload continues assigning the new registry scan snapshot through `registry.scan()`.

- [ ] **Step 4: Add the built-in manifest and document authoring**

Create `nodes/builtin/nodeflow-package.json` with entrypoints for all public built-in modules (`assertions.py`, `control.py`, `data.py`, `http_request.py`, `logic.py`, `manual_trigger.py`, `schedule.py`, `testing.py`, `utility.py`, `webhook.py`, and `workflow.py`). Exclude `_schemas.py` because it is an import-only support module.

Update the README node-authoring section with one concise package example, the legacy compatibility statement, the local-trusted-code boundary, and the `/api/node-packages` diagnostic endpoint. Keep user-facing prose Chinese.

- [ ] **Step 5: Run API and built-in discovery tests**

Run: `pytest tests/api/test_api_basics.py tests/api/test_node_registry.py -q`

Expected: PASS and existing built-in node IDs remain discoverable.

### Task 4: Add client types and package diagnostic retrieval

**Files:**
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`

**Interfaces:**
- Produces `NodePackageSummary`, `NodePackageDiagnostic`, and `NodePackageScanResult` TypeScript types.
- Extends `NodeType` with `package?: NodePackageProvenance | null`.
- Produces `ApiClient.listNodePackages(): Promise<NodePackageScanResult>`.

- [ ] **Step 1: Write the client request test**

Add a Vitest case:

```tsx
it("gets node package diagnostics", async () => {
  const scan = { packages: [], diagnostics: [], legacyNodeCount: 3 };
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(scan) });
  const client = new ApiClient("http://api.test", fetchMock);

  await expect(client.listNodePackages()).resolves.toEqual(scan);
  expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/node-packages", {
    signal: expect.any(AbortSignal),
  });
});
```

- [ ] **Step 2: Run the client test to verify it fails**

Run: `pnpm --filter @node-flow/web test -- client.test.ts -t "gets node package diagnostics"`

Expected: FAIL because `listNodePackages` does not exist.

- [ ] **Step 3: Add minimal API-aligned client types and method**

Add these types in `apps/web/src/types.ts`:

```ts
export type NodePackageProvenance = { id: string; name: string; version: string };
export type NodePackageStatus = "loaded" | "partial" | "failed";
export type NodePackageSummary = NodePackageProvenance & {
  description?: string | null;
  documentationUrl?: string | null;
  icon?: string | null;
  author?: string | null;
  status: NodePackageStatus;
  nodeIds: string[];
};
export type NodePackageDiagnostic = {
  code: string;
  level: "error" | "warning";
  message: string;
  packageId?: string | null;
  path?: string | null;
  entrypoint?: string | null;
};
export type NodePackageScanResult = {
  packages: NodePackageSummary[];
  diagnostics: NodePackageDiagnostic[];
  legacyNodeCount: number;
};
```

Add `package?: NodePackageProvenance | null` to `NodeType`, import `NodePackageScanResult` in the client, and implement `return this.request("/api/node-packages")`.

- [ ] **Step 4: Run client tests**

Run: `pnpm --filter @node-flow/web test -- client.test.ts`

Expected: PASS.

### Task 5: Surface node provenance and reload diagnostics in the workbench

**Files:**
- Create: `apps/web/src/components/NodePackageDiagnostics.tsx`
- Create: `apps/web/src/components/NodePackageDiagnostics.test.tsx`
- Modify: `apps/web/src/components/NodePalette.tsx`
- Modify: `apps/web/src/components/NodePalette.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- `NodePackageDiagnostics({ scan }: { scan: NodePackageScanResult | null })` renders nothing without diagnostics; otherwise renders a Chinese, dismissible/collapsible diagnostic region grouped by `packageId`.
- `NodePalette` renders `nodeType.package` as `鍖呭悕 v鐗堟湰` and `鏈湴鑴氭湰` when package is null/absent.
- `App.reloadNodeTypes()` calls `reloadNodeTypes()` first and `listNodePackages()` second, retains loaded node types, and stores the diagnostic snapshot independently.

- [ ] **Step 1: Write component tests for provenance and diagnostics**

Add to `NodePalette.test.tsx`:

```tsx
it("shows package provenance without exposing internal ids", () => {
  render(<NodePalette nodeTypes={[{ ...nodeTypes[0], package: { id: "example.tools", name: "宸ュ叿闆?, version: "1.2.0" } }]} onAddNode={vi.fn()} />);
  expect(screen.getByText("宸ュ叿闆?v1.2.0")).toBeInTheDocument();
  expect(screen.queryByText("example.tools")).not.toBeInTheDocument();
});

it("labels a node without package provenance as a local script", () => {
  render(<NodePalette nodeTypes={nodeTypes} onAddNode={vi.fn()} />);
  expect(screen.getAllByText("鏈湴鑴氭湰").length).toBeGreaterThan(0);
});
```

Create `NodePackageDiagnostics.test.tsx` with a failing-package scan and assert its Chinese heading, package name, entrypoint, and message render; assert `null` scan or empty diagnostics renders no region.

- [ ] **Step 2: Run component tests to verify they fail**

Run: `pnpm --filter @node-flow/web test -- NodePalette.test.tsx NodePackageDiagnostics.test.tsx`

Expected: FAIL because provenance and diagnostics UI do not exist.

- [ ] **Step 3: Implement the diagnostics component and provenance labels**

Implement semantic markup:

```tsx
export function NodePackageDiagnostics({ scan }: Props) {
  if (!scan || scan.diagnostics.length === 0) return null;
  return (
    <section aria-label="鑺傜偣鍖呭姞杞介棶棰? className="node-package-diagnostics">
      <h2>鑺傜偣鍖呭姞杞介棶棰?/h2>
      {/* group diagnostics by packageId ?? "鏈瘑鍒寘" */}
    </section>
  );
}
```

For each entry show the visible package name when it can be found in `scan.packages`; otherwise use 鈥滄湭璇嗗埆鍖呪€? Show only relative entrypoint/path data returned by the API. Use `<details>` to keep individual package errors collapsible and initially open when `level === "error"`.

In `NodePalette`, add a small text row after the port summary. Do not add package IDs or filesystem paths to node cards. Extend the existing palette CSS with compact, wrapping text and error colors that match the application鈥檚 existing tokens; avoid card nesting.

- [ ] **Step 4: Integrate retrieval into reload without regressing usable nodes**

In `App.tsx`, add `nodePackageScan` state. In `reloadNodeTypes()`, await the node-type reload, set `nodeTypes` immediately, then request package diagnostics. If diagnostics request fails, retain the newly loaded types and set an existing-style Chinese message that the node reload succeeded but diagnostic details could not be obtained. When diagnostics contain errors, use a Chinese message such as 鈥滃凡鍔犺浇 N 涓妭鐐癸紝鍙戠幇 M 涓妭鐐瑰寘闂銆傗€?Render `NodePackageDiagnostics` near the workspace status/validation region, not inside a node card.

Add an `App.test.tsx` integration case that mocks a successful node reload plus diagnostics with an error, then asserts the loaded node remains in the palette and the diagnostics heading appears.

- [ ] **Step 5: Run focused web tests**

Run: `pnpm --filter @node-flow/web test -- NodePalette.test.tsx NodePackageDiagnostics.test.tsx App.test.tsx`

Expected: PASS.

### Task 6: Verify end-to-end contracts and update delivery documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-07-23-local-node-packages.md`

**Interfaces:**
- Confirms the documented local package authoring and diagnostics contract matches the implemented API and UI.

- [ ] **Step 1: Add browser smoke instructions to README**

Add Chinese instructions to create one `nodeflow-package.json` package and one intentionally invalid package. Document the expected UI: healthy package nodes appear with a source/version, while the invalid package appears in 鈥滆妭鐐瑰寘鍔犺浇闂鈥?without removing healthy nodes.

- [ ] **Step 2: Run all automated checks**

Run: `pytest tests/api -q`

Expected: all API tests pass.

Run: `pnpm --filter @node-flow/web test`

Expected: all web tests pass.

Run: `pnpm build:web`

Expected: Vite production build succeeds.

Run: `git diff --check`

Expected: exit code 0.

- [ ] **Step 3: Browser smoke test on the configured development ports**

Start or reuse the existing local services only when necessary. In the browser, add a valid temporary local package and a malformed package under the configured nodes root, click 鈥滃埛鏂拌妭鐐光€? then verify:

1. A node from the valid package can be searched and added to the canvas.
2. Its palette card shows package name and version but not its package ID/path.
3. 鈥滆妭鐐瑰寘鍔犺浇闂鈥?presents the malformed package鈥檚 Chinese diagnostic.
4. Existing built-in nodes remain available.

Remove only the temporary package artifacts created for this smoke test after verifying their resolved paths are inside the workspace.

- [ ] **Step 4: Update plan status and report verification evidence**

Mark each completed task checkbox in this plan. In the delivery summary, list modified subsystems, the exact test/build commands run, browser smoke outcome, and any intentionally deferred work (ZIP/pip/online package installation, signing, sandboxing).



