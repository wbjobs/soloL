import math

class Expr:
    def __add__(self, other):
        return Add(self, _wrap(other))

    def __radd__(self, other):
        return Add(_wrap(other), self)

    def __sub__(self, other):
        return Sub(self, _wrap(other))

    def __rsub__(self, other):
        return Sub(_wrap(other), self)

    def __mul__(self, other):
        return Mul(self, _wrap(other))

    def __rmul__(self, other):
        return Mul(_wrap(other), self)

    def __truediv__(self, other):
        return Div(self, _wrap(other))

    def __rtruediv__(self, other):
        return Div(_wrap(other), self)

    def __pow__(self, other):
        return Pow(self, _wrap(other))

    def __rpow__(self, other):
        return Pow(_wrap(other), self)

    def __neg__(self):
        return Neg(self)

    def __pos__(self):
        return self

    def eval(self, env=None):
        raise NotImplementedError

    @property
    def children(self):
        return []

    def variables(self):
        result = set()
        visited = set()
        self._collect_vars(result, visited)
        return result

    def _collect_vars(self, result, visited):
        if id(self) in visited:
            return
        visited.add(id(self))
        if isinstance(self, Var):
            result.add(self.name)
        for child in self.children:
            child._collect_vars(result, visited)

    def topo_sort(self):
        order = []
        visited = set()
        self._topo_visit(order, visited)
        return order

    def _topo_visit(self, order, visited):
        if id(self) in visited:
            return
        visited.add(id(self))
        for child in self.children:
            child._topo_visit(order, visited)
        order.append(self)


def _wrap(x):
    if isinstance(x, Expr):
        return x
    return Const(x)


class Const(Expr):
    def __init__(self, value):
        self.value = float(value)

    def eval(self, env=None):
        return self.value

    @property
    def children(self):
        return []

    def __str__(self):
        if self.value == int(self.value) and abs(self.value) < 1e15:
            return str(int(self.value))
        return str(self.value)

    def __repr__(self):
        return f"Const({self.value})"

    def __eq__(self, other):
        return isinstance(other, Const) and self.value == other.value

    def __hash__(self):
        return hash(("Const", self.value))


class Var(Expr):
    def __init__(self, name):
        self.name = name

    def eval(self, env=None):
        if env is None or self.name not in env:
            raise ValueError(f"Variable '{self.name}' not provided")
        return float(env[self.name])

    @property
    def children(self):
        return []

    def __str__(self):
        return self.name

    def __repr__(self):
        return f"Var('{self.name}')"

    def __eq__(self, other):
        return isinstance(other, Var) and self.name == other.name

    def __hash__(self):
        return hash(("Var", self.name))


class BinOp(Expr):
    _symbol = ""

    def __init__(self, left, right):
        self.left = left
        self.right = right

    @property
    def children(self):
        return [self.left, self.right]

    def __repr__(self):
        return f"{self.__class__.__name__}({self.left!r}, {self.right!r})"


class Add(BinOp):
    _symbol = "+"

    def eval(self, env=None):
        return self.left.eval(env) + self.right.eval(env)

    def __str__(self):
        return f"({self.left} + {self.right})"


class Sub(BinOp):
    _symbol = "-"

    def eval(self, env=None):
        return self.left.eval(env) - self.right.eval(env)

    def __str__(self):
        return f"({self.left} - {self.right})"


class Mul(BinOp):
    _symbol = "*"

    def eval(self, env=None):
        return self.left.eval(env) * self.right.eval(env)

    def __str__(self):
        return f"({self.left} * {self.right})"


class Div(BinOp):
    _symbol = "/"

    def eval(self, env=None):
        return self.left.eval(env) / self.right.eval(env)

    def __str__(self):
        return f"({self.left} / {self.right})"


class Pow(BinOp):
    _symbol = "**"

    def eval(self, env=None):
        base = self.left.eval(env)
        exp = self.right.eval(env)
        return math.pow(base, exp)

    def __str__(self):
        return f"({self.left} ** {self.right})"


class UnaryOp(Expr):
    def __init__(self, arg):
        self.arg = arg

    @property
    def children(self):
        return [self.arg]

    def __repr__(self):
        return f"{self.__class__.__name__}({self.arg!r})"


class Neg(UnaryOp):
    def eval(self, env=None):
        return -self.arg.eval(env)

    def __str__(self):
        return f"(-{self.arg})"


class Exp(UnaryOp):
    def eval(self, env=None):
        return math.exp(self.arg.eval(env))

    def __str__(self):
        return f"exp({self.arg})"


class Log(UnaryOp):
    def eval(self, env=None):
        return math.log(self.arg.eval(env))

    def __str__(self):
        return f"log({self.arg})"


class Sin(UnaryOp):
    def eval(self, env=None):
        return math.sin(self.arg.eval(env))

    def __str__(self):
        return f"sin({self.arg})"


class Cos(UnaryOp):
    def eval(self, env=None):
        return math.cos(self.arg.eval(env))

    def __str__(self):
        return f"cos({self.arg})"


class Tan(UnaryOp):
    def eval(self, env=None):
        return math.tan(self.arg.eval(env))

    def __str__(self):
        return f"tan({self.arg})"


def sin(x):
    return Sin(_wrap(x))


def cos(x):
    return Cos(_wrap(x))


def tan(x):
    return Tan(_wrap(x))


def exp(x):
    return Exp(_wrap(x))


def log(x):
    return Log(_wrap(x))
