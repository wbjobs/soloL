import math
from expr import (
    Expr, Const, Var, Add, Sub, Mul, Div, Pow,
    Neg, Exp, Log, Sin, Cos, Tan, _wrap
)


class Dual:
    __slots__ = ('val', 'dot')

    def __init__(self, val, dot=0.0):
        self.val = val
        self.dot = dot

    def __add__(self, other):
        if not isinstance(other, Dual):
            other = Dual(other)
        return Dual(self.val + other.val, self.dot + other.dot)

    def __radd__(self, other):
        return Dual(other + self.val, self.dot)

    def __sub__(self, other):
        if not isinstance(other, Dual):
            other = Dual(other)
        return Dual(self.val - other.val, self.dot - other.dot)

    def __rsub__(self, other):
        return Dual(other - self.val, -self.dot)

    def __mul__(self, other):
        if not isinstance(other, Dual):
            other = Dual(other)
        return Dual(
            self.val * other.val,
            self.dot * other.val + self.val * other.dot
        )

    def __rmul__(self, other):
        return Dual(other * self.val, other * self.dot)

    def __truediv__(self, other):
        if not isinstance(other, Dual):
            other = Dual(other)
        return Dual(
            self.val / other.val,
            (self.dot * other.val - self.val * other.dot) / (other.val ** 2)
        )

    def __rtruediv__(self, other):
        return Dual(other / self.val, -other * self.dot / (self.val ** 2))

    def __pow__(self, other):
        if not isinstance(other, Dual):
            other = Dual(other)
        val = math.pow(self.val, other.val)
        if self.val != 0:
            dot = val * (other.dot * math.log(self.val) +
                         other.val * self.dot / self.val)
        else:
            dot = 0.0
        return Dual(val, dot)

    def __rpow__(self, other):
        return Dual(other).rpow(self) if not isinstance(other, Dual) else other.__pow__(self)

    def __neg__(self):
        return Dual(-self.val, -self.dot)

    def __pos__(self):
        return self


def _dual_sin(x):
    if not isinstance(x, Dual):
        x = Dual(x)
    return Dual(math.sin(x.val), math.cos(x.val) * x.dot)


def _dual_cos(x):
    if not isinstance(x, Dual):
        x = Dual(x)
    return Dual(math.cos(x.val), -math.sin(x.val) * x.dot)


def _dual_tan(x):
    if not isinstance(x, Dual):
        x = Dual(x)
    return Dual(math.tan(x.val), x.dot / (math.cos(x.val) ** 2))


def _dual_exp(x):
    if not isinstance(x, Dual):
        x = Dual(x)
    val = math.exp(x.val)
    return Dual(val, val * x.dot)


def _dual_log(x):
    if not isinstance(x, Dual):
        x = Dual(x)
    return Dual(math.log(x.val), x.dot / x.val)


def forward_diff(expr, var_name, env):
    dual_env = {}
    for name, val in env.items():
        if name == var_name:
            dual_env[name] = Dual(float(val), 1.0)
        else:
            dual_env[name] = Dual(float(val), 0.0)
    result = _eval_dual(expr, dual_env)
    if isinstance(result, Dual):
        return result.dot
    return 0.0


def _eval_dual(expr, env):
    if isinstance(expr, Const):
        return Dual(expr.value)
    if isinstance(expr, Var):
        return env[expr.name]
    if isinstance(expr, Neg):
        return -_eval_dual(expr.arg, env)
    if isinstance(expr, Add):
        return _eval_dual(expr.left, env) + _eval_dual(expr.right, env)
    if isinstance(expr, Sub):
        return _eval_dual(expr.left, env) - _eval_dual(expr.right, env)
    if isinstance(expr, Mul):
        return _eval_dual(expr.left, env) * _eval_dual(expr.right, env)
    if isinstance(expr, Div):
        return _eval_dual(expr.left, env) / _eval_dual(expr.right, env)
    if isinstance(expr, Pow):
        return _eval_dual(expr.left, env) ** _eval_dual(expr.right, env)
    if isinstance(expr, Exp):
        return _dual_exp(_eval_dual(expr.arg, env))
    if isinstance(expr, Log):
        return _dual_log(_eval_dual(expr.arg, env))
    if isinstance(expr, Sin):
        return _dual_sin(_eval_dual(expr.arg, env))
    if isinstance(expr, Cos):
        return _dual_cos(_eval_dual(expr.arg, env))
    if isinstance(expr, Tan):
        return _dual_tan(_eval_dual(expr.arg, env))
    raise TypeError(f"Unknown expr type: {type(expr)}")


def reverse_diff(expr, var_name, env):
    grads = reverse_gradient(expr, env)
    return grads.get(var_name, 0.0)


