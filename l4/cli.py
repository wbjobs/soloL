import sys
import re
from expr import (
    Expr, Const, Var, Add, Sub, Mul, Div, Pow,
    Neg, Exp, Log, Sin, Cos, Tan, sin, cos, tan, exp, log
)
from autodiff import (
    forward_diff, reverse_diff, reverse_gradient, differentiate,
    gradient_descent, second_derivative, third_derivative, nth_derivative,
    eval_hessian, hessian_sparse, jacobian, jacobian_sparse,
    hessian_numerical, eval_nth_derivative
)
from simplify import simplify

_FUNCTIONS = {
    'sin': Sin, 'cos': Cos, 'tan': Tan,
    'exp': Exp, 'log': Log,
}

_TOK_NUMBER = 'NUMBER'
_TOK_IDENT = 'IDENT'
_TOK_OP = 'OP'
_TOK_LPAREN = 'LPAREN'
_TOK_RPAREN = 'RPAREN'
_TOK_COMMA = 'COMMA'
_TOK_EQUAL = 'EQUAL'
_TOK_EOF = 'EOF'

_TOKEN_SPEC = [
    (_TOK_NUMBER, r'\d+\.?\d*(?:[eE][+-]?\d+)?'),
    (_TOK_IDENT, r'[a-zA-Z_]\w*'),
    (_TOK_OP, r'\*\*|[+\-*/]'),
    (_TOK_LPAREN, r'\('),
    (_TOK_RPAREN, r'\)'),
    (_TOK_COMMA, r','),
    (_TOK_EQUAL, r'='),
]

_TOKEN_RE = re.compile('|'.join(f'(?P<{name}>{pattern})' for name, pattern in _TOKEN_SPEC))
_WHITESPACE_RE = re.compile(r'\s+')


def tokenize(text):
    pos = 0
    tokens = []
    while pos < len(text):
        m = _WHITESPACE_RE.match(text, pos)
        if m:
            pos = m.end()
            continue
        m = _TOKEN_RE.match(text, pos)
        if not m:
            raise SyntaxError(f"Unexpected character at position {pos}: '{text[pos]}'")
        kind = m.lastgroup
        value = m.group()
        tokens.append((kind, value))
        pos = m.end()
    tokens.append((_TOK_EOF, ''))
    return tokens


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def _peek(self):
        return self.tokens[self.pos]

    def _advance(self):
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def _expect(self, kind, value=None):
        tok = self._advance()
        if tok[0] != kind:
            raise SyntaxError(f"Expected {kind}, got {tok[0]} ('{tok[1]}')")
        if value is not None and tok[1] != value:
            raise SyntaxError(f"Expected '{value}', got '{tok[1]}'")
        return tok

    def parse_assignment(self):
        name_tok = self._expect(_TOK_IDENT)
        func_name = name_tok[1]
        self._expect(_TOK_LPAREN)
        var_names = []
        tok = self._peek()
        if tok[0] == _TOK_IDENT:
            var_names.append(self._advance()[1])
            while self._peek()[0] == _TOK_COMMA:
                self._advance()
                var_names.append(self._expect(_TOK_IDENT)[1])
        self._expect(_TOK_RPAREN)
        self._expect(_TOK_EQUAL)
        expr = self.parse_expr()
        return func_name, var_names, expr

    def parse_expr(self):
        left = self.parse_term()
        while self._peek()[0] == _TOK_OP and self._peek()[1] in ('+', '-'):
            op = self._advance()[1]
            right = self.parse_term()
            if op == '+':
                left = Add(left, right)
            else:
                left = Sub(left, right)
        return left

    def parse_term(self):
        left = self.parse_power()
        while self._peek()[0] == _TOK_OP and self._peek()[1] in ('*', '/'):
            op = self._advance()[1]
            right = self.parse_power()
            if op == '*':
                left = Mul(left, right)
            else:
                left = Div(left, right)
        return left

    def parse_power(self):
        base = self.parse_unary()
        if self._peek()[0] == _TOK_OP and self._peek()[1] == '**':
            self._advance()
            exp = self.parse_power()
            return Pow(base, exp)
        return base

    def parse_unary(self):
        if self._peek()[0] == _TOK_OP and self._peek()[1] == '-':
            self._advance()
            arg = self.parse_unary()
            return Neg(arg)
        if self._peek()[0] == _TOK_OP and self._peek()[1] == '+':
            self._advance()
            return self.parse_unary()
        return self.parse_call()

    def parse_call(self):
        tok = self._peek()
        if tok[0] == _TOK_IDENT and tok[1] in _FUNCTIONS:
            next_tok = self.tokens[self.pos + 1] if self.pos + 1 < len(self.tokens) else None
            if next_tok and next_tok[0] == _TOK_LPAREN:
                func_name = self._advance()[1]
                self._expect(_TOK_LPAREN)
                arg = self.parse_expr()
                self._expect(_TOK_RPAREN)
                return _FUNCTIONS[func_name](arg)
        return self.parse_atom()

    def parse_atom(self):
        tok = self._peek()
        if tok[0] == _TOK_NUMBER:
            self._advance()
            return Const(float(tok[1]))
        if tok[0] == _TOK_IDENT:
            self._advance()
            name = tok[1]
            if name == 'pi':
                return Const(3.141592653589793)
            if name == 'e':
                return Const(2.718281828459045)
            return Var(name)
        if tok[0] == _TOK_LPAREN:
            self._advance()
            expr = self.parse_expr()
            self._expect(_TOK_RPAREN)
            return expr
        raise SyntaxError(f"Unexpected token: {tok[0]} ('{tok[1]}')")


