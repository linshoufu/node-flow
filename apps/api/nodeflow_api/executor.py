from __future__ import annotations

import traceback
from collections import defaultdict
from typing import Any

from nodeflow_sdk import NodeContext

from .expressions import resolve_expression
from .node_registry import NodeRegistry
from .schemas import RunEvent, WorkflowDocument, WorkflowEdge, WorkflowNode
from .storage import Storage, utc_now


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
        incoming = defaultdict(list)
        outgoing = defaultdict(list)
        for edge in edges:
            incoming[edge.target].append(edge)
            outgoing[edge.source].append(edge)
        start_nodes = [node for node in nodes if not incoming[node.id]]
        for node in start_nodes:
            await self._execute_from_node(run_id, node, node_by_id, outgoing, context, scope)

    async def _execute_from_node(
        self,
        run_id: str,
        node: WorkflowNode,
        node_by_id: dict[str, WorkflowNode],
        outgoing: dict[str, list[WorkflowEdge]],
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any] | None = None,
    ) -> None:
        output_values = await self._execute_node(run_id, node, context, scope, inputs or {})
        context.setdefault("nodes", {}).setdefault(node.id, {})["outputs"] = output_values
        for handle, value in output_values.items():
            for edge in outgoing.get(node.id, []):
                if edge.sourceHandle == handle:
                    target = node_by_id[edge.target]
                    await self._execute_from_node(
                        run_id,
                        target,
                        node_by_id,
                        outgoing,
                        context,
                        scope,
                        {edge.targetHandle: value},
                    )

    async def _execute_node(
        self,
        run_id: str,
        node: WorkflowNode,
        context: dict[str, Any],
        scope: list[str],
        inputs: dict[str, Any],
    ) -> dict[str, Any]:
        self._event(run_id, "node_started", node_id=node.id, scope=scope, payload={"inputs": inputs})
        if node.type == "logic.if":
            condition = resolve_expression(node.config["condition"], context)
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
            error_output = {"error": {"message": str(exc), "traceback": traceback.format_exc()}}
            self._event(
                run_id,
                "node_failed",
                node_id=node.id,
                scope=scope,
                payload={"error": error_output["error"], "logs": ctx.logs},
            )
            return error_output
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
