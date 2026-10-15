"""Opt in to a typed field's deferred, path-expression value."""
from typing import Annotated

from pydantic import StringConstraints

from .expressions import EXPRESSION_RE


ConfigExpression = Annotated[str, StringConstraints(pattern=EXPRESSION_RE.pattern)]
