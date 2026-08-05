import pytest
from fastapi.testclient import TestClient

from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.schemas import Position, RunInvocation, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.storage import Storage


def workflow(environment_id: str = "default") -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_environment",
        name="Environment workflow",
        settings={"environment_id": environment_id},
        nodes=[
            WorkflowNode(
                id="manual",
                type="manual.trigger",
                position=Position(x=0, y=0),
                config={},
            )
        ],
        edges=[],
    )


def test_default_environment_exposes_legacy_project_variables():
    storage = Storage(":memory:")
    storage.init_schema()
    storage.create_project_variable(name="base_url", value="https://test.example.com")

    environments = storage.list_project_environments()

    assert environments[0].model_dump(exclude={"created_at", "updated_at"}) == {
        "id": "default",
        "name": "默认环境",
        "variables": {"base_url": "https://test.example.com"},
        "credential_overrides": {},
        "is_default": True,
    }


def test_run_persists_the_selected_environment_snapshot():
    storage = Storage(":memory:")
    storage.init_schema()
    staging = storage.create_project_environment(
        name="测试环境",
        variables={"base_url": "https://staging.example.com"},
    )
    saved = storage.save_workflow(workflow(staging.id), publish=False)

    run = storage.create_run(saved, invocation=RunInvocation(environment_id=staging.id))
    storage.update_project_environment(
        staging.id,
        variables={"base_url": "https://changed.example.com"},
    )

    invocation = storage.get_run_invocation(run.id)
    assert invocation is not None
    assert invocation.environment_id == staging.id
    assert invocation.environment_name == "测试环境"
    assert invocation.project_variables == {"base_url": "https://staging.example.com"}


def test_run_persists_environment_credential_overrides_as_a_snapshot():
    storage = Storage(":memory:")
    storage.init_schema()
    staging = storage.create_project_environment(
        name="测试环境",
        variables={},
        credential_overrides={"cred_primary": "cred_staging"},
    )
    saved = storage.save_workflow(workflow(staging.id), publish=False)

    run = storage.create_run(saved, invocation=RunInvocation(environment_id=staging.id))
    storage.update_project_environment(
        staging.id,
        credential_overrides={"cred_primary": "cred_changed"},
    )

    invocation = storage.get_run_invocation(run.id)
    assert invocation is not None
    assert invocation.credential_overrides == {"cred_primary": "cred_staging"}


def test_run_snapshots_credential_overrides_when_project_variables_are_supplied_explicitly():
    storage = Storage(":memory:")
    storage.init_schema()
    staging = storage.create_project_environment(
        name="测试环境",
        variables={"base_url": "https://staging.example.com"},
        credential_overrides={"cred_primary": "cred_staging"},
    )
    saved = storage.save_workflow(workflow(staging.id), publish=False)

    run = storage.create_run(
        saved,
        invocation=RunInvocation(
            environment_id=staging.id,
            project_variables={"base_url": "https://one-off.example.com"},
        ),
    )
    storage.update_project_environment(
        staging.id,
        credential_overrides={"cred_primary": "cred_changed"},
    )

    invocation = storage.get_run_invocation(run.id)
    assert invocation is not None
    assert invocation.project_variables == {"base_url": "https://one-off.example.com"}
    assert invocation.environment_name == "测试环境"
    assert invocation.credential_overrides == {"cred_primary": "cred_staging"}


def test_run_rejects_an_unknown_environment_even_when_variables_are_supplied_explicitly():
    storage = Storage(":memory:")
    storage.init_schema()
    saved = storage.save_workflow(workflow(), publish=False)

    with pytest.raises(ValueError, match="Unknown environment"):
        storage.create_run(
            saved,
            invocation=RunInvocation(
                environment_id="missing",
                project_variables={"base_url": "https://one-off.example.com"},
            ),
        )


def test_manual_run_can_override_the_workflow_environment():
    client = TestClient(create_app(database_path=":memory:"))
    created = client.post(
        "/api/project-environments",
        json={"name": "预发布", "variables": {"base_url": "https://pre.example.com"}},
    )
    environment_id = created.json()["id"]
    saved = client.post(
        "/api/workflows?draft=true",
        json=workflow().model_dump(mode="json"),
    )
    run = client.post(
        "/api/workflows/wf_environment/runs",
        json={"environment_id": environment_id},
    )

    assert created.status_code == 201
    assert saved.status_code == 200
    assert run.status_code == 200
    invocation = client.app.state.storage.get_run_invocation(run.json()["id"])
    assert invocation is not None
    assert invocation.environment_id == environment_id
    assert invocation.project_variables == {"base_url": "https://pre.example.com"}


def test_environment_variable_names_follow_expression_identifier_rules():
    client = TestClient(create_app(database_path=":memory:"))

    response = client.post(
        "/api/project-environments",
        json={"name": "无效环境", "variables": {"base-url": "https://example.com"}},
    )

    assert response.status_code == 422


def test_environment_credential_mapping_requires_existing_same_type_credentials_and_blocks_deletion():
    client = TestClient(create_app(database_path=":memory:"))
    bearer = client.post(
        "/api/credentials",
        json={"type_id": "http.bearer", "name": "默认令牌", "data": {"token": "default-token"}},
    ).json()
    staging = client.post(
        "/api/credentials",
        json={"type_id": "http.bearer", "name": "测试令牌", "data": {"token": "staging-token"}},
    ).json()
    header = client.post(
        "/api/credentials",
        json={"type_id": "http.header", "name": "请求头", "data": {"name": "X-Key", "value": "key"}},
    ).json()

    created = client.post(
        "/api/project-environments",
        json={
            "name": "测试环境",
            "variables": {},
            "credential_overrides": {bearer["id"]: staging["id"]},
        },
    )
    mismatched = client.post(
        "/api/project-environments",
        json={
            "name": "错误环境",
            "variables": {},
            "credential_overrides": {bearer["id"]: header["id"]},
        },
    )
    identity = client.post(
        "/api/project-environments",
        json={
            "name": "无效映射环境",
            "variables": {},
            "credential_overrides": {bearer["id"]: bearer["id"]},
        },
    )
    deleted = client.delete(f"/api/credentials/{staging['id']}")

    assert created.status_code == 201
    assert created.json()["credential_overrides"] == {bearer["id"]: staging["id"]}
    assert mismatched.status_code == 422
    assert mismatched.json()["detail"][0]["code"] == "credential_type_mismatch"
    assert identity.status_code == 422
    assert identity.json()["detail"][0]["code"] == "credential_mapping_identity"
    assert deleted.status_code == 409
    assert deleted.json()["detail"]["code"] == "credential_environment_mapped"
    assert client.delete(f"/api/credentials/{bearer['id']}").status_code == 409
