# Node Version Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workflow retain the configuration version of each Python node and safely upgrade it after its node script evolves.

**Architecture:** Every persisted workflow node has `typeVersion`. Python node classes expose deterministic, one-step config migrations. The API produces an upgrade preview without mutating storage, then applies the reviewed document only through the normal save path. The editor detects available upgrades and lets the developer apply them explicitly.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, React, TypeScript, Vitest, pytest.

## Global Constraints

- UI copy is Chinese; source identifiers remain English.
- Existing nodes and legacy workflows without `typeVersion` remain readable as version `1`.
- Opening, validating, and running a workflow must not silently persist a migration.
- A missing migration step produces a clear, structured upgrade error.

---

### Task 1: Versioned Workflow Node Contract

**Files:**
- Modify: `nodeflow_sdk/core.py`
- Modify: `apps/api/nodeflow_api/schemas.py`
- Modify: `apps/web/src/types.ts`
- Modify: `apps/web/src/lib/workflow.ts`
- Test: `tests/api/test_sdk.py`
- Test: `apps/web/src/lib/workflow.test.ts`

- [ ] Write failing tests for defaulting legacy nodes to version `1` and stamping newly created nodes with the registered type version.
- [ ] Run the targeted pytest and Vitest tests; confirm they fail because the version field is missing.
- [ ] Add `type_version` / `typeVersion` to the persisted workflow-node contracts and normalizers.
- [ ] Run the targeted tests again; confirm they pass.

### Task 2: Python Migration Contract And Upgrade Service

**Files:**
- Modify: `nodeflow_sdk/core.py`
- Create: `apps/api/nodeflow_api/workflow_node_migrations.py`
- Modify: `apps/api/nodeflow_api/validation.py`
- Test: `tests/api/test_workflow_node_migrations.py`

- [ ] Write failing tests for sequential v1-to-v2 migration, a missing step, and an invalid migrated config.
- [ ] Run the migration test module and confirm the failures are caused by the absent service.
- [ ] Add the `BaseNode.migrate_config(from_version, config)` hook and a focused service that traverses root and nested subflows, validates migrated configs, and returns a non-persisted preview.
- [ ] Run the migration tests and validation tests; confirm they pass.

### Task 3: Preview And Apply APIs

**Files:**
- Modify: `apps/api/nodeflow_api/schemas.py`
- Modify: `apps/api/nodeflow_api/main.py`
- Test: `tests/api/test_api_basics.py`

- [ ] Write failing API tests for previewing an upgrade, applying it, and returning 422 for an impossible upgrade.
- [ ] Run the selected tests and confirm the endpoints do not yet exist.
- [ ] Add preview and apply endpoints; preview returns the upgraded workflow plus changed-node details, apply saves the upgraded document as a new workflow version.
- [ ] Run selected API tests and confirm they pass.

### Task 4: Editor Review And Apply Flow

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/lib/nodeVersionUpgrades.ts`
- Test: `apps/web/src/api/client.test.ts`
- Test: `apps/web/src/lib/nodeVersionUpgrades.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] Write failing tests for upgrade API requests, Chinese upgrade summaries, and the user-confirmed editor action.
- [ ] Run the targeted Vitest files and confirm they fail before UI/API support exists.
- [ ] Add an unobtrusive Chinese “节点可升级” action near workflow controls, preview details, and explicit apply handling that refreshes the clean snapshot.
- [ ] Run targeted tests and confirm they pass.

### Task 5: Regression Verification

**Files:**
- Modify: `README.md`
- Test: `tests/api`
- Test: `apps/web/src`

- [ ] Document node author migration hooks and the explicit upgrade workflow.
- [ ] Run `pytest tests/api -q`, `pnpm --filter @node-flow/web test`, `pnpm build:web`, and `git diff --check`.
- [ ] Run browser smoke coverage: create or load a legacy node, preview upgrade, apply upgrade, save, and verify the upgrade status disappears.
