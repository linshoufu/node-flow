from __future__ import annotations

import asyncio
import os
import time
import traceback
from collections import defaultdict, deque
from collections.abc import Mapping
from typing import Any

from nodeflow_sdk import BaseNode, NodeContext
from nodes.builtin.control import ForEachNode, WhileNode
from nodes.builtin.logic import IfNode, SetVariableNode
from nodes.builtin.testing import RecordResultNode, SummaryNode
from nodes.builtin.utility import TransformNode

from .expressions import resolve_expression
from .node_registry import NodeRegistry
from .schemas import RunEvent, WorkflowDocument, WorkflowEdge, WorkflowNode
from .storage import Storage, utc_now


class WorkflowExecutionError(RuntimeError):
    pass


SPECIAL_NODE_CLASSES: dict[str, type[BaseNode[Any]]] = {
    "logic.if": IfNode,
    "logic.set_variable": SetVariableNode,
    "utility.transform": TransformNode,
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
    ) -> None:
        self.storage = storage
        self.registry = registry
        self.environment = dict(os.environ if environment is None else environment)
        self.secrets = dict(secrets) if secrets is not None else load_secrets_from_environment(self.environment)

    async def execute(self, run_id: str, workflow: WorkflowDocument) -> None:
        self.storage.update_run(run_id, status="running")
        context: dict[str, Any] = {
            "inputs": {},
            "nodes": {},
            "variables": {},
            "env": self.environment,
            "secrets": self.secrets,
        }
        try:
            await self._execute_graph(run_id, workflow.nodes, workflow.edges, context, scope=[])
        except Exception as exc:
            error_message = self._redact(str(exc))
            self._event(
                run_id,
                "run_failed",
                payload={"error": str(exc), "traceback": traceback.format_exc()},
            )
            self.storage.update_run(run_id, status="failed", error=error_message)
            return
        self._event(run_id, "run_succeeded")
        self.storage.update_run(run_id, status="succeeded")

    async def _execute_graph(
        self,
        run_id: str,
        nodes: list[WorkflowNode],
        edges: list[WorkflowEdge],
        context: dict[str, Any],
        *,
        scope: list[str],
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

        root_ids = [node.id for node in nodes if not incoming_by_target.get(node.id)]
        ready = deque(root_ids)
        node_inputs: dict[str, dict[str, Any]] = defaultdict(dict)
        active_nodes: set[str] = set(root_ids)
        queued_nodes: set[str] = set(root_ids)
        completed_nodes: set[str] = set()

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
            node = node_by_id[node_id]
            output_values = await self._execute_node(
                run_id,
                node,
                context,
                scope,
                node_inputs.get(node_id, {}),
            )
            context.setdefault("nodes", {}).setdefault(node.id, {})["outputs"] = output_values
            completed_nodes.add(node_id)
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
                node_inputs[edge.target][edge.targetHandle] = output_values[edge.sourceHandle]
                active_nodes.add(edge.target)

            for target_id in candidates | active_nodes:
                if is_ready(target_id):
                    ready.append(target_id)
                    queued_nodes.add(target_id)

    async def _execute_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        self._event(run_id, "node_started", node_id=node.id, scope=scope, payload={"inputs": inputs})
        started_at = time.perf_counter()
        context.setdefault("nodes", {}).setdefault(node.id, {})["inputs"] = inputs
        if node.type == "logic.if":
            try:
                node_context = self._node_context(context, inputs)
                condition = resolve_expression(node.config["condition"], node_context)
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
        if node.type == "logic.set_variable":
            try:
                node_type = self.registry.get(node.type)
                instance = node_type.node_class(config=node.config)
                node_context = self._node_context(context, inputs)
                value = resolve_expression(instance.config.value, node_context)
                variables = context.setdefault("variables", {})
                variables[instance.config.name] = value
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
                {
                    "success": {
                        "name": instance.config.name,
                        "value": value,
                        "variables": dict(variables),
                    }
                },
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
        if node.type == "utility.transform":
            try:
                node_type = self.registry.get(node.type)
                instance = node_type.node_class(config=node.config)
                node_context = self._node_context(context, inputs)
                value = resolve_expression(instance.config.value, node_context)
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
                {"success": value},
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
        if node.type == "control.foreach":
            try:
                output = await self._execute_foreach(run_id, node, context, scope, inputs)
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
        node_type = self.registry.get(node.type)
        resolved_config = resolve_expression(node.config, self._node_context(context, inputs))
        instance = node_type.node_class(config=resolved_config)
        ctx = NodeContext(run_id=run_id, node_id=node.id, scope=scope, secrets=self.secrets)
        try:
            outputs = await instance.execute(ctx, inputs)
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
        try:
            outputs = instance.validate_outputs(outputs)
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
            payload={"outputs": outputs, "logs": ctx.logs, "duration_ms": self._duration_ms(started_at)},
        )
        return outputs

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
        return {**context, "inputs": inputs}

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
            return node_class.validate_outputs(outputs)
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
            items = resolve_expression(node.config["items_expression"], node_context)
            if not isinstance(items, list):
                raise WorkflowExecutionError("For Each items_expression must resolve to a list")

            max_items = node.config.get("max_items", 100)
            if len(items) > max_items:
                raise WorkflowExecutionError(
                    f"For Each item count {len(items)} exceeds max_items {max_items}"
                )

            body = node.subflows["body"]
            previous_loop = context.get("loop")
            had_previous_loop = "loop" in context
            iterations: list[dict[str, Any]] = []
            errors: list[dict[str, Any]] = []

            try:
                for index, item in enumerate(items):
                    context["loop"] = {"item": item, "index": index}
                    try:
                        await self._execute_graph(
                            run_id,
                            body.nodes,
                            body.edges,
                            context,
                            scope=[*scope, node.id, f"iteration:{index}"],
                        )
                    except Exception as exc:
                        if not node.config.get("continue_on_error", False):
                            raise
                        errors.append({"index": index, "message": str(exc)})
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
            return {"done": done}

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
                    node_context = {**context, "inputs": inputs}
                    condition = resolve_expression(node.config["condition"], node_context)
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
        self.storage.append_event(
            RunEvent(
                run_id=run_id,
                type=event_type,
                timestamp=utc_now(),
                node_id=node_id,
                scope=scope or [],
                payload=self._redact(payload or {}),
            )
        )

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
            for secret_value in self.secrets.values():
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
