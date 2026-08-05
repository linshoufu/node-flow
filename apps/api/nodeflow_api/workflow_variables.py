from __future__ import annotations

import re
from typing import Any


WORKFLOW_VARIABLE_NAME_ERROR = "变量名只能包含字母、数字和下划线，且不能以数字开头。"

_WORKFLOW_VARIABLE_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def is_workflow_variable_name(value: str) -> bool:
    return bool(_WORKFLOW_VARIABLE_NAME_PATTERN.fullmatch(value))


def invalid_workflow_variable_issues(variables: dict[str, Any]) -> list[tuple[str, str]]:
    return [
        (f"settings.variables.{name}", WORKFLOW_VARIABLE_NAME_ERROR)
        for name in variables
        if not is_workflow_variable_name(name)
    ]


def valid_workflow_variable_names(variables: dict[str, Any]) -> list[str]:
    return sorted(name for name in variables if is_workflow_variable_name(name))
