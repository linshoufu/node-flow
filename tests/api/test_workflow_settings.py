from apps.api.nodeflow_api.workflow_settings import invalid_workflow_setting_issues


def test_invalid_workflow_setting_issues_reject_timeout_above_one_day():
    issues = invalid_workflow_setting_issues(timeout_seconds=86401)

    assert issues == [
        (
            "settings.timeout_seconds",
            "Workflow timeout must be between 1 and 86400 seconds",
        )
    ]


def test_invalid_workflow_setting_issues_accept_timeout_at_bounds():
    assert invalid_workflow_setting_issues(timeout_seconds=1) == []
    assert invalid_workflow_setting_issues(timeout_seconds=86400) == []


def test_invalid_workflow_setting_issues_reject_concurrency_above_supported_limit():
    assert invalid_workflow_setting_issues(timeout_seconds=600, max_concurrent_runs=65) == [
        (
            "settings.max_concurrent_runs",
            "Workflow concurrent run limit must be between 1 and 64",
        )
    ]


def test_invalid_workflow_setting_issues_accepts_an_unlimited_or_bounded_concurrency_limit():
    assert invalid_workflow_setting_issues(timeout_seconds=600, max_concurrent_runs=None) == []
    assert invalid_workflow_setting_issues(timeout_seconds=600, max_concurrent_runs=1) == []
    assert invalid_workflow_setting_issues(timeout_seconds=600, max_concurrent_runs=64) == []
