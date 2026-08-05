from apps.api.nodeflow_api.workflow_expression_validation import expression_syntax_issues


def test_expression_syntax_issues_report_nested_dict_and_list_paths():
    issues = expression_syntax_issues(
        {
            "url": "{{ vars.base_url }}",
            "headers": [{"name": "Authorization", "value": "{{ variables. }}"}],
            "body": {"id": "{{ inputs.input. }}"},
        },
        "nodes.http.config",
    )

    assert issues == [
        (
            "nodes.http.config.headers.0.value",
            "表达式语法无效：{{ variables. }}。请使用 {{ nodes.request.outputs.success }} 这样的路径格式。",
        ),
        (
            "nodes.http.config.body.id",
            "表达式语法无效：{{ inputs.input. }}。请使用 {{ nodes.request.outputs.success }} 这样的路径格式。",
        ),
    ]


def test_expression_syntax_issues_accept_plain_values_and_valid_inline_expressions():
    issues = expression_syntax_issues(
        {
            "message": "hello {{ nodes.http.outputs.success.status_code }}",
            "count": 3,
            "enabled": True,
        },
        "nodes.log.config",
    )

    assert issues == []
