from __future__ import annotations

MIN_WORKFLOW_TIMEOUT_SECONDS = 1
MAX_WORKFLOW_TIMEOUT_SECONDS = 86400
WORKFLOW_TIMEOUT_ERROR = "Workflow timeout must be between 1 and 86400 seconds"

MIN_WORKFLOW_CONCURRENT_RUNS = 1
MAX_WORKFLOW_CONCURRENT_RUNS = 64
WORKFLOW_CONCURRENT_RUNS_ERROR = "Workflow concurrent run limit must be between 1 and 64"
def invalid_workflow_setting_issues(
    timeout_seconds: float,
    max_concurrent_runs: int | None = None,
) -> list[tuple[str, str]]:
    issues: list[tuple[str, str]] = []
    if not MIN_WORKFLOW_TIMEOUT_SECONDS <= timeout_seconds <= MAX_WORKFLOW_TIMEOUT_SECONDS:
        issues.append(("settings.timeout_seconds", WORKFLOW_TIMEOUT_ERROR))
    if max_concurrent_runs is not None and not (
        MIN_WORKFLOW_CONCURRENT_RUNS <= max_concurrent_runs <= MAX_WORKFLOW_CONCURRENT_RUNS
    ):
        issues.append(("settings.max_concurrent_runs", WORKFLOW_CONCURRENT_RUNS_ERROR))
    return issues
