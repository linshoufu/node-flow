import asyncio

import pytest

from apps.api.nodeflow_api.config_bindings import configuration_values, resolve_runtime_config, resolve_workflow_bindings
from apps.api.nodeflow_api.node_registry import NodeRegistry
from apps.api.nodeflow_api.schemas import ConfigBinding, RunInvocation, WorkflowDocument
from apps.api.nodeflow_api.storage import Storage
from apps.api.nodeflow_api.validation import validate_workflow


@pytest.fixture
def registry(tmp_path):
    nodes = tmp_path / "nodes"
    nodes.mkdir()
    (nodes / "legacy.py").write_text('''from pydantic import Field
from nodeflow_sdk import BaseNode, NodeConfig, Input, Output, node
class Config(NodeConfig):
    limit: int = Field(ge=1, le=100)
    options: dict = {}
@node(id="test.legacy", name="Legacy", category="Test")
class Legacy(BaseNode[Config]):
    effect = "pure"
    preview_support = "execute"
    inputs = {"input": Input(required=False)}
    outputs = {"success": Output()}
    async def execute(self, ctx, inputs):
        return {"success": {"limit": self.config.limit, "options": self.config.options}}
''', encoding="utf-8")
    result = NodeRegistry(nodes_dir=nodes)
    result.scan()
    return result


def workflow(**updates):
    data = {"id": "binding", "name": "Binding", "settings": {"run_mode": "preview", "configuration": [{"name": "batch", "type": "integer", "default": 7}, {"name": "warehouse", "type": "json", "default": {"id": "demo"}}]},
            "nodes": [{"id": "legacy", "type": "test.legacy", "position": {"x": 0, "y": 0}, "config": {}, "configBindings": {"limit": {"source": "workflow", "key": "batch"}, "options.location": {"source": "workflow", "key": "warehouse"}}}], "edges": []}
    data.update(updates)
    return WorkflowDocument.model_validate(data)


def test_old_python_node_receives_plain_typed_config_without_sdk_changes(registry):
    original = workflow()
    resolved = resolve_workflow_bindings(original, registry, runtime=True)
    assert original.nodes[0].config == {}
    assert resolved.nodes[0].configBindings == original.nodes[0].configBindings
    instance = registry.get("test.legacy").node_class(config=resolved.nodes[0].config)
    assert asyncio.run(instance.execute(None, {}))["success"] == {"limit": 7, "options": {"location": {"id": "demo"}}}
    assert validate_workflow(original, registry).valid


def test_queue_snapshot_survives_workflow_edits_and_storage_reopen(tmp_path, registry):
    document = workflow()
    storage = Storage(tmp_path / "queue.sqlite3")
    storage.init_schema()
    saved = storage.save_workflow(document)
    run = storage.create_run(saved)
    storage.close()
    storage = Storage(tmp_path / "queue.sqlite3")
    invocation = storage.get_run_invocation(run.id)
    document.settings.configuration[0].default = 99
    bound = resolve_workflow_bindings(document, registry, configuration=invocation.configuration, parameters=invocation.parameters, runtime=True)
    assert bound.nodes[0].config["limit"] == 7
    assert invocation.configuration["batch"] == 7
    storage.close()


@pytest.mark.parametrize("value", ["7", False, 0, 101])
def test_wrong_types_and_node_constraints_fail_before_node_execution(registry, value):
    document = workflow()
    values = configuration_values(document)
    values["batch"] = value
    with pytest.raises(ValueError):
        resolve_workflow_bindings(document, registry, configuration=values, runtime=True)


