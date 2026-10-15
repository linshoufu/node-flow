from __future__ import annotations

import asyncio
import os
import time
import traceback
from collections import defaultdict, deque
from collections.abc import Callable, Mapping
from contextvars import ContextVar
from dataclasses import asdict, dataclass, field
from typing import Any

from nodeflow_sdk import BaseNode, CredentialData, NodeContext, PreviewResult
from .preview_policy import validate_preview
from nodes.builtin.control import EachItemNode, ForEachNode, WhileNode
from nodes.builtin.logic import IfNode
from nodes.builtin.testing import RecordResultNode, SummaryNode

from .resource_profiles import validate_run_profiles
from .credentials import CredentialVault
from .credential_references import credential_reference_fields
from .execution_items import normalize_execution_items, normalize_port_execution_items
from .http_profiles import resolve_http_request_config
from .config_bindings import resolve_runtime_config, resolve_runtime_value, resolve_workflow_bindings
from .execution_policy import node_execution_error, normalize_node_execution_policy
from .node_registry import NodeRegistry, NodeRegistrySnapshot
from .node_ports import resolved_input_ports, resolved_output_ports
from .schemas import RunEvent, RunInvocation, WorkflowDocument, WorkflowEdge, WorkflowNode
from .storage import Storage, utc_now
from .workflow_connections import input_max_connections
from .workflow_static_data import WorkflowStaticDataTransaction


class WorkflowExecutionError(RuntimeError):
    pass


class WorkflowCancelled(RuntimeError):
    pass


@dataclass
class SecretRedactionScope:
    values: set[str] = field(default_factory=set)

    def register(self, value: str) -> None:
        if value:
            self.values.add(value)


@dataclass(frozen=True)
class ExecutionContext:
    deadline: float
    ancestor_run_ids: tuple[str, ...] = ()
    ancestor_workflow_ids: tuple[str, ...] = ()
    initial_input: Any = field(default_factory=dict)
    has_initial_input: bool = False
    allow_pinned_data: bool = True
    is_webhook_request: bool = False
    is_error_workflow: bool = False
    project_variables: dict[str, Any] | None = None
    environment_id: str | None = None
    environment_name: str | None = None
    credential_overrides: dict[str, str] | None = None
    webhook_response: dict[str, Any] = field(default_factory=dict)
    redaction_scope: SecretRedactionScope = field(default_factory=SecretRedactionScope)


_active_node_attempt: ContextVar[int | None] = ContextVar("active_node_attempt", default=None)
_active_redaction_scope: ContextVar[SecretRedactionScope | None] = ContextVar(
    "active_redaction_scope", default=None
)
_active_node_registry: ContextVar[NodeRegistrySnapshot | None] = ContextVar(
    "active_node_registry", default=None
)
_active_workflow_static_data: ContextVar[WorkflowStaticDataTransaction | None] = ContextVar(
    "active_workflow_static_data", default=None
)


SPECIAL_NODE_CLASSES: dict[str, type[BaseNode[Any]]] = {
    "logic.if": IfNode,
    "control.each_item": EachItemNode,
    "control.foreach": ForEachNode,
    "control.while": WhileNode,
    "test.record_result": RecordResultNode,
    "test.summary": SummaryNode,
}