def parse_expression(text):
    tokens = tokenize(text)
    parser = Parser(tokens)
    if _TOK_EQUAL in [t[0] for t in tokens[:-1]]:
        func_name, var_names, expr = parser.parse_assignment()
        return func_name, var_names, expr
    else:
        expr = parser.parse_expr()
        var_names = sorted(expr.variables())
        return 'f', var_names, expr


def parse_env(text, var_names):
    env = {}
    pairs = text.split(',')
    for pair in pairs:
        pair = pair.strip()
        if '=' not in pair:
            raise ValueError(f"Invalid assignment: {pair}")
        name, val = pair.split('=', 1)
        name = name.strip()
        val = float(val.strip())
        env[name] = val
    for name in var_names:
        if name not in env:
            raise ValueError(f"Missing variable: {name}")
    return env


def print_computation_graph(expr, indent=0):
    prefix = "  " * indent
    node_type = type(expr).__name__
    if isinstance(expr, Const):
        val_str = str(int(expr.value)) if expr.value == int(expr.value) and abs(expr.value) < 1e15 else str(expr.value)
        print(f"{prefix}{node_type}({val_str})")
    elif isinstance(expr, Var):
        print(f"{prefix}{node_type}({expr.name})")
    elif isinstance(expr, (Neg, Exp, Log, Sin, Cos, Tan)):
        print(f"{prefix}{node_type}")
        print_computation_graph(expr.arg, indent + 1)
    elif isinstance(expr, (Add, Sub, Mul, Div, Pow)):
        print(f"{prefix}{node_type}")
        print_computation_graph(expr.left, indent + 1)
        print_computation_graph(expr.right, indent + 1)


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Symbolic computation & autodiff CLI")
    ap.add_argument('--expr', '-e', type=str, help='Expression, e.g. "f(x,y)=x**2+sin(y)"')
    ap.add_argument('--env', '-v', type=str, help='Variable values, e.g. "x=1,y=0"')
    ap.add_argument('--diff', '-d', type=str, help='Differentiate w.r.t. variable (symbolic)')
    ap.add_argument('--order', type=int, default=1, help='Derivative order (1, 2, 3)')
    ap.add_argument('--diff2', type=str, nargs=2, metavar=('VAR1', 'VAR2'),
                    help='Second derivative w.r.t. two variables, e.g. --diff2 x y')
    ap.add_argument('--forward', action='store_true', help='Use forward mode AD')
    ap.add_argument('--reverse', action='store_true', help='Use reverse mode AD')
    ap.add_argument('--gradient', '-g', action='store_true', help='Compute full gradient')
    ap.add_argument('--graph', action='store_true', help='Print computation graph')
    ap.add_argument('--simplify', '-s', action='store_true', help='Simplify result')
    ap.add_argument('--optimize', '-o', action='store_true', help='Run gradient descent')
    ap.add_argument('--lr', type=float, default=0.01, help='Learning rate for GD')
    ap.add_argument('--steps', type=int, default=1000, help='Max steps for GD')
    ap.add_argument('--hessian', action='store_true', help='Compute Hessian matrix')
    ap.add_argument('--hessian-sparse', action='store_true', help='Compute sparse Hessian')
    ap.add_argument('--jacobian', type=str,
                    help='Compute Jacobian for multiple expressions, e.g. --jacobian "x+y, x*y, x^2"')
    ap.add_argument('--jacobian-sparse', type=str,
                    help='Compute sparse Jacobian for multiple expressions')
    ap.add_argument('--jit', action='store_true', help='Use JIT compilation for evaluation')
    ap.add_argument('--show-ir', action='store_true', help='Show generated LLVM IR')
    ap.add_argument('--benchmark', type=int, metavar='N',
                    help='Benchmark JIT vs Python with N iterations')
    args = ap.parse_args()

    if args.expr:
        expr_text = args.expr
    else:
        print("Enter expression (e.g. f(x,y)=x**2 + sin(y)):")
        expr_text = input("> ").strip()

    try:
        func_name, var_names, expr = parse_expression(expr_text)
    except SyntaxError as e:
        print(f"Parse error: {e}")
        return

    print(f"\nParsed: {func_name}({', '.join(var_names)}) = {expr}")
    if args.graph:
        print("\nComputation Graph:")
        print_computation_graph(expr)

    if args.diff:
        if args.order > 1:
            deriv = nth_derivative(expr, args.diff, args.order,
                                   simplify_fn=simplify if args.simplify else None)
            print(f"\nSymbolic d^{args.order}/d{args.diff}^{args.order}: {deriv}")
        else:
            deriv = differentiate(expr, args.diff)
            if args.simplify:
                deriv = simplify(deriv)
            print(f"\nSymbolic d/d{args.diff}: {deriv}")

    if args.diff2:
        v1, v2 = args.diff2
        deriv2 = second_derivative(expr, v1, v2,
                                   simplify_fn=simplify if args.simplify else None)
        print(f"\nSymbolic d^2/d{v1}d{v2}: {deriv2}")

    if args.env:
        env = parse_env(args.env, var_names)

        if args.jit or args.show_ir or args.benchmark:
            try:
                from llvm_jit import ExprJITCompiler, get_expression_ir, benchmark as jit_benchmark
                compiler = ExprJITCompiler(var_names)
                compiler.compile(expr)

                if args.show_ir:
                    print("\nGenerated LLVM IR:")
                    ir = get_expression_ir(expr, var_names)
                    for line in ir.split('\n'):
                        print(f"  {line}")

                jit_val = compiler.evaluate(env)
                py_val = expr.eval(env)
                print(f"\nJIT Compilation:")
                print(f"  Value (Python): {py_val:.10f}")
                print(f"  Value (JIT):    {jit_val:.10f}")
                print(f"  Match: {abs(py_val - jit_val) < 1e-10}")

                if args.benchmark:
                    print(f"\nBenchmark ({args.benchmark} iterations):")
                    jit_benchmark(expr, var_names, env, n=args.benchmark)

                if not (args.gradient or args.hessian or args.hessian_sparse or
                        args.jacobian or args.jacobian_sparse or args.optimize):
                    return
            except Exception as e:
                print(f"\nJIT error: {e}")
                print("Falling back to Python evaluation")

        val = expr.eval(env)
        print(f"\nValue at {env}: {val}")

        if args.gradient:
            if args.forward:
                grad = {}
                for v in var_names:
                    grad[v] = forward_diff(expr, v, env)
            else:
                grad = reverse_gradient(expr, env)
            grad_str = ', '.join(f'{k}: {v:.6f}' for k, v in grad.items())
            print(f"Gradient: {{{grad_str}}}")
        elif args.forward:
            print("Specify --diff <var> for forward mode derivative of a specific variable")
        elif args.reverse:
            for v in var_names:
                d = reverse_diff(expr, v, env)
                print(f"  d/d{v} = {d:.6f}")

        if args.hessian:
            H = eval_hessian(expr, var_names, env)
            print("\nHessian Matrix:")
            for row in H:
                print(f"  {row}")

        if args.hessian_sparse:
            H_sp = hessian_sparse(expr, var_names, env)
            print(f"\nSparse Hessian: {H_sp}")
            print(f"  Non-zero elements: {len(H_sp)} of {len(var_names)**2}")

        if args.optimize:
            start_vals = [env[v] for v in var_names]
            result, history = gradient_descent(
                expr, var_names, start_vals, lr=args.lr, steps=args.steps
            )
            print(f"\nGradient Descent (lr={args.lr}, max_steps={args.steps}):")
            print(f"  Minimum at: {{{', '.join(f'{k}: {v:.6f}' for k, v in result.items())}}}")
            print(f"  Function value: {expr.eval(result):.6f}")
            print(f"  Steps taken: {len(history) - 1}")

    if args.jacobian or args.jacobian_sparse:
        jac_input = args.jacobian if args.jacobian else args.jacobian_sparse
        expr_strs = [s.strip() for s in jac_input.split(',')]
        exprs = []
        for s in expr_strs:
            try:
                f, vs, e = parse_expression(f"f({','.join(var_names)})={s}")
                exprs.append(e)
            except SyntaxError as e:
                print(f"Parse error for '{s}': {e}")
                return

        if not args.env:
            print("\nProvide variable values with --env for Jacobian computation")
        else:
            env = parse_env(args.env, var_names)
            if args.jacobian:
                J = jacobian(exprs, var_names, env)
                print("\nJacobian Matrix:")
                for row in J:
                    print(f"  {row}")
            else:
                J_sp = jacobian_sparse(exprs, var_names, env)
                print(f"\nSparse Jacobian: {J_sp}")
                print(f"  Non-zero elements: {len(J_sp)} of {len(exprs)*len(var_names)}")
    else:
        if not args.env and (args.gradient or args.forward or args.reverse or args.optimize or
           args.hessian or args.hessian_sparse):
            print("Provide variable values with --env (e.g. --env 'x=1,y=0')")

    help_flags = [not args.env, not args.diff, not args.diff2, not args.graph,
                  not args.gradient, not args.forward, not args.reverse,
                  not args.optimize, not args.hessian, not args.hessian_sparse,
                  not args.jacobian, not args.jacobian_sparse, not args.jit,
                  not args.show_ir, not args.benchmark]
    if all(help_flags):
        print("\nTip: use flags like --env 'x=1,y=0' --gradient to compute gradients")
        print("     --diff x          symbolic derivative w.r.t. x")
        print("     --diff2 x y       mixed second derivative d^2/dxdy")
        print("     --order 2 --diff x  second derivative d^2/dx^2")
        print("     --gradient        numerical gradient at a point")
        print("     --hessian         Hessian matrix")
        print("     --hessian-sparse  sparse Hessian (non-zeros only)")
        print("     --jacobian \"x+y, x*y\"  Jacobian for multiple expressions")
        print("     --jit             JIT compile to LLVM IR")
        print("     --show-ir         show generated LLVM IR")
        print("     --benchmark N     benchmark JIT vs Python (N iterations)")
        print("     --forward         use forward mode AD")
        print("     --reverse         use reverse mode AD")
        print("     --simplify        simplify symbolic results")
        print("     --graph           show computation graph")
        print("     --optimize        run gradient descent")


if __name__ == '__main__':
    main()
