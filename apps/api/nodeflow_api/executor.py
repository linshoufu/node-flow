from __future__ import annotations

import asyncio
import traceback
from collections import defaultdict, deque
from typing import Any

from nodeflow_sdk import BaseNode, NodeContext
from nodes.builtin.control import ForEachNode, WhileNode
from nodes.builtin.logic import IfNode, SetVariableNode
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
}


class WorkflowExecutor:
    def __init__(self, *, storage: Storage, registry: NodeRegistry) -> None:
        self.storage = storage
        self.registry = registry

    async def execute(self, run_id: str, workflow: WorkflowDocument) -> None:
        self.storage.update_run(run_id, status="running")
        context: dict[str, Any] = {"inputs": {}, "nodes": {}, "variables": {}}
        try:
            await self._execute_graph(run_id, workflow.nodes, workflow.edges, context, scope=[])
        except Exception as exc:
            self._event(
                run_id,
                "run_failed",
                payload={"error": str(exc), "traceback": traceback.format_exc()},
            )
            self.storage.update_run(run_id, status="failed", error=str(exc))
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
        context.setdefault("nodes", {}).setdefault(node.id, {})["inputs"] = inputs
        if node.type == "logic.if":
            try:
                node_context = {**context, "inputs": inputs}
                condition = resolve_expression(node.config["condition"], node_context)
            except Exception as exc:
                self._event(
                    run_id,
                    "node_failed",
                    node_id=node.id,
                    scope=scope,
                    payload={
                        "error": {"message": str(exc), "traceback": traceback.format_exc()},
                    },
                )
                raise WorkflowExecutionError(str(exc)) from exc
            output = self._validate_node_outputs(
                run_id,
                node,
                scope,
                {"true": inputs} if bool(condition) else {"false": inputs},
            )
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output},
            )
            return output
        if node.type == "logic.set_variable":
            try:
                node_type = self.registry.get(node.type)
                instance = node_type.node_class(config=node.config)
                node_context = {**context, "inputs": inputs}
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
            )
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output},
            )
            return output
        if node.type == "utility.transform":
            try:
                node_type = self.registry.get(node.type)
                instance = node_type.node_class(config=node.config)
                node_context = {**context, "inputs": inputs}
                value = resolve_expression(instance.config.value, node_context)
            except Exception as exc:
                self._event(
                    run_id,
                    "node_failed",
                    node_id=node.id,
                    scope=scope,
                    payload={
                        "error": {"message": str(exc), "traceback": traceback.format_exc()},
                    },
                )
                raise WorkflowExecutionError(str(exc)) from exc
            output = self._validate_node_outputs(run_id, node, scope, {"success": value})
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output},
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
            output = self._validate_node_outputs(run_id, node, scope, output)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output},
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
            output = self._validate_node_outputs(run_id, node, scope, output)
            self._event(
                run_id,
                "node_succeeded",
                node_id=node.id,
                scope=scope,
                payload={"outputs": output},
            )
            return output
        node_type = self.registry.get(node.type)
        instance = node_type.node_class(config=node.config)
        ctx = NodeContext(run_id=run_id, node_id=node.id, scope=scope)
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
                },
            )
            raise WorkflowExecutionError(str(exc)) from exc
        self._event(
            run_id,
            "node_succeeded",
            node_id=node.id,
            scope=scope,
            payload={"outputs": outputs, "logs": ctx.logs},
        )
        return outputs

    def _validate_node_outputs(
        self,
        run_id: str,
        node: WorkflowNode,
        scope: list[str],
        outputs: Any,
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
                payload={"error": {"message": str(exc), "traceback": traceback.format_exc()}},
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
                payload=payload or {},
            )
        )
