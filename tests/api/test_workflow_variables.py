from apps.api.nodeflow_api.workflow_variables import (
    WORKFLOW_VARIABLE_NAME_ERROR,
    invalid_workflow_variable_issues,
    is_workflow_variable_name,
    valid_workflow_variable_names,
)


def test_workflow_variable_names_follow_vars_expression_identifier_rule():
    assert is_workflow_variable_name("base_url")
    assert is_workflow_variable_name("_token")
    assert is_workflow_variable_name("retry_count_2")

    assert not is_workflow_variable_name("")
    assert not is_workflow_variable_name("2token")
    assert not is_workflow_variable_name("base-url")
    assert not is_workflow_variable_name("中文变量")


def test_invalid_workflow_variable_issues_keep_stable_paths_and_chinese_message():
    issues = invalid_workflow_variable_issues(
        {"base_url": "https://api.example.com", "base-url": "bad", "2token": "bad"}
    )

    assert issues == [
        ("settings.variables.base-url", WORKFLOW_VARIABLE_NAME_ERROR),
        ("settings.variables.2token", WORKFLOW_VARIABLE_NAME_ERROR),
    ]


def test_valid_workflow_variable_names_are_sorted_for_reference_lists():
    names = valid_workflow_variable_names({"zeta": 1, "base-url": 2, "_token": 3, "alpha": 4})

    assert names == ["_token", "alpha", "zeta"]
