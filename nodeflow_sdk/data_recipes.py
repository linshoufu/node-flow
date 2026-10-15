"""Deterministic data expressions. No eval, Python objects, IO or run context."""
import ast
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext
import operator


def decimal(value, default="0"):
    result = Decimal(str(default if value in (None, "") else value))
    if not result.is_finite():
        raise ValueError("小数必须为有限数值")
    return result


def round_decimal(value, places):
    places = int(places)
    if not 0 <= places <= 18:
        raise ValueError("小数位数必须在 0 到 18 之间")
    return decimal(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)


def text(value, places):
    return format(round_decimal(value, places), f".{int(places)}f")


def quantity(value):
    return text(value, 10).rstrip("0").rstrip(".") or "0"


def unique(rows, key, value):
    matches = [row for row in rows if str(row.get(key, "")) == str(value)]
    if len(matches) != 1:
        raise ValueError(f"匹配字段 {key} 应命中一条记录，实际 {len(matches)} 条")
    return matches[0]


def lookup(rows, keys, value):
    matches = [row for row in rows if any(str(row.get(key, "")) == str(value) for key in keys)]
    if len(matches) != 1:
        raise ValueError(f"字典查找应命中一条记录，实际 {len(matches)} 条")
    return matches[0]


def ensure(condition, message="数据校验失败"):
    if not condition:
        raise ValueError(message)
    return True


def iso_date(value):
    return date.fromisoformat(str(value).strip()).isoformat()


FUNCTIONS = {"decimal": decimal, "round_decimal": round_decimal, "text": text,
             "quantity": quantity, "unique": unique, "ensure": ensure, "date": iso_date,
             "str": str, "int": int, "len": len, "sum": sum, "min": min, "max": max,
             "abs": abs, "lookup": lookup}
BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
COMPARE = {ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le,
           ast.Gt: operator.gt, ast.GtE: operator.ge, ast.In: lambda a, b: a in b,
           ast.NotIn: lambda a, b: a not in b, ast.Is: operator.is_, ast.IsNot: operator.is_not}


class DataExpression:
    def __init__(self):
        self.remaining = 200_000

    def evaluate(self, expression, context):
        if len(expression) > 100_000:
            raise ValueError("数据表达式过长")
        with localcontext() as precision:
            precision.prec = 40
            return self._value(ast.parse(expression, mode="eval").body, context)

    def _value(self, node, ctx):
        self.remaining -= 1
        if self.remaining < 0:
            raise ValueError("数据表达式超出计算预算")
        def read(item):
            return self._value(item, ctx)
        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name) and not node.id.startswith("_"):
            return ctx[node.id]
        if isinstance(node, ast.Attribute) and not node.attr.startswith("_"):
            value = read(node.value)
            if isinstance(value, dict):
                return value[node.attr]
        if isinstance(node, ast.Subscript):
            return read(node.value)[read(node.slice)]
        if isinstance(node, (ast.List, ast.Tuple)):
            return [read(item) for item in node.elts]
        if isinstance(node, ast.Dict):
            if any(key is None for key in node.keys):
                raise ValueError("不支持对象展开")
            return {read(key): read(value) for key, value in zip(node.keys, node.values, strict=True)}
        if isinstance(node, ast.UnaryOp):
            value = read(node.operand)
            if isinstance(node.op, ast.Not):
                return not value
            if isinstance(node.op, ast.USub):
                return -value
        if isinstance(node, ast.BinOp) and type(node.op) in BINOPS:
            left, right = read(node.left), read(node.right)
            if not isinstance(left, (int, float, Decimal)) or not isinstance(right, (int, float, Decimal)):
                raise ValueError("算术操作只接受数值")
            return BINOPS[type(node.op)](left, right)
        if isinstance(node, ast.BoolOp):
            value = None
            for item in node.values:
                value = read(item)
                if (isinstance(node.op, ast.And) and not value) or (isinstance(node.op, ast.Or) and value):
                    break
            return value
        if isinstance(node, ast.IfExp):
            return read(node.body if read(node.test) else node.orelse)
        if isinstance(node, ast.Compare):
            left = read(node.left)
            for op, right_node in zip(node.ops, node.comparators, strict=True):
                right = read(right_node)
                if type(op) not in COMPARE or not COMPARE[type(op)](left, right):
                    return False
                left = right
            return True
        if isinstance(node, (ast.ListComp, ast.GeneratorExp)) and len(node.generators) == 1:
            gen = node.generators[0]
            if not isinstance(gen.target, ast.Name) or gen.target.id.startswith("_") or gen.is_async:
                raise ValueError("无效的集合变量")
            result = []
            for item in read(gen.iter):
                scope = {**ctx, gen.target.id: item}
                if all(self._value(test, scope) for test in gen.ifs):
                    result.append(self._value(node.elt, scope))
            return result
        if isinstance(node, ast.Call):
            args = [read(arg) for arg in node.args]
            if any(keyword.arg is None for keyword in node.keywords):
                raise ValueError("不支持关键字展开")
            kwargs = {keyword.arg: read(keyword.value) for keyword in node.keywords}
            if isinstance(node.func, ast.Name) and node.func.id in FUNCTIONS:
                return FUNCTIONS[node.func.id](*args, **kwargs)
            if isinstance(node.func, ast.Attribute) and node.func.attr == "get":
                value = read(node.func.value)
                if isinstance(value, dict):
                    return value.get(*args, **kwargs)
        raise ValueError(f"不支持的数据表达式操作：{type(node).__name__}")


def run_rules(rules, context, engine=None):
    engine = engine or DataExpression()
    result = dict(context)
    names = set()
    for rule in rules:
        name = rule["name"]
        if not name.isidentifier() or name.startswith("_") or name in names:
            raise ValueError(f"字段名必须是唯一的有效标识符：{name}")
        names.add(name)
        def output(scope):
            if rule.get("fields"):
                mapped = run_rules(rule["fields"], scope, engine)
                return {field["name"]: mapped[field["name"]] for field in rule["fields"]}
            return engine.evaluate(rule["expression"], scope)

        if rule.get("each"):
            values = engine.evaluate(rule["each"], result)
            if not isinstance(values, list) or len(values) > 10_000:
                raise ValueError("集合映射输入必须是最多 10000 项的数组")
            result[name] = [output(run_rules(rule.get("rules", []), {**result, "item": item, "index": index}, engine))
                            for index, item in enumerate(values)]
        else:
            result[name] = output(result)
    return result


def json_value(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    return value
