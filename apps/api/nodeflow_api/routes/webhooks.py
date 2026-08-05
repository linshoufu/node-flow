"""Webhook 触发路由：正式触发与测试触发、鉴权、输入解析。"""

from __future__ import annotations

from hashlib import sha256
from hmac import new as hmac_new
from secrets import compare_digest
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..credentials import CredentialStorageUnavailableError, CredentialVault
from ..executor import ExecutionContext
from ..run_dispatcher import WorkflowRunDispatcher
from ..schemas import RunExecutionMode, RunInvocation, WorkflowDocument
from ..storage import Storage
from ..webhook_test_listeners import WebhookTestListenerRegistry
from .common import require_workflow


def build_webhook_router(
    storage: Storage,
    dispatcher: WorkflowRunDispatcher,
    credential_vault: CredentialVault,
    webhook_test_listeners: WebhookTestListenerRegistry,
    validate_workflow_document,
) -> APIRouter:
    router = APIRouter()

    def _matching_webhook_trigger_id(
        workflow: WorkflowDocument,
        method: str,
        path: str,
    ) -> str | None:
        normalized_path = path.strip().strip("/")
        for node in workflow.nodes:
            if node.type != "webhook.trigger" or node.disabled:
                continue
            if (
                str(node.config.get("method", "POST")).upper() == method.upper()
                and str(node.config.get("path", "")).strip().strip("/") == normalized_path
            ):
                return node.id
        return None

    def _webhook_response_mode(workflow: WorkflowDocument, entry_node_id: str) -> str:
        trigger = next((node for node in workflow.nodes if node.id == entry_node_id), None)
        return str(trigger.config.get("response_mode", "sync")) if trigger is not None else "sync"

    async def _authorize_webhook_request(
        workflow: WorkflowDocument,
        entry_node_id: str,
        request: Request,
    ) -> str | None:
        trigger = next((node for node in workflow.nodes if node.id == entry_node_id), None)
        credential_id = trigger.config.get("credential_id") if trigger is not None else None
        if not isinstance(credential_id, str) or not credential_id:
            return None

        credential = storage.get_credential(credential_id)
        if credential is None or credential.type_id not in {"http.header", "webhook.hmac_sha256"}:
            raise HTTPException(status_code=401, detail="Webhook authentication failed")
        try:
            credential_data = credential_vault.decrypt(credential.encrypted_data)
        except (CredentialStorageUnavailableError, OSError, ValueError):
            raise HTTPException(status_code=401, detail="Webhook authentication failed") from None

        if credential.type_id == "http.header":
            header_name = credential_data.get("name")
            expected_value = credential_data.get("value")
            received_value = request.headers.get(header_name) if isinstance(header_name, str) else None
            valid = (
                isinstance(header_name, str)
                and isinstance(expected_value, str)
                and isinstance(received_value, str)
                and compare_digest(received_value, expected_value)
            )
        else:
            header_name = credential_data.get("header_name")
            secret = credential_data.get("secret")
            received_value = request.headers.get(header_name) if isinstance(header_name, str) else None
            raw_body = await request.body()
            expected_value = hmac_new(
                secret.encode("utf-8") if isinstance(secret, str) else b"",
                raw_body,
                sha256,
            ).hexdigest()
            received_signature = received_value.removeprefix("sha256=") if isinstance(received_value, str) else ""
            valid = (
                isinstance(header_name, str)
                and isinstance(secret, str)
                and bool(received_signature)
                and compare_digest(received_signature, expected_value)
            )
        if not valid:
            raise HTTPException(status_code=401, detail="Webhook authentication failed")
        return header_name

    async def _invoke_webhook(
        workflow: WorkflowDocument,
        entry_node_id: str,
        request: Request,
        webhook_path: str,
        *,
        execution_mode: RunExecutionMode,
    ):
        result = validate_workflow_document(workflow)
        if not result.valid:
            raise HTTPException(
                status_code=422,
                detail=[issue.model_dump(exclude_none=True) for issue in result.issues],
            )
        protected_header_name = await _authorize_webhook_request(workflow, entry_node_id, request)
        initial_input = await webhook_input(
            request,
            webhook_path,
            redacted_header_names={protected_header_name} if protected_header_name else set(),
        )
        run = storage.create_run(
            workflow,
            invocation=RunInvocation(
                entry_node_id=entry_node_id,
                initial_input=initial_input,
                execution_mode=execution_mode,
                allow_pinned_data=False,
            ),
        )
        if _webhook_response_mode(workflow, entry_node_id) == "immediate":
            dispatcher.submit(
                run,
                workflow,
                storage.get_run_invocation(run.id),
            )
            return JSONResponse(
                status_code=202,
                content={
                    "status": "accepted",
                    "run": {
                        "id": run.id,
                        "status": run.status,
                        "workflow_id": run.workflow_id,
                        "workflow_version": run.workflow_version,
                    },
                },
                headers={"Location": f"/api/runs/{run.id}"},
            )
        execution_context = ExecutionContext(
            deadline=time.monotonic() + workflow.settings.timeout_seconds,
            initial_input=initial_input,
            allow_pinned_data=False,
            is_webhook_request=True,
        )
        output = await dispatcher.execute(
            run,
            workflow,
            is_webhook_request=True,
            execution_context=execution_context,
        )
        completed_run = storage.get_run(run.id)
        if completed_run is None:
            raise HTTPException(status_code=500, detail="Webhook run was not recorded")
        if completed_run.status != "succeeded":
            raise HTTPException(status_code=500, detail="Webhook workflow failed")
        if execution_context.webhook_response:
            response = execution_context.webhook_response
            return JSONResponse(
                content=response["body"],
                status_code=response["status_code"],
                headers=response["headers"],
            )
        return {"run": completed_run, "output": output}

    @router.api_route("/webhooks/{webhook_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def invoke_webhook(webhook_path: str, request: Request):
        binding = storage.find_webhook_binding(method=request.method, path=webhook_path)
        if binding is None:
            raise HTTPException(status_code=404, detail="Webhook not found")
        workflow, entry_node_id = binding
        return await _invoke_webhook(workflow, entry_node_id, request, webhook_path, execution_mode="webhook")

    @router.api_route("/webhooks-test/{workflow_id}/{webhook_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def invoke_webhook_test(workflow_id: str, webhook_path: str, request: Request):
        workflow = require_workflow(storage, workflow_id)
        entry_node_id = _matching_webhook_trigger_id(workflow, request.method, webhook_path)
        if entry_node_id is None:
            raise HTTPException(status_code=404, detail="Webhook not found")
        if not webhook_test_listeners.consume(workflow.id, entry_node_id):
            raise HTTPException(status_code=409, detail="Webhook test listener is not active")
        return await _invoke_webhook(workflow, entry_node_id, request, webhook_path, execution_mode="webhook_test")

    return router


async def webhook_input(
    request: Request,
    webhook_path: str,
    *,
    redacted_header_names: set[str] | None = None,
) -> dict:
    raw_body = await request.body()
    body: object
    if not raw_body:
        body = None
    elif "application/json" in request.headers.get("content-type", ""):
        try:
            body = await request.json()
        except ValueError:
            body = raw_body.decode("utf-8", errors="replace")
    else:
        body = raw_body.decode("utf-8", errors="replace")
    redacted_header_names = {name.lower() for name in redacted_header_names or set()}
    headers = {
        name: "***" if name.lower() in redacted_header_names else value
        for name, value in request.headers.items()
    }
    return {
        "method": request.method,
        "path": webhook_path.strip("/"),
        "headers": headers,
        "query": dict(request.query_params),
        "body": body,
    }
