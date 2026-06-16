from __future__ import annotations

import traceback
from collections import defaultdict, deque
from typing import Any

from nodeflow_sdk import NodeContext

from .expressions import resolve_expression
from .node_registry import NodeRegistry
from .schemas import RunEvent, WorkflowDocument, WorkflowEdge, WorkflowNode
from .storage import Storage, utc_now


class WorkflowExecutionError(RuntimeError):
    pass


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
        incoming_count = {node.id: 0 for node in nodes}
        outgoing: dict[str, list[WorkflowEdge]] = defaultdict(list)
        for edge in edges:
            outgoing[edge.source].append(edge)
            incoming_count[edge.target] += 1

        ready = deque(node.id for node in nodes if incoming_count[node.id] == 0)
        node_inputs: dict[str, dict[str, Any]] = defaultdict(dict)
        executed: set[str] = set()

        while ready:
            node_id = ready.popleft()
            if node_id in executed:
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
            executed.add(node_id)

            for edge in outgoing.get(node_id, []):
                if edge.sourceHandle not in output_values:
                    continue
                node_inputs[edge.target][edge.targetHandle] = output_values[edge.sourceHandle]
                incoming_count[edge.target] -= 1
                if incoming_count[edge.target] == 0:
                    ready.append(edge.target)

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
            node_context = {**context, "inputs": inputs}
            condition = resolve_expression(node.config["condition"], node_context)
            output = {"true": inputs} if bool(condition) else {"false": inputs}
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
        self._event(
            run_id,
            "node_succeeded",
            node_id=node.id,
            scope=scope,
            payload={"outputs": outputs, "logs": ctx.logs},
        )
        return outputs

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