def reverse_gradient(expr, env):
    order = expr.topo_sort()

    ids = [id(node) for node in order]
    if len(ids) != len(set(ids)):
        seen = {}
        new_order = []
        for node in order:
            nid = id(node)
            if nid not in seen:
                seen[nid] = True
                new_order.append(node)
        order = new_order

    values = {}
    for node in order:
        values[id(node)] = node.eval(env)

    grads = {id(node): 0.0 for node in order}
    _acc_grad(grads, id(expr), 1.0)

    for node in reversed(order):
        g = grads[id(node)]
        _propagate(node, g, values, grads)

    result = {}
    for node in order:
        if isinstance(node, Var):
            _acc_grad(result, node.name, grads[id(node)])
    return result


def _acc_grad(grads, key, value):
    if key in grads:
        grads[key] += value
    else:
        grads[key] = value


def _propagate(node, grad, values, grads):
    if isinstance(node, Const) or isinstance(node, Var):
        return

    if isinstance(node, Neg):
        _acc_grad(grads, id(node.arg), -grad)

    elif isinstance(node, Add):
        _acc_grad(grads, id(node.left), grad)
        _acc_grad(grads, id(node.right), grad)

    elif isinstance(node, Sub):
        _acc_grad(grads, id(node.left), grad)
        _acc_grad(grads, id(node.right), -grad)

    elif isinstance(node, Mul):
        lv = values[id(node.left)]
        rv = values[id(node.right)]
        _acc_grad(grads, id(node.left), grad * rv)
        _acc_grad(grads, id(node.right), grad * lv)

    elif isinstance(node, Div):
        lv = values[id(node.left)]
        rv = values[id(node.right)]
        _acc_grad(grads, id(node.left), grad / rv)
        _acc_grad(grads, id(node.right), -grad * lv / (rv ** 2))

    elif isinstance(node, Pow):
        lv = values[id(node.left)]
        rv = values[id(node.right)]
        if lv != 0 or rv >= 1:
            _acc_grad(grads, id(node.left), grad * rv * (lv ** (rv - 1)))
        if lv > 0:
            _acc_grad(grads, id(node.right), grad * (lv ** rv) * math.log(lv))

    elif isinstance(node, Exp):
        v = values[id(node.arg)]
        _acc_grad(grads, id(node.arg), grad * math.exp(v))

    elif isinstance(node, Log):
        v = values[id(node.arg)]
        _acc_grad(grads, id(node.arg), grad / v)

    elif isinstance(node, Sin):
        v = values[id(node.arg)]
        _acc_grad(grads, id(node.arg), grad * math.cos(v))

    elif isinstance(node, Cos):
        v = values[id(node.arg)]
        _acc_grad(grads, id(node.arg), -grad * math.sin(v))

    elif isinstance(node, Tan):
        v = values[id(node.arg)]
        _acc_grad(grads, id(node.arg), grad / (math.cos(v) ** 2))


def differentiate(expr, var_name):
    if isinstance(expr, Const):
        return Const(0)
    if isinstance(expr, Var):
        return Const(1) if expr.name == var_name else Const(0)
    if isinstance(expr, Neg):
        return Neg(differentiate(expr.arg, var_name))
    if isinstance(expr, Add):
        return Add(differentiate(expr.left, var_name),
                   differentiate(expr.right, var_name))
    if isinstance(expr, Sub):
        return Sub(differentiate(expr.left, var_name),
                   differentiate(expr.right, var_name))
    if isinstance(expr, Mul):
        return Add(
            Mul(differentiate(expr.left, var_name), expr.right),
            Mul(expr.left, differentiate(expr.right, var_name))
        )
    if isinstance(expr, Div):
        return Div(
            Sub(
                Mul(differentiate(expr.left, var_name), expr.right),
                Mul(expr.left, differentiate(expr.right, var_name))
            ),
            Pow(expr.right, Const(2))
        )
    if isinstance(expr, Pow):
        d_base = Mul(
            differentiate(expr.left, var_name),
            Mul(expr.right, Pow(expr.left, Sub(expr.right, Const(1))))
        )
        d_exp = Mul(
            differentiate(expr.right, var_name),
            Mul(expr, Log(expr.left))
        )
        return Add(d_base, d_exp)
    if isinstance(expr, Exp):
        return Mul(differentiate(expr.arg, var_name), expr)
    if isinstance(expr, Log):
        return Mul(
            differentiate(expr.arg, var_name),
            Div(Const(1), expr.arg)
        )
    if isinstance(expr, Sin):
        return Mul(
            differentiate(expr.arg, var_name),
            Cos(expr.arg)
        )
    if isinstance(expr, Cos):
        return Mul(
            differentiate(expr.arg, var_name),
            Neg(Sin(expr.arg))
        )
    if isinstance(expr, Tan):
        return Mul(
            differentiate(expr.arg, var_name),
            Add(Const(1), Pow(Tan(expr.arg), Const(2)))
        )
    raise TypeError(f"Cannot differentiate: {type(expr)}")