def test_parameter_binding_without_default_defers_only_the_bound_field(registry):
    document = workflow()
    document.nodes[0].configBindings["limit"] = ConfigBinding(source="parameter", key="limit")
    # Use the built-in parameter declaration contract with a temporary registry node.
    from apps.api.nodeflow_api.schemas import WorkflowNode
    document.nodes.append(WorkflowNode(id="params", type="workflow.parameters", position={"x": 0, "y": 0}, config={"fields": [{"name": "limit", "type": "integer"}]}))
    resolved = resolve_workflow_bindings(document, registry)
    assert "limit" in resolved.nodes[0].configBindings
    from apps.api.nodeflow_api.workflow_node_validation import node_definition_issues
    assert not node_definition_issues(resolved.nodes[0], registry, "nodes.legacy")
    resolved = resolve_workflow_bindings(document, registry, parameters={"limit": 11}, runtime=True)
    assert resolved.nodes[0].config["limit"] == 11
    with pytest.raises(ValueError):
        resolve_workflow_bindings(document, registry, parameters={"limit": 0}, runtime=True)


def test_missing_references_unknown_targets_and_conflicts_are_rejected(registry):
    for bindings in [{"limit": {"source": "workflow", "key": "missing"}}, {"absent": {"source": "workflow", "key": "batch"}}, {"options": {"source": "workflow", "key": "warehouse"}, "options.child": {"source": "workflow", "key": "batch"}}]:
        document = workflow()
        document.nodes[0].configBindings = {key: ConfigBinding.model_validate(value) for key, value in bindings.items()}
        assert not validate_workflow(document, registry).valid


def test_plain_legacy_workflows_and_nested_binding_isolation(registry):
    document = workflow()
    node = document.nodes[0].model_copy(update={"config": {"limit": 3}, "configBindings": {}})
    document.nodes = [node]
    assert resolve_workflow_bindings(document, registry, runtime=True).nodes[0].config == {"limit": 3}
    assert RunInvocation().configuration == {}


def test_workflow_configuration_rejects_credentials_and_duplicate_names():
    with pytest.raises(ValueError):
        workflow(settings={"configuration": [{"name": "config", "type": "json", "default": {"password": "never"}}]})
    document = workflow()
    document.settings.configuration.append(document.settings.configuration[0])
    with pytest.raises(ValueError):
        configuration_values(document)


def test_bound_values_are_not_reinterpreted_as_expressions(registry):
    document = workflow()
    values = configuration_values(document)
    values["warehouse"] = {"description": "{{ secrets.must_not_resolve }}"}
    node = resolve_workflow_bindings(document, registry, configuration=values, runtime=True).nodes[0]
    assert resolve_runtime_config(node, {})["options"]["location"]["description"] == "{{ secrets.must_not_resolve }}"
    node.config["options"]["location"]["description"] = "changed"
    assert values["warehouse"]["description"] != "changed"


def test_executor_loads_the_persisted_snapshot_for_plain_python_nodes(tmp_path, registry):
    from apps.api.nodeflow_api.executor import WorkflowExecutor
    storage = Storage(tmp_path / "execution.sqlite3")
    storage.init_schema()
    document = storage.save_workflow(workflow())
    run = storage.create_run(document)
    document.settings.configuration[0].default = 42
    executor = WorkflowExecutor(storage=storage, registry=registry, environment={})
    asyncio.run(executor.execute(run.id, document))
    events = storage.list_events(run.id)
    assert storage.get_run(run.id).status == "succeeded", [(event.type, event.payload) for event in events if "failed" in event.type]
    output = next(event.payload["outputs"] for event in events if event.node_id == "legacy" and event.type == "node_succeeded")
    assert output["success"]["limit"] == 7
    storage.close()


def test_preview_checks_nested_nodes_from_the_resolved_snapshot(registry):
    from apps.api.nodeflow_api.preview_policy import validate_preview
    from apps.api.nodeflow_api.schemas import WorkflowSubflow
    document = workflow()
    document.nodes[0].subflows["body"] = WorkflowSubflow(nodes=[document.nodes[0].model_copy(deep=True)], edges=[])
    resolved = resolve_workflow_bindings(document, registry, runtime=True)
    # Later edits cannot replace already resolved values during preview preflight.
    resolved.settings.configuration[0].default = "invalid later edit"
    validate_preview(resolved, registry, lambda _: None, _bindings_resolved=True)
    assert resolved.nodes[0].subflows["body"].nodes[0].config["limit"] == 7
