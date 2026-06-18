from __future__ import annotations

from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .executor import WorkflowExecutor
from .node_registry import NodeRegistry
from .schemas import WorkflowDocument
from .storage import Storage
from .validation import validate_workflow


def create_app(
    database_path: str = "node-flow.sqlite3", nodes_dir: str | Path | None = None
) -> FastAPI:
    app = FastAPI(title="Node Flow API")
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    storage = Storage(database_path)
    storage.init_schema()
    repo_root = Path(__file__).resolve().parents[3]
    default_nodes_dir = repo_root / "nodes"
    registry = NodeRegistry(nodes_dir=Path(nodes_dir) if nodes_dir is not None else default_nodes_dir)
    registry.scan()
    executor = WorkflowExecutor(storage=storage, registry=registry)
    app.state.storage = storage
    app.state.registry = registry
    app.state.executor = executor

    @app.on_event("shutdown")
    def shutdown() -> None:
        storage.close()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/node-types")
    def node_types() -> list[dict]:
        return [node_type.to_api_dict() for node_type in registry.list_node_types()]

    @app.get("/api/workflows")
    def list_workflows():
        return storage.list_workflows()

    @app.post("/api/workflows")
    def save_workflow(workflow: WorkflowDocument):
        result = validate_workflow(workflow, registry)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump() for issue in result.issues],
            )
        return storage.save_workflow(workflow)

    @app.post("/api/workflows/validate")
    def validate(workflow: WorkflowDocument):
        return validate_workflow(workflow, registry)

    @app.get("/api/workflows/{workflow_id}")
    def get_workflow(workflow_id: str):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        return workflow

    @app.post("/api/workflows/{workflow_id}/runs")
    def create_run(workflow_id: str, background_tasks: BackgroundTasks):
        workflow = storage.get_workflow(workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="Workflow not found")
        result = validate_workflow(workflow, registry)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump() for issue in result.issues],
            )
        run = storage.create_run(workflow)
        background_tasks.add_task(executor.execute, run.id, workflow)
        return run

    @app.get("/api/runs/{run_id}")
    def get_run(run_id: str):
        run = storage.get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return run

    @app.get("/api/runs/{run_id}/events")
    def list_run_events(run_id: str):
        if storage.get_run(run_id) is None:
            raise HTTPException(status_code=404, detail="Run not found")
        return storage.list_events(run_id)

    return app
