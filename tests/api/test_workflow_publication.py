from apps.api.nodeflow_api.schemas import Position, WorkflowDocument, WorkflowNode
from apps.api.nodeflow_api.main import create_app
from apps.api.nodeflow_api.storage import Storage
from fastapi.testclient import TestClient


def publication_workflow(*, name: str, active: bool = True) -> WorkflowDocument:
    return WorkflowDocument(
        id="wf_publication",
        name=name,
        active=active,
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


def test_draft_save_preserves_the_published_workflow_version():
    storage = Storage(":memory:")
    storage.init_schema()
    published = storage.save_workflow(publication_workflow(name="Published v1"))

    draft = storage.save_workflow(
        publication_workflow(name="Draft v2"),
        publish=False,
    )

    assert published.version == 1
    assert draft.version == 2
    assert storage.get_workflow("wf_publication").name == "Draft v2"
    assert storage.get_published_workflow("wf_publication").name == "Published v1"
    assert storage.get_workflow_publication_status("wf_publication").model_dump() == {
        "workflow_id": "wf_publication",
        "draft_version": 2,
        "published_version": 1,
        "active": True,
        "has_unpublished_changes": True,
    }


def test_publishing_current_draft_switches_the_external_version_without_creating_another_draft():
    storage = Storage(":memory:")
    storage.init_schema()
    storage.save_workflow(publication_workflow(name="Published v1"))
    draft = storage.save_workflow(publication_workflow(name="Draft v2"), publish=False)

    published = storage.publish_workflow(draft.id)

    assert published.version == 2
    assert published.name == "Draft v2"
    assert storage.get_published_workflow(draft.id).version == 2
    assert storage.get_workflow_publication_status(draft.id).has_unpublished_changes is False


def test_unpublishing_removes_a_workflow_from_external_trigger_candidates():
    storage = Storage(":memory:")
    storage.init_schema()
    workflow = storage.save_workflow(publication_workflow(name="Published v1"))

    unpublished = storage.unpublish_workflow(workflow.id)

    assert unpublished.active is False
    assert storage.get_published_workflow(workflow.id) is None
    assert storage.list_active_workflows() == []


def test_api_saves_drafts_without_replacing_the_published_version():
    client = TestClient(create_app(database_path=":memory:"))
    first = publication_workflow(name="Draft v1", active=False).model_dump(mode="json")

    saved = client.post("/api/workflows?draft=true", json=first)
    published = client.post("/api/workflows/wf_publication/activation", json={"active": True})
    second = client.post(
        "/api/workflows?draft=true",
        json={**first, "name": "Draft v2"},
    )
    status = client.get("/api/workflows/wf_publication/publication")

    assert saved.status_code == 200
    assert published.status_code == 200
    assert second.status_code == 200
    assert second.json()["active"] is True
    assert status.json() == {
        "workflow_id": "wf_publication",
        "draft_version": 2,
        "published_version": 1,
        "active": True,
        "has_unpublished_changes": True,
    }
