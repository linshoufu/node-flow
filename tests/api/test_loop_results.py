"""Loop data boundaries work without business-specific side channels."""
import pytest

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import WorkflowDocument
from apps.api.nodeflow_api.validation import validate_workflow


def node(node_id, kind, config=None, **extra):
    return {"id": node_id, "type": kind, "position": {"x": 0, "y": 0}, "config": config or {}, **extra}


def edge(source, output, target, input_name):
    return {"id": f"{source}_{target}", "source": source, "sourceHandle": output,
            "target": target, "targetHandle": input_name}


def document(items, *, skip_false=False, nested=False):
    body = {"nodes": [node("entry", "control.loop_input"), node("return", "control.loop_output")],
            "edges": [edge("entry", "item", "return", "value")]}
    if skip_false:
        body["nodes"].insert(1, node("branch", "logic.if", {"condition": "{{ inputs.input }}"}))
        body["edges"] = [edge("entry", "item", "branch", "input"), edge("branch", "true", "return", "value")]
    if nested:
        inner = node("inner", "control.each_item", subflows={"body": body})
        body = {"nodes": [node("outer_entry", "control.loop_input"), inner, node("outer_return", "control.loop_output")],
                "edges": [edge("outer_entry", "item", "inner", "items"), edge("inner", "results", "outer_return", "value")]}
    return WorkflowDocument.model_validate({"id": "loop-results", "name": "Loop results", "nodes": [
        node("start", "utility.transform", {"value": items}),
        node("each", "control.each_item", {"continue_on_error": True}, subflows={"body": body}),
        node("report", "utility.transform", {"value": "{{ inputs.input }}"}),
    ], "edges": [edge("start", "success", "each", "items"), edge("each", "results", "report", "input")]})


async def run_document(workflow):
    app = create_app(database_path=":memory:", execution_mode="worker")
    registry = app.state.registry
    validation = validate_workflow(workflow, registry)
    assert validation.valid, validation.issues
    saved = app.state.storage.save_workflow(workflow)
    run = app.state.storage.create_run(saved)
    await app.state.executor.execute(run.id, saved)
    assert app.state.storage.get_run(run.id).status == "succeeded"
    return next(event.payload["outputs"]["success"] for event in app.state.storage.list_events(run.id)
                if event.node_id == "report" and event.type == "node_succeeded")


@pytest.mark.asyncio
@pytest.mark.parametrize("items", [[], [None, False, 0, "", {"name": "sample"}]])
async def test_results_are_explicit_and_preserve_falsey_values(items):
    results = await run_document(document(items))
    assert results == [{"index": index, "item": item, "status": "succeeded", "output": item}
                       for index, item in enumerate(items)]


@pytest.mark.asyncio
async def test_skipped_return_never_reuses_previous_iteration_output():
    results = await run_document(document([True, False, True], skip_false=True))
    assert [value["status"] for value in results] == ["succeeded", "failed", "succeeded"]
    assert "未到达循环结果" in results[1]["error"]
    assert "output" not in results[1]


@pytest.mark.asyncio
async def test_nested_loop_returns_are_scoped_to_each_loop():
    results = await run_document(document([[1, 2], [], [3]], nested=True))
    assert [[value["output"] for value in result["output"]] for result in results] == [[1, 2], [], [3]]


def test_boundaries_are_rejected_outside_body_and_return_is_required():
    app = create_app(database_path=":memory:")
    workflow = document([])
    workflow.nodes[1].subflows["body"].nodes.pop()
    workflow.nodes[1].subflows["body"].edges = []
    issues = validate_workflow(workflow, app.state.registry).issues
    assert any(issue.code == "loop_output_required" for issue in issues)
    workflow = WorkflowDocument.model_validate({"id": "bad", "name": "Bad", "nodes": [node("entry", "control.loop_input")], "edges": []})
    assert any(issue.code == "loop_boundary_outside_body" for issue in validate_workflow(workflow, app.state.registry).issues)