class WorkflowExecutor:
    def __init__(
        self,
        *,
        storage: Storage,
        registry: NodeRegistry,
        environment: Mapping[str, Any] | None = None,
        secrets: Mapping[str, str] | None = None,
        registry_refresh: Callable[[], bool] | None = None,
    ) -> None:
        self.storage = storage
        self._registry = registry
        self.environment = dict(os.environ if environment is None else environment)
        self.secrets = dict(secrets) if secrets is not None else load_secrets_from_environment(self.environment)
        self.credential_vault = CredentialVault()
        self._registry_refresh = registry_refresh

    @property
    def registry(self) -> NodeRegistry | NodeRegistrySnapshot:
        return _active_node_registry.get() or self._registry

    def refresh_node_registry_if_changed(self) -> bool:
        if self._registry_refresh is not None:
            return self._registry_refresh()
        return self._registry.scan_if_changed()

    async def execute(
        self,
        run_id: str,
        workflow: WorkflowDocument,
        *,
        execution_context: ExecutionContext | None = None,
        entry_node_id: str | None = None,
        isolate_static_data: bool = False,
    ) -> Any:
        execution_context = execution_context or ExecutionContext(
            deadline=time.monotonic() + workflow.settings.timeout_seconds
        )
        registry_snapshot_token = None
        if _active_node_registry.get() is None:
            registry_snapshot_token = _active_node_registry.set(self._registry.snapshot())
        static_data_token = None
        commit_static_data = False
        if isolate_static_data or _active_workflow_static_data.get() is None:
            static_data_token = _active_workflow_static_data.set(
                WorkflowStaticDataTransaction(self.storage)
            )
            commit_static_data = True
        redaction_scope_token = _active_redaction_scope.set(execution_context.redaction_scope)
        try:
            return await self._execute_with_redaction_scope(
                run_id,
                workflow,
                execution_context=execution_context,
                entry_node_id=entry_node_id,
                commit_static_data=commit_static_data,
            )
        finally:
            _active_redaction_scope.reset(redaction_scope_token)
            if static_data_token is not None:
                _active_workflow_static_data.reset(static_data_token)
            if registry_snapshot_token is not None:
                _active_node_registry.reset(registry_snapshot_token)

    async def _execute_with_redaction_scope(
        self,
        run_id: str,
        workflow: WorkflowDocument,
        *,
        execution_context: ExecutionContext,
        entry_node_id: str | None,
        commit_static_data: bool,
    ) -> Any:
        self.storage.update_run(run_id, status="running")
        invocation = self.storage.get_run_invocation(run_id)
        run_mode = invocation.run_mode if invocation else "live"
        project_variables = execution_context.project_variables
        if project_variables is None:
            project_variables = dict(invocation.project_variables or {}) if invocation is not None else {}
        environment_id = execution_context.environment_id or (invocation.environment_id if invocation else "default")
        environment_name = execution_context.environment_name or (invocation.environment_name if invocation else "默认环境")
        credential_overrides = execution_context.credential_overrides
        if credential_overrides is None:
            credential_overrides = dict(invocation.credential_overrides or {}) if invocation is not None else {}
        context: dict[str, Any] = {
            "inputs": {},
            "nodes": {},
            "variables": {},
            "vars": dict(workflow.settings.variables),
            "project": project_variables,
            "environment_id": environment_id,
            "environment_name": environment_name,
            "credential_overrides": credential_overrides,
            "env": self.environment,
            "secrets": self.secrets,
            "cancel_event_sent": False,
            "execution_context": execution_context,
            "workflow_id": workflow.id,
            "workflow_input": execution_context.initial_input,
            "has_initial_input": execution_context.has_initial_input,
            "workflow_return": {},
            "run_resources": {},
            "run_parameters": dict(invocation.parameters) if invocation else {},
            "run_mode": run_mode,
            "preview_stops": set(),
            "preview_unverified": set(),
        }
        try:
            workflow = resolve_workflow_bindings(workflow, self.registry, configuration=invocation.configuration if invocation else None, parameters=invocation.parameters if invocation else None, runtime=True)
            self._assert_runtime_node_compatibility(workflow.nodes)
            if run_mode == "preview":
                validate_preview(workflow, self.registry, self.storage.get_workflow, context, _bindings_resolved=True)
                self._event(run_id, "preview_started", payload={"run_mode": run_mode, "allows_reads": True})
            validate_run_profiles(workflow.nodes, self.registry, invocation.profiles if invocation else {},
                                  self.storage.get_credential, credential_overrides, context)
            async with asyncio.timeout(max(0, execution_context.deadline - time.monotonic())):
                self._check_cancelled(run_id, context)
                await self._execute_graph(
                    run_id,
                    workflow.nodes,
                    workflow.edges,
                    context,
                    scope=[],
                    entry_node_id=entry_node_id,
                )
            if commit_static_data and run_mode != "preview":
                static_data = _active_workflow_static_data.get()
                changed_workflow_ids = static_data.commit() if static_data is not None else ()
                if changed_workflow_ids:
                    self._event(
                        run_id,
                        "workflow_static_data_saved",
                        payload={"workflow_ids": list(changed_workflow_ids)},
                    )
        except asyncio.CancelledError:
            if time.monotonic() < execution_context.deadline:
                raise
            error_message = f"Workflow timed out after {workflow.settings.timeout_seconds:g} seconds"
            await self._fail_workflow_run(run_id, workflow, execution_context, error_message)
            return {}
        except WorkflowCancelled:
            self._event(run_id, "run_cancelled")
            self.storage.update_run(run_id, status="cancelled")
            return {}
        except TimeoutError:
            error_message = f"Workflow timed out after {workflow.settings.timeout_seconds:g} seconds"
            await self._fail_workflow_run(run_id, workflow, execution_context, error_message)
            return {}
        except Exception as exc:
            error_message = self._redact(str(exc))
            self._event(
                run_id,
                "run_failed",
                payload={"error": str(exc), "traceback": traceback.format_exc()},
            )
            self.storage.update_run(run_id, status="failed", error=error_message)
            await self._run_error_workflow(run_id, workflow, execution_context, error_message)
            return {}
        if run_mode == "preview":
            partial = any(event.type == "node_not_verified" or (event.type == "node_previewed" and not event.payload.get("complete", False))
                          for event in self.storage.list_events(run_id))
            self.storage.set_run_preview_status(run_id, "partial" if partial else "complete")
            self._event(run_id, "preview_completed", payload={"verification": "partial" if partial else "complete", "static_data_committed": False})
        self._event(run_id, "run_succeeded")
        self.storage.update_run(run_id, status="succeeded")
        return context["workflow_return"]

    def _assert_runtime_node_compatibility(self, nodes: list[WorkflowNode]) -> None:
        issues: list[str] = []

        def visit(current_nodes: list[WorkflowNode]) -> None:
            for node in current_nodes:
                if not self.registry.has(node.type):
                    if node.type not in SPECIAL_NODE_CLASSES:
                        issues.append(f"节点 {node.id} 的类型 {node.type} 在当前节点库中不可用")
                else:
                    registered_type = self.registry.get(node.type)
                    if node.typeVersion < registered_type.version:
                        issues.append(
                            f"节点 {node.id}（{node.type}）需要从版本 {node.typeVersion} 升级到 {registered_type.version}"
                        )
                    elif node.typeVersion > registered_type.version:
                        issues.append(
                            f"节点 {node.id}（{node.type}）保存于版本 {node.typeVersion}，当前脚本只支持到版本 {registered_type.version}"
                        )
                for subflow in node.subflows.values():
                    visit(subflow.nodes)

        visit(nodes)
        if issues:
            raise WorkflowExecutionError("；".join(issues))

    async def _fail_workflow_run(
        self,
        run_id: str,
        workflow: WorkflowDocument,
        execution_context: ExecutionContext,
        error_message: str,
    ) -> None:
        self._event(run_id, "run_failed", payload={"error": error_message})
        self.storage.update_run(run_id, status="failed", error=error_message)
        await self._run_error_workflow(run_id, workflow, execution_context, error_message)

    async def _run_error_workflow(
        self,
        run_id: str,
        workflow: WorkflowDocument,
        execution_context: ExecutionContext,
        error_message: str,
    ) -> None:
        project_variables = execution_context.project_variables
        invocation = self.storage.get_run_invocation(run_id)
        if project_variables is None:
            project_variables = dict(invocation.project_variables) if invocation is not None else {}
        environment_id = execution_context.environment_id or (invocation.environment_id if invocation else "default")
        environment_name = execution_context.environment_name or (invocation.environment_name if invocation else "默认环境")
        credential_overrides = execution_context.credential_overrides
        if credential_overrides is None:
            credential_overrides = dict(invocation.credential_overrides or {}) if invocation is not None else {}
        error_workflow_id = workflow.settings.error_workflow_id
        if not error_workflow_id or execution_context.is_error_workflow:
            return
        if error_workflow_id == workflow.id or error_workflow_id in execution_context.ancestor_workflow_ids:
            self._event(
                run_id,
                "error_workflow_skipped",
                payload={"error_workflow_id": error_workflow_id, "reason": "recursive_reference"},
            )
            return

        error_workflow = self.storage.get_workflow(error_workflow_id)
        if error_workflow is None:
            self._event(
                run_id,
                "error_workflow_skipped",
                payload={"error_workflow_id": error_workflow_id, "reason": "workflow_not_found"},
            )
            return

        try:
            self._validate_child_workflow_boundary(error_workflow)
        except WorkflowExecutionError as exc:
            self._event(
                run_id,
                "error_workflow_skipped",
                payload={"error_workflow_id": error_workflow.id, "reason": "invalid_trigger", "error": self._redact(str(exc))},
            )
            return

        error_input = {
            "execution": {
                "error": error_message,
                "run_id": run_id,
                "workflow_id": workflow.id,
                "workflow_name": workflow.name,
                "workflow_version": workflow.version,
            }
        }
        error_run = self.storage.create_run(
            error_workflow,
            parent_run_id=run_id,
            invocation=RunInvocation(
                initial_input=error_input,
                execution_mode="error",
                allow_pinned_data=False,
                project_variables=dict(project_variables),
                environment_id=environment_id,
                environment_name=environment_name,
                credential_overrides=dict(credential_overrides),
            ),
        )
        self._event(
            run_id,
            "error_workflow_started",
            payload={
                "error_run_id": error_run.id,
                "error_workflow_id": error_workflow.id,
                "error_workflow_name": error_workflow.name,
            },
        )
        error_context = ExecutionContext(
            deadline=time.monotonic() + error_workflow.settings.timeout_seconds,
            ancestor_run_ids=(*execution_context.ancestor_run_ids, run_id),
            ancestor_workflow_ids=(*execution_context.ancestor_workflow_ids, workflow.id),
            initial_input=error_input,
            allow_pinned_data=False,
            is_error_workflow=True,
            project_variables=dict(project_variables),
            environment_id=environment_id,
            environment_name=environment_name,
            credential_overrides=dict(credential_overrides),
            redaction_scope=execution_context.redaction_scope,
        )
        await self.execute(
            error_run.id,
            error_workflow,
            execution_context=error_context,
            isolate_static_data=True,
        )
        completed_error_run = self.storage.get_run(error_run.id)
        if completed_error_run is not None and completed_error_run.status == "succeeded":
            self._event(
                run_id,
                "error_workflow_succeeded",
                payload={"error_run_id": error_run.id, "error_workflow_id": error_workflow.id},
            )
            return
        self._event(
            run_id,
            "error_workflow_failed",
            payload={
                "error_run_id": error_run.id,
                "error_workflow_id": error_workflow.id,
                "error": completed_error_run.error if completed_error_run is not None else "error run was not found",
            },
        )

    async def _execute_graph(
        self,
        run_id: str,
        nodes: list[WorkflowNode],
        edges: list[WorkflowEdge],
        context: dict[str, Any],
        *,
        scope: list[str],
        entry_node_id: str | None = None,
    ) -> None:
        node_by_id = {node.id: node for node in nodes}
        incoming_by_target: dict[str, list[WorkflowEdge]] = defaultdict(list)
        outgoing: dict[str, list[WorkflowEdge]] = defaultdict(list)
        for edge in edges:
            outgoing[edge.source].append(edge)
            incoming_by_target[edge.target].append(edge)
        reachable_from: dict[str, set[str]] = {}

        def collect_reachable_targets(node_id: str) -> set[str]:
            reachable: set[str] = set()
            pending = [edge.target for edge in outgoing.get(node_id, [])]
            while pending:
                target_id = pending.pop()
                if target_id in reachable:
                    continue
                reachable.add(target_id)
                pending.extend(edge.target for edge in outgoing.get(target_id, []))
            return reachable

        for node_id in node_by_id:
            reachable_from[node_id] = collect_reachable_targets(node_id)

        if entry_node_id is not None:
            if entry_node_id not in node_by_id:
                raise WorkflowExecutionError(f"Unknown workflow entry node: {entry_node_id}")
            root_ids = [entry_node_id]
        else:
            root_ids = [node.id for node in nodes if not incoming_by_target.get(node.id)]
        ready = deque(root_ids)
        node_inputs: dict[str, dict[str, Any]] = defaultdict(dict)
        if entry_node_id is not None and context["execution_context"].allow_pinned_data and context["run_mode"] != "preview":
            self._seed_entry_node_inputs_from_pinned_outputs(
                run_id,
                entry_node_id,
                node_by_id,
                incoming_by_target,
                node_inputs,
                scope,
            )
        active_nodes: set[str] = set(root_ids)
        queued_nodes: set[str] = set(root_ids)
        completed_nodes: set[str] = set()
        blocked_nodes: set[str] = set()

        def is_ready(node_id: str) -> bool:
            if (
                node_id not in active_nodes
                or node_id in completed_nodes
                or node_id in queued_nodes
            ):
                return False
            direct_predecessors_ready = all(
                edge.source not in active_nodes or edge.source in completed_nodes
                for edge in incoming_by_target.get(node_id, [])
            )
            if not direct_predecessors_ready:
                return False
            return not any(
                active_id != node_id
                and active_id not in completed_nodes
                and node_id in reachable_from.get(active_id, set())
                for active_id in active_nodes
            )

        while ready:
            node_id = ready.popleft()
            queued_nodes.discard(node_id)
            if node_id in completed_nodes:
                continue
            if node_id in blocked_nodes:
                continue
            self._check_cancelled(run_id, context)
            node = node_by_id[node_id]
            output_values = await self._execute_node_with_policy(
                run_id,
                node,
                context,
                scope,
                node_inputs.get(node_id, {}),
                outgoing.get(node.id, []),
            )
            self._check_cancelled(run_id, context)
            context.setdefault("nodes", {}).setdefault(node.id, {})["outputs"] = output_values
            completed_nodes.add(node_id)
            if (tuple(scope), node_id) in context.get("preview_stops", set()):
                blocked_nodes.update(reachable_from[node_id])
            outgoing_edges = outgoing.get(node_id, [])
            unhandled_outputs = {
                "error": "Unhandled error output",
                "failed": "Unhandled failed output",
                "max_reached": "Unhandled max_reached output",
            }
            for output_name, error_message in unhandled_outputs.items():
                if output_name in output_values and not any(
                    edge.sourceHandle == output_name for edge in outgoing_edges
                ):
                    raise WorkflowExecutionError(error_message)

            candidates: set[str] = set()
            for edge in outgoing_edges:
                candidates.add(edge.target)
                if edge.sourceHandle not in output_values:
                    continue
                self._append_node_input(
                    node_inputs[edge.target],
                    node_by_id[edge.target],
                    edge.targetHandle,
                    output_values[edge.sourceHandle],
                )
                active_nodes.add(edge.target)

            for target_id in candidates | active_nodes:
                if is_ready(target_id):
                    ready.append(target_id)
                    queued_nodes.add(target_id)

        for node_id in blocked_nodes - completed_nodes:
            context["preview_unverified"].add((tuple(scope), node_id))
            self._event(run_id, "node_not_verified", node_id=node_id, scope=scope,
                        payload={"reason": "上游预演未产生真实执行所需的输出"})

    def _seed_entry_node_inputs_from_pinned_outputs(
        self,
        run_id: str,
        entry_node_id: str,
        node_by_id: dict[str, WorkflowNode],
        incoming_by_target: dict[str, list[WorkflowEdge]],
        node_inputs: dict[str, dict[str, Any]],
        scope: list[str],
    ) -> None:
        entry_node = node_by_id[entry_node_id]
        for edge in incoming_by_target.get(entry_node_id, []):
            source_node = node_by_id.get(edge.source)
            if source_node is None or source_node.pinnedData is None:
                continue
            if edge.sourceHandle not in source_node.pinnedData:
                continue
            self._append_node_input(
                node_inputs[entry_node_id],
                entry_node,
                edge.targetHandle,
                source_node.pinnedData[edge.sourceHandle],
            )
            self._event(
                run_id,
                "node_pinned_input_used",
                node_id=entry_node_id,
                scope=scope,
                payload={
                    "source_node_id": source_node.id,
                    "source_handle": edge.sourceHandle,
                    "target_handle": edge.targetHandle,
                },
            )

    def _append_node_input(
        self,
        inputs: dict[str, Any],
        target_node: WorkflowNode,
        target_handle: str,
        value: Any,
    ) -> None:
        item_aware = self._input_data_mode(target_node, target_handle) == "items"
        incoming_value = normalize_execution_items(value) if item_aware else value
        if not self._input_accepts_multiple_connections(target_node, target_handle):
            inputs[target_handle] = incoming_value
            return
        current_value = inputs.setdefault(target_handle, [])
        if item_aware:
            if not isinstance(current_value, list):
                current_value = normalize_execution_items(current_value)
                inputs[target_handle] = current_value
            current_value.extend(incoming_value)
            return
        if isinstance(current_value, list):
            current_value.append(incoming_value)
        else:
            inputs[target_handle] = [current_value, incoming_value]

    def _handle_node_execution_failure(
        self,
        run_id: str,
        node: WorkflowNode,
        scope: list[str],
        exc: WorkflowExecutionError,
        outgoing_edges: list[WorkflowEdge],
        *,
        attempt: int,
    ) -> dict[str, Any]:
        policy = normalize_node_execution_policy(node.execution)
        if self.registry.has(node.type) and not self.registry.get(node.type).node_class.retry_safe and policy.retry.max_attempts > 1:
            raise WorkflowExecutionError("该节点可能产生外部写入，不支持自动重试")
        if policy.on_error == "stop":
            raise exc

        original_error = exc.__cause__ if isinstance(exc.__cause__, Exception) else exc
        error = node_execution_error(
            original_error,
            attempt=attempt,
            node_id=node.id,
            scope=scope,
            timestamp=utc_now(),
        ).model_dump(by_alias=True)
        if policy.on_error == "continue":
            self._event(
                run_id,
                "node_error_handled",
                node_id=node.id,
                scope=scope,
                payload={"mode": "continue", "error": error},
            )
            return {}

        has_error_port = self.registry.has(node.type) and "error" in resolved_output_ports(
            node, self.registry.get(node.type)
        )
        has_error_edge = any(edge.sourceHandle == "error" for edge in outgoing_edges)
        if not has_error_port or not has_error_edge:
            raise exc
        outputs = {"error": error}
        self._event(
            run_id,
            "node_error_handled",
            node_id=node.id,
            scope=scope,
            payload={"mode": "errorOutput", "error": error, "outputs": outputs},
        )
        return outputs

    async def _execute_node_with_policy(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
        outgoing_edges: list[WorkflowEdge],
    ) -> dict[str, Any]:
        if node.disabled:
            return self._skip_disabled_node(run_id, node, scope, inputs, outgoing_edges)

        policy = normalize_node_execution_policy(node.execution)
        for attempt in range(1, policy.retry.max_attempts + 1):
            attempt_token = _active_node_attempt.set(attempt)
            try:
                try:
                    return await self._execute_node(run_id, node, context, scope, inputs)
                except WorkflowCancelled:
                    raise
                except WorkflowExecutionError as exc:
                    if attempt == policy.retry.max_attempts:
                        return self._handle_node_execution_failure(
                            run_id,
                            node,
                            scope,
                            exc,
                            outgoing_edges,
                            attempt=attempt,
                        )

                    original_error = exc.__cause__ if isinstance(exc.__cause__, Exception) else exc
                    error = node_execution_error(
                        original_error,
                        attempt=attempt,
                        node_id=node.id,
                        scope=scope,
                        timestamp=utc_now(),
                    ).model_dump(by_alias=True)
                    delay_seconds = policy.retry.delay_seconds
                    self._event(
                        run_id,
                        "node_retry_scheduled",
                        node_id=node.id,
                        scope=scope,
                        payload={
                            "error": error,
                            "attempt": attempt,
                            "next_attempt": attempt + 1,
                            "delay_ms": delay_seconds * 1000,
                        },
                    )
                    await self._sleep_with_cancellation(run_id, context, delay_seconds)
            finally:
                _active_node_attempt.reset(attempt_token)

        raise AssertionError("Node execution policy exhausted without returning")

    def _skip_disabled_node(
        self,
        run_id: str,
        node: WorkflowNode,
        scope: list[str],
        inputs: dict[str, Any],
        outgoing_edges: list[WorkflowEdge],
    ) -> dict[str, Any]:
        output_handles = (
            resolved_output_ports(node, self.registry.get(node.type)) if self.registry.has(node.type) else {}
        )
        primary_output = "success" if "success" in output_handles else next(iter(output_handles), None)
        if primary_output is None or not any(edge.sourceHandle == primary_output for edge in outgoing_edges):
            outputs: dict[str, Any] = {}
        elif len(inputs) == 1:
            outputs = {primary_output: next(iter(inputs.values()))}
        else:
            outputs = {primary_output: inputs}

        self._event(
            run_id,
            "node_skipped",
            node_id=node.id,
            scope=scope,
            payload={"reason": "disabled", "outputs": outputs},
        )
        return outputs

    async def _sleep_with_cancellation(
        self,
        run_id: str,
        context: dict[str, Any],
        delay_seconds: float,
    ) -> None:
        deadline = time.monotonic() + delay_seconds
        while True:
            self._check_cancelled(run_id, context)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            await asyncio.sleep(min(remaining, 0.1))

    def _input_accepts_multiple_connections(self, target_node: WorkflowNode, target_handle: str) -> bool:
        if not self.registry.has(target_node.type):
            return False
        node_type = self.registry.get(target_node.type)
        input_meta = resolved_input_ports(target_node, node_type).get(target_handle)
        if input_meta is None:
            return False
        max_connections = input_max_connections(input_meta)
        return max_connections is None or max_connections > 1

    def _input_data_mode(self, target_node: WorkflowNode, target_handle: str) -> str:
        if not self.registry.has(target_node.type):
            return "value"
        input_meta = resolved_input_ports(target_node, self.registry.get(target_node.type)).get(target_handle)
        if input_meta is None:
            return "value"
        return "items" if input_meta.get("dataMode") == "items" else "value"

    async def _execute_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        start_payload: dict[str, Any] = {"inputs": inputs}
        item_context = self._current_item_context(context)
        if item_context is not None:
            start_payload["item_context"] = item_context
        self._event(run_id, "node_started", node_id=node.id, scope=scope, payload=start_payload)
        started_at = time.perf_counter()
        context.setdefault("nodes", {}).setdefault(node.id, {})["inputs"] = inputs
        execution_context: ExecutionContext = context["execution_context"]
        if context["run_mode"] != "preview" and execution_context.allow_pinned_data and node.pinnedData is not None:
            output = self._validate_node_outputs(run_id, node, scope, node.pinnedData, started_at=started_at)
            self._event(
                run_id,
                "node_pinned_data_used",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output},
            )
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "pinned": True, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        if node.type in {
            "workflow.trigger",
            "workflow.execute",
            "workflow.return",
            "webhook.trigger",
            "webhook.respond",
        } and not (context["run_mode"] == "preview" and node.type == "webhook.respond"):
            try:
                if node.type in {"workflow.trigger", "webhook.trigger"}:
                    output = {"success": context["workflow_input"]}
                elif node.type == "workflow.return":
                    value = inputs.get("input", {})
                    context["workflow_return"] = value
                    output = {"success": value}
                elif node.type == "webhook.respond":
                    output = self._execute_webhook_response_node(run_id, node, context, scope, inputs)
                else:
                    output = await self._execute_workflow_node(
                        run_id, node, context, scope, inputs
                    )
            except WorkflowCancelled:
                raise
            except Exception as exc:
                self._event(
                    run_id,
                    "node_failed",
                    node_id=node.id,
                    scope=scope,
                    payload={
                        "error": {"message": str(exc), "traceback": traceback.format_exc()},
                        "duration_ms": self._duration_ms(started_at),
                    },
                )
                raise WorkflowExecutionError(str(exc)) from exc
            output = self._validate_node_outputs(run_id, node, scope, output, started_at=started_at)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        if node.type == "logic.if":
            try:
                node_context = self._node_context(context, inputs)
                condition = resolve_runtime_value(node, "condition", node_context)
            except Exception as exc:
                self._event(
                    run_id,
                    "node_failed",
                    node_id=node.id,
                    scope=scope,
                    payload={
                        "error": {"message": str(exc), "traceback": traceback.format_exc()},
                        "duration_ms": self._duration_ms(started_at),
                    },
                )
                raise WorkflowExecutionError(str(exc)) from exc
            output = self._validate_node_outputs(
                run_id,
                node,
                scope,
                {"true": inputs} if bool(condition) else {"false": inputs},
                started_at=started_at,
            )
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        if node.type in {"control.foreach", "control.each_item"}:
            try:
                if node.type == "control.foreach":
                    output = await self._execute_foreach(run_id, node, context, scope, inputs)
                else:
                    output = await self._execute_each_item(run_id, node, context, scope, inputs)
            except WorkflowCancelled:
                raise
            except TimeoutError as exc:
                output = {
                    "error": {
                        "message": "For Each timed out",
                        "traceback": "".join(
                            traceback.format_exception(type(exc), exc, exc.__traceback__)
                        ),
                    }
                }
            except Exception as exc:
                output = {
                    "error": {
                        "message": str(exc),
                        "traceback": "".join(
                            traceback.format_exception(type(exc), exc, exc.__traceback__)
                        ),
                    }
                }
            output = self._validate_node_outputs(run_id, node, scope, output, started_at=started_at)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        if node.type == "control.while":
            try:
                output = await self._execute_while(run_id, node, context, scope, inputs)
            except WorkflowCancelled:
                raise
            except TimeoutError as exc:
                output = {
                    "error": {
                        "message": "While timed out",
                        "traceback": "".join(
                            traceback.format_exception(type(exc), exc, exc.__traceback__)
                        ),
                    }
                }
            except Exception as exc:
                output = {
                    "error": {
                        "message": str(exc),
                        "traceback": "".join(
                            traceback.format_exception(type(exc), exc, exc.__traceback__)
                        ),
                    }
                }
            output = self._validate_node_outputs(run_id, node, scope, output, started_at=started_at)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        if node.type == "test.record_result":
            try:
                output = self._execute_record_result(node, context, inputs)
            except Exception as exc:
                self._event(
                    run_id,
                    "node_failed",
                    node_id=node.id,
                    scope=scope,
                    payload={
                        "error": {"message": str(exc), "traceback": traceback.format_exc()},
                        "duration_ms": self._duration_ms(started_at),
                    },
                )
                raise WorkflowExecutionError(str(exc)) from exc
            output = self._validate_node_outputs(run_id, node, scope, output, started_at=started_at)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        if node.type == "test.summary":
            try:
                output = self._execute_test_summary(node, context)
            except Exception as exc:
                self._event(
                    run_id,
                    "node_failed",
                    node_id=node.id,
                    scope=scope,
                    payload={
                        "error": {"message": str(exc), "traceback": traceback.format_exc()},
                        "duration_ms": self._duration_ms(started_at),
                    },
                )
                raise WorkflowExecutionError(str(exc)) from exc
            output = self._validate_node_outputs(run_id, node, scope, output, started_at=started_at)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output, "duration_ms": self._duration_ms(started_at)},
            )
            return output
        node_context = self._node_context(context, inputs)
        ctx = NodeContext(
            run_id=run_id,
            node_id=node.id,
            scope=scope,
            secrets=self.secrets,
            data=node_context,
            workflow_id=context["workflow_id"],
            static_data=_active_workflow_static_data.get(),
            run_resources=context["run_resources"],
        )
        try:
            node_type = self.registry.get(node.type)
            resolved_config = (
                resolve_runtime_config(node, node_context)
                if node_type.node_class.resolve_config_expressions
                else node.config
            )
            resolved_config = self._apply_credential_overrides(
                node_type.form,
                resolved_config,
                context["credential_overrides"],
            )
            if node.type == "http.request":
                profile_id = resolved_config.get("http_profile_id")
                profile = self.storage.get_http_profile(profile_id) if isinstance(profile_id, str) and profile_id else None
                if isinstance(profile_id, str) and profile_id and profile is None:
                    raise WorkflowExecutionError("引用的 HTTP 配置档不存在或已删除。")
                resolved_config = resolve_http_request_config(resolved_config, profile)
            profile = {}
            credential_config = resolved_config
            profile_type = node_type.node_class.profile_type
            if profile_type is not None:
                invocation = self.storage.get_run_invocation(run_id)
                profile = dict((invocation.profiles if invocation else {}).get(resolved_config.get("profile_id"), {}))
                if not profile or profile["type_id"] != profile_type.id:
                    raise WorkflowExecutionError("节点引用的配置档不存在或类型不匹配。")
                profile["data"] = profile_type.model.model_validate(profile["data"]).model_dump(mode="json")
                credential_id = profile.get("credential_id")
                if credential_id:
                    actual_id = context["credential_overrides"].get(credential_id, credential_id)
                    record = self.storage.get_credential(actual_id)
                    if record is None or (profile_type.credential_type_ids and record.type_id not in profile_type.credential_type_ids):
                        raise WorkflowExecutionError("配置档凭据不存在或类型不匹配。")
                    profile["credential_id"] = actual_id
                    credential_config = {**resolved_config, "credential_id": actual_id}
            credentials = self._node_credentials(node_type.form, credential_config)
            ctx = NodeContext(
                run_id=run_id,
                node_id=node.id,
                scope=scope,
                secrets=self.secrets,
                credentials=credentials,
                redact_secret=self._register_credential_secret,
                data=node_context,
                workflow_id=context["workflow_id"],
                static_data=_active_workflow_static_data.get(),
                run_resources=context["run_resources"],
                profile=profile,
                run_mode=context["run_mode"],
            )
            instance = node_type.node_class(config=resolved_config)
            if context["run_mode"] == "preview":
                if instance.preview_support == "execute" and instance.effect in {"pure", "read"}:
                    outputs = await instance.execute(ctx, inputs)
                elif instance.preview_support == "plan":
                    preview = await instance.preview(ctx, inputs)
                    if not isinstance(preview, PreviewResult):
                        raise WorkflowExecutionError("预演接口必须返回 PreviewResult")
                    outputs = preview.outputs
                    if not preview.complete:
                        context["preview_stops"].add((tuple(scope), node.id))
                    self._event(run_id, "node_previewed", node_id=node.id, scope=scope,
                                payload={"effects": [asdict(effect) for effect in preview.effects],
                                         "complete": preview.complete, "outputs": outputs})
                else:
                    raise WorkflowExecutionError("此节点不支持预演，不能执行")
            else:
                outputs = await instance.execute(ctx, inputs)
            outputs = instance.validate_outputs(outputs, instance.config)
        except Exception as exc:
            self._event(
                run_id,
                "node_failed",
                node_id=node.id,
                scope=scope,
                payload={
                    "error": {"message": str(exc), "traceback": traceback.format_exc()},
                    "logs": ctx.logs,
                    "duration_ms": self._duration_ms(started_at),
                },
            )
            raise WorkflowExecutionError(str(exc)) from exc
        self._event(
            run_id,
            "node_succeeded",
            node_id=node.id,
            scope=scope,
            payload={"outputs": outputs, "logs": ctx.logs, "duration_ms": self._duration_ms(started_at), "run_mode": context["run_mode"]},
        )
        return outputs

    def _node_credentials(
        self, form: Mapping[str, Any] | None, config: Mapping[str, Any]
    ) -> dict[str, CredentialData]:
        credentials: dict[str, CredentialData] = {}
        for _, credential_id, _ in credential_reference_fields(config, form):
            record = self.storage.get_credential(credential_id)
            if record is None:
                raise WorkflowExecutionError("引用的凭据不存在或已删除。")
            credential_data = self.credential_vault.decrypt(record.encrypted_data)
            for value in credential_data.values():
                self._register_credential_secret(value)
            credentials[credential_id] = CredentialData(
                id=record.id,
                type_id=record.type_id,
                name=record.name,
                data=credential_data,
            )
        return credentials

    def _apply_credential_overrides(
        self,
        form: Mapping[str, Any] | None,
        config: Mapping[str, Any],
        credential_overrides: Mapping[str, str],
    ) -> dict[str, Any]:
        resolved_config = dict(config)
        for field_key, credential_id, _ in credential_reference_fields(config, form):
            actual_credential_id = credential_overrides.get(credential_id)
            if actual_credential_id:
                resolved_config[field_key] = actual_credential_id
        return resolved_config

    def _register_credential_secret(self, value: str) -> None:
        redaction_scope = _active_redaction_scope.get()
        if redaction_scope is not None:
            redaction_scope.register(value)

    async def _execute_workflow_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        resolved_config = resolve_runtime_config(node, self._node_context(context, inputs))
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=resolved_config)
        child = self.storage.get_workflow(instance.config.workflow_id)
        if child is None:
            raise WorkflowExecutionError(f"找不到目标工作流：{instance.config.workflow_id}")

        execution_context: ExecutionContext = context["execution_context"]
        workflow_ids = (*execution_context.ancestor_workflow_ids, context["workflow_id"])
        if child.id in workflow_ids:
            raise WorkflowExecutionError("不允许工作流直接或间接递归调用自身。")
        self._validate_child_workflow_boundary(child)

        child_run = self.storage.create_run(
            child,
            parent_run_id=run_id,
            parent_node_id=node.id,
            invocation=RunInvocation(
                initial_input=inputs.get("input", {}),
                execution_mode="child",
                allow_pinned_data=False,
                project_variables=dict(context["project"]),
                environment_id=context["environment_id"],
                environment_name=context["environment_name"],
                credential_overrides=dict(context["credential_overrides"]),
            ),
        )
        self._event(
            run_id,
            "child_run_started",
            node_id=node.id,
            scope=scope,
            payload={
                "child_run_id": child_run.id,
                "child_workflow_id": child.id,
                "child_workflow_name": child.name,
            },
        )
        child_context = ExecutionContext(
            deadline=min(
                execution_context.deadline,
                time.monotonic() + child.settings.timeout_seconds,
            ),
            ancestor_run_ids=(*execution_context.ancestor_run_ids, run_id),
            ancestor_workflow_ids=workflow_ids,
            initial_input=inputs.get("input", {}),
            allow_pinned_data=False,
            project_variables=dict(context["project"]),
            environment_id=context["environment_id"],
            environment_name=context["environment_name"],
            credential_overrides=dict(context["credential_overrides"]),
            redaction_scope=execution_context.redaction_scope,
        )
        try:
            child_output = await self.execute(
                child_run.id,
                child,
                execution_context=child_context,
            )
        except asyncio.CancelledError:
            pending_child_run = self.storage.get_run(child_run.id)
            if pending_child_run is not None and pending_child_run.status == "running":
                error_message = "子工作流在完成前被父运行中断。"
                self._event(child_run.id, "run_failed", payload={"error": error_message})
                self.storage.update_run(child_run.id, status="failed", error=error_message)
            raise
        self._check_cancelled(run_id, context)
        completed_child_run = self.storage.get_run(child_run.id)
        if completed_child_run is None:
            raise WorkflowExecutionError(f"找不到子工作流运行：{child_run.id}")
        if completed_child_run.status == "succeeded":
            if completed_child_run.preview_status == "partial":
                context["preview_stops"].add((tuple(scope), node.id))
                self._event(run_id, "node_previewed", node_id=node.id, scope=scope,
                            payload={"complete": False, "effects": [], "reason": "子工作流仅完成部分预演"})
            output = {"success": child_output}
            self._event(
                run_id,
                "child_run_succeeded",
                node_id=node.id,
                scope=scope,
                payload={
                    "child_run_id": child_run.id,
                    "child_workflow_id": child.id,
                    "child_workflow_name": child.name,
                    "outputs": output,
                },
            )
            return output

        error_message = completed_child_run.error or f"子运行状态为 {completed_child_run.status}"
        self._event(
            run_id,
            "child_run_failed",
            node_id=node.id,
            scope=scope,
            payload={
                "child_run_id": child_run.id,
                "child_workflow_id": child.id,
                "child_workflow_name": child.name,
                "status": completed_child_run.status,
                "error": error_message,
            },
        )
        raise WorkflowExecutionError(f"子工作流 {child.name} ({child_run.id}) 执行失败：{error_message}")

    def _execute_webhook_response_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        execution_context: ExecutionContext = context["execution_context"]
        if not execution_context.is_webhook_request:
            raise WorkflowExecutionError("Webhook response nodes require a Webhook-triggered run")
        if execution_context.webhook_response:
            raise WorkflowExecutionError("A Webhook response has already been configured for this request")

        resolved_config = resolve_runtime_config(node, self._node_context(context, inputs))
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=resolved_config)
        response = {
            "status_code": instance.config.status_code,
            "headers": dict(instance.config.headers),
            "body": inputs.get("input", {}),
        }
        execution_context.webhook_response.update(response)
        context["webhook_response"] = response
        self._event(
            run_id,
            "webhook_response_set",
            node_id=node.id,
            scope=scope,
            payload={"status_code": response["status_code"], "headers": response["headers"]},
        )
        return {"success": response["body"]}

    def _validate_child_workflow_boundary(self, workflow: WorkflowDocument) -> None:
        incoming_targets = {edge.target for edge in workflow.edges}
        root_nodes = [node for node in workflow.nodes if node.id not in incoming_targets]
        trigger_nodes = [node for node in workflow.nodes if node.type == "workflow.trigger"]
        if (
            len(trigger_nodes) != 1
            or len(root_nodes) != 1
            or root_nodes[0].id != trigger_nodes[0].id
        ):
            raise WorkflowExecutionError("子工作流必须仅以一个“工作流触发”节点开始。")

    def _execute_record_result(
        self,
        node: WorkflowNode,
        context: dict[str, Any],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=node.config)
        assertion = inputs.get("input")
        if not isinstance(assertion, dict):
            assertion = {
                "status": "failed",
                "message": "Record result input must be an assertion result object",
                "actual": assertion,
            }
        loop = context.get("loop")
        result = {
            "name": instance.config.name,
            **assertion,
        }
        if isinstance(loop, dict):
            result["index"] = loop.get("index")
            if "item" in loop:
                result["row"] = loop["item"]
        context.setdefault("test_results", []).append(result)
        return {"success": result}

    def _execute_test_summary(
        self,
        node: WorkflowNode,
        context: dict[str, Any],
    ) -> dict[str, Any]:
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=node.config)
        results = list(context.get("test_results", []))
        passed = sum(1 for result in results if result.get("status") == "passed")
        failed = sum(1 for result in results if result.get("status") == "failed")
        report = {
            "summary": {
                "total": len(results),
                "passed": passed,
                "failed": failed,
            },
            "results": results,
        }
        output_name = "failed" if instance.config.fail_run_on_failed and failed else "success"
        return {output_name: report}

    def _node_context(self, context: dict[str, Any], inputs: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in context.items() if key != "run_resources"} | {"inputs": inputs}

    def _validate_node_outputs(
        self,
        run_id: str,
        node: WorkflowNode,
        scope: list[str],
        outputs: Any,
        *,
        started_at: float | None = None,
    ) -> dict[str, Any]:
        if self.registry.has(node.type):
            node_class = self.registry.get(node.type).node_class
        else:
            node_class = SPECIAL_NODE_CLASSES[node.type]
        try:
            return node_class.validate_outputs(outputs, node.config)
        except Exception as exc:
            self._event(
                run_id,
                "node_failed",
                node_id=node.id,
                scope=scope,
                payload={
                    "error": {"message": str(exc), "traceback": traceback.format_exc()},
                    **(
                        {"duration_ms": self._duration_ms(started_at)}
                        if started_at is not None
                        else {}
                    ),
                },
            )
            raise WorkflowExecutionError(str(exc)) from exc

    async def _execute_foreach(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        async with asyncio.timeout(node.config.get("timeout_seconds", 300)):
            node_context = {**context, "inputs": inputs}
            items = resolve_runtime_value(node, "items_expression", node_context)
            if not isinstance(items, list):
                raise WorkflowExecutionError("For Each items_expression must resolve to a list")

            return await self._execute_items_loop(run_id, node, context, scope, items)

    async def _execute_each_item(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        async with asyncio.timeout(node.config.get("timeout_seconds", 300)):
            items = inputs.get("items", [])
            if not isinstance(items, list):
                raise WorkflowExecutionError("Each Item input must resolve to a list")

            return await self._execute_items_loop(
                run_id,
                node,
                context,
                scope,
                items,
            )

    async def _execute_items_loop(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        items: list[Any],
    ) -> dict[str, Any]:
        max_items = node.config.get("max_items", 100)
        if len(items) > max_items:
            raise WorkflowExecutionError(
                f"For Each item count {len(items)} exceeds max_items {max_items}"
            )

        body = node.subflows["body"]
        result_nodes = [child.id for child in body.nodes if child.type == "control.loop_output"]
        if len(result_nodes) > 1:
            raise WorkflowExecutionError("逐项循环体只能声明一个循环结果节点")
        previous_loop = context.get("loop")
        had_previous_loop = "loop" in context
        iterations: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        results: list[dict[str, Any]] = []

        try:
            for index, item in enumerate(items):
                self._check_cancelled(run_id, context)
                context["loop"] = {
                    "item": self._execution_item_json(item),
                    "index": index,
                    "item_context": self._execution_item_context(index, item),
                }
                try:
                    # Iteration outputs belong to this invocation only. In particular,
                    # a skipped return must never reuse a previous item's result.
                    iteration_context = context
                    if result_nodes:
                        iteration_context = {**context, "nodes": {
                            key: value for key, value in context.get("nodes", {}).items()
                            if key not in {child.id for child in body.nodes}
                        }}
                    await self._execute_graph(
                        run_id,
                        body.nodes,
                        body.edges,
                        iteration_context,
                        scope=[*scope, node.id, f"iteration:{index}"],
                    )
                    if result_nodes:
                        returned = iteration_context["nodes"].get(result_nodes[0], {}).get("outputs", {})
                        if "success" not in returned:
                            iteration_scope = (*scope, node.id, f"iteration:{index}")
                            if (iteration_scope, result_nodes[0]) in context["preview_unverified"]:
                                results.append({"index": index, "item": self._execution_item_json(item), "status": "unverified",
                                                "reason": "上游预演未产生本项结果"})
                                iterations.append({"index": index, "item": item, "unverified": True})
                                continue
                            raise WorkflowExecutionError("本项未到达循环结果节点")
                        results.append({"index": index, "item": self._execution_item_json(item),
                                        "status": "succeeded", "output": returned["success"]})
                except WorkflowCancelled:
                    raise
                except Exception as exc:
                    if not node.config.get("continue_on_error", False):
                        raise
                    errors.append({"index": index, "message": str(exc)})
                    results.append({"index": index, "item": self._execution_item_json(item),
                                    "status": "failed", "error": str(exc)})
                    iterations.append({"index": index, "item": item, "error": str(exc)})
                    continue
                iterations.append({"index": index, "item": item})
        finally:
            if had_previous_loop:
                context["loop"] = previous_loop
            else:
                context.pop("loop", None)

        done: dict[str, Any] = {"iterations": iterations}
        if errors:
            done["errors"] = errors
        return {"done": done, "results": results} if result_nodes else {"done": done}

    @staticmethod
    def _execution_item_json(value: Any) -> Any:
        if isinstance(value, dict) and "json" in value:
            return value["json"]
        return value

    @staticmethod
    def _execution_item_context(index: int, value: Any) -> dict[str, Any]:
        item: dict[str, Any] = {"json": WorkflowExecutor._execution_item_json(value)}
        if isinstance(value, dict):
            for key in ("binary", "pairedItem"):
                if key in value:
                    item[key] = value[key]
        return {"index": index, "item": item}

    @staticmethod
    def _current_item_context(context: dict[str, Any]) -> dict[str, Any] | None:
        loop = context.get("loop")
        if not isinstance(loop, dict):
            return None
        item_context = loop.get("item_context")
        return item_context if isinstance(item_context, dict) else None

    async def _execute_while(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        async with asyncio.timeout(node.config.get("timeout_seconds", 300)):
            body = node.subflows["body"]
            max_iterations = node.config.get("max_iterations", 100)
            previous_loop = context.get("loop")
            had_previous_loop = "loop" in context
            index = 0

            try:
                while True:
                    self._check_cancelled(run_id, context)
                    node_context = {**context, "inputs": inputs}
                    condition = resolve_runtime_value(node, "condition", node_context)
                    if not bool(condition):
                        return {"done": {"iterations": index}}
                    if index >= max_iterations:
                        return {"max_reached": {"iterations": max_iterations}}

                    context["loop"] = {"index": index}
                    try:
                        await self._execute_graph(
                            run_id,
                            body.nodes,
                            body.edges,
                            context,
                            scope=[*scope, node.id, f"iteration:{index}"],
                        )
                    finally:
                        if had_previous_loop:
                            context["loop"] = previous_loop
                        else:
                            context.pop("loop", None)
                    index += 1
            finally:
                if had_previous_loop:
                    context["loop"] = previous_loop
                else:
                    context.pop("loop", None)

    def _event(
        self,
        run_id: str,
        event_type: str,
        *,
        node_id: str | None = None,
        scope: list[str] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        event_payload = dict(payload or {})
        if event_type == "node_started" and "inputs" in event_payload and "input_items" not in event_payload:
            inputs = event_payload["inputs"]
            if isinstance(inputs, dict):
                event_payload["input_items"] = normalize_port_execution_items(inputs)
        elif (
            event_type in {"node_succeeded", "node_error_handled", "node_pinned_data_used"}
            and "outputs" in event_payload
            and "output_items" not in event_payload
        ):
            outputs = event_payload["outputs"]
            if isinstance(outputs, dict):
                event_payload["output_items"] = normalize_port_execution_items(outputs)
        attempt = _active_node_attempt.get()
        if node_id is not None and event_type.startswith("node_") and attempt is not None and "attempt" not in event_payload:
            event_payload = {**event_payload, "attempt": attempt}
        self.storage.append_event(
            RunEvent(
                run_id=run_id,
                type=event_type,
                timestamp=utc_now(),
                node_id=node_id,
                scope=scope or [],
                payload=self._redact(event_payload),
            )
        )

    def _check_cancelled(self, run_id: str, context: dict[str, Any]) -> None:
        execution_context: ExecutionContext = context["execution_context"]
        run_ids = (run_id, *execution_context.ancestor_run_ids)
        if not any(self.storage.is_run_cancel_requested(candidate) for candidate in run_ids):
            return
        if not context.get("cancel_event_sent", False):
            self._event(run_id, "run_cancel_requested")
            context["cancel_event_sent"] = True
        raise WorkflowCancelled("Run cancelled")

    def _duration_ms(self, started_at: float) -> float:
        return round((time.perf_counter() - started_at) * 1000, 3)

    def _redact(self, value: Any) -> Any:
        if isinstance(value, dict):
            return {
                self._redact(key) if isinstance(key, str) else key: self._redact(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [self._redact(item) for item in value]
        if isinstance(value, str):
            redacted = value
            redaction_scope = _active_redaction_scope.get()
            scoped_values = redaction_scope.values if redaction_scope is not None else ()
            for secret_value in (*self.secrets.values(), *scoped_values):
                if secret_value:
                    redacted = redacted.replace(secret_value, "***")
            return redacted
        return value


def load_secrets_from_environment(environment: Mapping[str, Any]) -> dict[str, str]:
    prefix = "NODE_FLOW_SECRET_"
    return {
        key.removeprefix(prefix).lower(): str(value)
        for key, value in environment.items()
        if key.startswith(prefix) and value is not None
    }
