from expr import (
    Expr, Const, Var, Add, Sub, Mul, Div, Pow,
    Neg, Exp, Log, Sin, Cos, Tan
)

_EPS = 1e-12
_IS_ZERO = lambda e: isinstance(e, Const) and abs(e.value) < _EPS
_IS_ONE = lambda e: isinstance(e, Const) and abs(e.value - 1.0) < _EPS


def simplify(expr, max_iters=10):
    result = expr
    for _ in range(max_iters):
        new_result = _simplify_once(result)
        if _exprs_equal(new_result, result):
            break
        result = new_result
    return result


def _exprs_equal(a, b):
    if type(a) != type(b):
        return False
    if isinstance(a, Const):
        return a.value == b.value
    if isinstance(a, Var):
        return a.name == b.name
    if isinstance(a, (Neg, Exp, Log, Sin, Cos, Tan)):
        return _exprs_equal(a.arg, b.arg)
    if isinstance(a, (Add, Sub, Mul, Div, Pow)):
        return _exprs_equal(a.left, b.left) and _exprs_equal(a.right, b.right)
    return False


def _simplify_once(expr):
    if isinstance(expr, (Const, Var)):
        return expr

    if isinstance(expr, Neg):
        arg = _simplify_once(expr.arg)
        if isinstance(arg, Neg):
            return arg.arg
        if isinstance(arg, Const):
            return Const(-arg.value)
        return Neg(arg)

    if isinstance(expr, Add):
        left = _simplify_once(expr.left)
        right = _simplify_once(expr.right)
        if _IS_ZERO(left):
            return right
        if _IS_ZERO(right):
            return left
        if isinstance(left, Const) and isinstance(right, Const):
            return Const(left.value + right.value)
        if isinstance(left, Neg) and _exprs_equal(left.arg, right):
            return Const(0)
        if isinstance(right, Neg) and _exprs_equal(right.arg, left):
            return Const(0)
        return Add(left, right)

    if isinstance(expr, Sub):
        left = _simplify_once(expr.left)
        right = _simplify_once(expr.right)
        if _IS_ZERO(right):
            return left
        if _IS_ZERO(left):
            return Neg(right)
        if _exprs_equal(left, right):
            return Const(0)
        if isinstance(left, Const) and isinstance(right, Const):
            return Const(left.value - right.value)
        return Sub(left, right)

    if isinstance(expr, Mul):
        left = _simplify_once(expr.left)
        right = _simplify_once(expr.right)
        if _IS_ZERO(left) or _IS_ZERO(right):
            return Const(0)
        if _IS_ONE(left):
            return right
        if _IS_ONE(right):
            return left
        if isinstance(left, Const) and left.value == -1:
            return Neg(right)
        if isinstance(right, Const) and right.value == -1:
            return Neg(left)
        if isinstance(left, Const) and isinstance(right, Const):
            return Const(left.value * right.value)
        if isinstance(right, Const) and right.value != 0:
            return Mul(right, left)
        return Mul(left, right)

    if isinstance(expr, Div):
        left = _simplify_once(expr.left)
        right = _simplify_once(expr.right)
        if _IS_ZERO(left):
            return Const(0)
        if _IS_ONE(right):
            return left
        if _exprs_equal(left, right):
            return Const(1)
        if isinstance(left, Const) and isinstance(right, Const):
            return Const(left.value / right.value)
        return Div(left, right)

    if isinstance(expr, Pow):
        left = _simplify_once(expr.left)
        right = _simplify_once(expr.right)
        if _IS_ZERO(right):
            return Const(1)
        if _IS_ONE(right):
            return left
        if _IS_ZERO(left):
            return Const(0)
        if _IS_ONE(left):
            return Const(1)
        if isinstance(left, Const) and isinstance(right, Const):
            try:
                return Const(left.value ** right.value)
            except (ValueError, OverflowError):
                pass
        return Pow(left, right)

    if isinstance(expr, Exp):
        arg = _simplify_once(expr.arg)
        if _IS_ZERO(arg):
            return Const(1)
        if isinstance(arg, Log):
            return arg.arg
        return Exp(arg)

    if isinstance(expr, Log):
        arg = _simplify_once(expr.arg)
        if _IS_ONE(arg):
            return Const(0)
        if isinstance(arg, Exp):
            return arg.arg
        return Log(arg)

    if isinstance(expr, Sin):
        arg = _simplify_once(expr.arg)
        if _IS_ZERO(arg):
            return Const(0)
        return Sin(arg)

    if isinstance(expr, Cos):
        arg = _simplify_once(expr.arg)
        if _IS_ZERO(arg):
            return Const(1)
        return Cos(arg)

    if isinstance(expr, Tan):
        arg = _simplify_once(expr.arg)
        if _IS_ZERO(arg):
            return Const(0)
        return Tan(arg)

    return expr