def gradient_descent(expr, var_names, start, lr=0.01, steps=1000, tol=1e-8):
    point = {name: float(val) for name, val in zip(var_names, start)}
    history = [point.copy()]
    for _ in range(steps):
        grads = reverse_gradient(expr, point)
        old_val = expr.eval(point)
        for name in var_names:
            point[name] -= lr * grads.get(name, 0.0)
        new_val = expr.eval(point)
        history.append(point.copy())
        if abs(new_val - old_val) < tol:
            break
    return point, history


def nth_derivative(expr, var_names, order, simplify_fn=None):
    if order < 0:
        raise ValueError("Order must be non-negative")
    if order == 0:
        return expr
    if not isinstance(var_names, (list, tuple)):
        var_names = [var_names]
    result = expr
    for i in range(order):
        v = var_names[i % len(var_names)]
        result = differentiate(result, v)
        if simplify_fn is not None:
            result = simplify_fn(result)
    return result


def second_derivative(expr, var1, var2=None, simplify_fn=None):
    if var2 is None:
        var2 = var1
    d1 = differentiate(expr, var1)
    if simplify_fn is not None:
        d1 = simplify_fn(d1)
    d2 = differentiate(d1, var2)
    if simplify_fn is not None:
        d2 = simplify_fn(d2)
    return d2


def third_derivative(expr, var1, var2, var3, simplify_fn=None):
    d1 = differentiate(expr, var1)
    if simplify_fn is not None:
        d1 = simplify_fn(d1)
    d2 = differentiate(d1, var2)
    if simplify_fn is not None:
        d2 = simplify_fn(d2)
    d3 = differentiate(d2, var3)
    if simplify_fn is not None:
        d3 = simplify_fn(d3)
    return d3


def eval_nth_derivative(expr, var_names, order, env):
    from simplify import simplify
    deriv_expr = nth_derivative(expr, var_names, order, simplify_fn=simplify)
    return deriv_expr.eval(env)


def eval_hessian(expr, var_names, env):
    n = len(var_names)
    hessian = [[0.0] * n for _ in range(n)]
    from simplify import simplify
    cache = {}

    for i in range(n):
        for j in range(i, n):
            if (i, j) in cache:
                h = cache[(i, j)]
            elif (j, i) in cache:
                h = cache[(j, i)]
            else:
                d2 = second_derivative(expr, var_names[i], var_names[j], simplify_fn=simplify)
                h = d2.eval(env)
                cache[(i, j)] = h
            hessian[i][j] = h
            hessian[j][i] = h

    return hessian


def hessian_sparse(expr, var_names, env, tol=1e-12):
    n = len(var_names)
    sparse = {}
    from simplify import simplify
    cache = {}

    for i in range(n):
        for j in range(i, n):
            if (i, j) in cache:
                h = cache[(i, j)]
            elif (j, i) in cache:
                h = cache[(j, i)]
            else:
                d2 = second_derivative(expr, var_names[i], var_names[j], simplify_fn=simplify)
                h = d2.eval(env)
                cache[(i, j)] = h
            if abs(h) > tol:
                sparse[(i, j)] = h
                if i != j:
                    sparse[(j, i)] = h

    return sparse


def jacobian(exprs, var_names, env):
    m = len(exprs)
    n = len(var_names)
    jacobian = [[0.0] * n for _ in range(m)]

    for i, expr in enumerate(exprs):
        grads = reverse_gradient(expr, env)
        for j, v in enumerate(var_names):
            jacobian[i][j] = grads.get(v, 0.0)

    return jacobian


def jacobian_sparse(exprs, var_names, env, tol=1e-12):
    sparse = {}
    for i, expr in enumerate(exprs):
        grads = reverse_gradient(expr, env)
        for j, v in enumerate(var_names):
            val = grads.get(v, 0.0)
            if abs(val) > tol:
                sparse[(i, j)] = val
    return sparse


def hessian_numerical(expr, var_names, env, eps=1e-6):
    n = len(var_names)
    hessian = [[0.0] * n for _ in range(n)]

    for i in range(n):
        for j in range(n):
            env_pipj = dict(env)
            env_pipj[var_names[i]] += eps
            env_pipj[var_names[j]] += eps
            f_pp = expr.eval(env_pipj)

            env_pimj = dict(env)
            env_pimj[var_names[i]] += eps
            env_pimj[var_names[j]] -= eps
            f_pm = expr.eval(env_pimj)

            env_mipj = dict(env)
            env_mipj[var_names[i]] -= eps
            env_mipj[var_names[j]] += eps
            f_mp = expr.eval(env_mipj)

            env_mimj = dict(env)
            env_mimj[var_names[i]] -= eps
            env_mimj[var_names[j]] -= eps
            f_mm = expr.eval(env_mimj)

            hessian[i][j] = (f_pp - f_pm - f_mp + f_mm) / (4 * eps * eps)

    return hessian
