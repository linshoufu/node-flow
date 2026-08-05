from __future__ import annotations

from .expressions import invalid_expression_tokens

ExpressionIssue = tuple[str, str]


def expression_syntax_issues(value: object, path: str) -> list[ExpressionIssue]:
    issues: list[ExpressionIssue] = []
    _collect_expression_syntax_issues(value, path, issues)
    return issues


def _collect_expression_syntax_issues(
    value: object,
    path: str,
    issues: list[ExpressionIssue],
) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            _collect_expression_syntax_issues(item, f"{path}.{key}", issues)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _collect_expression_syntax_issues(item, f"{path}.{index}", issues)
        return
    if not isinstance(value, str):
        return

    for token in invalid_expression_tokens(value):
        issues.append(
            (
                path,
                (
                    f"表达式语法无效：{token}。"
                    "请使用 {{ nodes.request.outputs.success }} 这样的路径格式。"
                ),
            )
        )
