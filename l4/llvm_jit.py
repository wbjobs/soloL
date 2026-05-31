import ctypes
import math
from expr import (
    Expr, Const, Var, Add, Sub, Mul, Div, Pow,
    Neg, Exp, Log, Sin, Cos, Tan
)

from llvmlite import ir, binding

binding.initialize_all_targets()
binding.initialize_native_target()
binding.initialize_native_asmprinter()


class ExprJITCompiler:
    def __init__(self, var_names):
        self.var_names = var_names
        self.var_indices = {name: i for i, name in enumerate(var_names)}
        self.module = ir.Module(name="expr_jit")
        self.builder = None
        self.func = None
        self.args_ptr = None
        self._compiled = False
        self._engine = None

    def _build_ir(self, expr):
        double_type = ir.DoubleType()
        ptr_type = ir.PointerType(double_type)
        func_type = ir.FunctionType(double_type, [ptr_type])
        self.func = ir.Function(self.module, func_type, name="eval_expr")
        self.args_ptr = self.func.args[0]

        block = self.func.append_basic_block(name="entry")
        self.builder = ir.IRBuilder(block)

        result = self._visit(expr)
        self.builder.ret(result)

        return self.module

    def _visit(self, node):
        if isinstance(node, Const):
            return ir.Constant(ir.DoubleType(), node.value)

        if isinstance(node, Var):
            idx = self.var_indices[node.name]
            idx_const = ir.Constant(ir.IntType(64), idx)
            ptr = self.builder.gep(self.args_ptr, [idx_const])
            return self.builder.load(ptr, name=node.name)

        if isinstance(node, Neg):
            arg = self._visit(node.arg)
            return self.builder.fneg(arg)

        if isinstance(node, Add):
            left = self._visit(node.left)
            right = self._visit(node.right)
            return self.builder.fadd(left, right)

        if isinstance(node, Sub):
            left = self._visit(node.left)
            right = self._visit(node.right)
            return self.builder.fsub(left, right)

        if isinstance(node, Mul):
            left = self._visit(node.left)
            right = self._visit(node.right)
            return self.builder.fmul(left, right)

        if isinstance(node, Div):
            left = self._visit(node.left)
            right = self._visit(node.right)
            return self.builder.fdiv(left, right)

        if isinstance(node, Pow):
            left = self._visit(node.left)
            right = self._visit(node.right)
            return self._call_math("pow", left, right)

        if isinstance(node, Exp):
            arg = self._visit(node.arg)
            return self._call_math("exp", arg)

        if isinstance(node, Log):
            arg = self._visit(node.arg)
            return self._call_math("log", arg)

        if isinstance(node, Sin):
            arg = self._visit(node.arg)
            return self._call_math("sin", arg)

        if isinstance(node, Cos):
            arg = self._visit(node.arg)
            return self._call_math("cos", arg)

        if isinstance(node, Tan):
            arg = self._visit(node.arg)
            return self._call_math("tan", arg)

        raise TypeError(f"Unsupported node type: {type(node)}")

    def _call_math(self, name, *args):
        double_type = ir.DoubleType()
        func_type = ir.FunctionType(double_type, [double_type] * len(args))

        if name not in self.module.globals:
            func = ir.Function(self.module, func_type, name=name)
        else:
            func = self.module.globals[name]

        return self.builder.call(func, list(args))

    def compile(self, expr):
        self._build_ir(expr)

        target = binding.Target.from_default_triple()
        target_machine = target.create_target_machine()
        backing_mod = binding.parse_assembly(str(self.module))
        backing_mod.verify()

        self._engine = binding.create_mcjit_compiler(
            backing_mod, target_machine
        )
        self._engine.finalize_object()
        self._engine.run_static_constructors()

        self._compiled = True

    def get_ir(self):
        return str(self.module)

    def evaluate(self, var_values):
        if not self._compiled:
            raise RuntimeError("Not compiled yet. Call compile() first.")

        values = [float(var_values.get(name, 0.0)) for name in self.var_names]
        arr_type = (ctypes.c_double * len(values))
        arr = arr_type(*values)

        func_ptr = self._engine.get_function_address("eval_expr")
        cfunc = ctypes.CFUNCTYPE(
            ctypes.c_double,
            ctypes.POINTER(ctypes.c_double)
        )(func_ptr)

        result = cfunc(arr)
        return result


def compile_and_evaluate(expr, var_names, env):
    compiler = ExprJITCompiler(var_names)
    compiler.compile(expr)
    return compiler.evaluate(env)


def get_expression_ir(expr, var_names):
    compiler = ExprJITCompiler(var_names)
    compiler.compile(expr)
    return compiler.get_ir()


class JITGradientFunction:
    def __init__(self, expr, var_names):
        self.expr = expr
        self.var_names = var_names
        self._compilers = {}
        self._build_jit_functions()

    def _build_jit_functions(self):
        self._compilers['value'] = ExprJITCompiler(self.var_names)
        self._compilers['value'].compile(self.expr)

        from autodiff import differentiate
        from simplify import simplify

        self._grad_compilers = {}
        for var in self.var_names:
            deriv = simplify(differentiate(self.expr, var))
            comp = ExprJITCompiler(self.var_names)
            comp.compile(deriv)
            self._grad_compilers[var] = comp

    def value(self, env):
        return self._compilers['value'].evaluate(env)

    def gradient(self, env):
        return {
            name: comp.evaluate(env)
            for name, comp in self._grad_compilers.items()
        }

    def get_value_ir(self):
        return self._compilers['value'].get_ir()


def benchmark(expr, var_names, env, n=10000):
    import time

    t0 = time.time()
    for _ in range(n):
        expr.eval(env)
    t_py = time.time() - t0

    jit_val = compile_and_evaluate(expr, var_names, env)

    t0 = time.time()
    for _ in range(n):
        compile_and_evaluate(expr, var_names, env)
    t_jit_compile = time.time() - t0

    compiler = ExprJITCompiler(var_names)
    compiler.compile(expr)
    t0 = time.time()
    for _ in range(n):
        compiler.evaluate(env)
    t_jit_run = time.time() - t0

    print(f"Python eval:   {t_py * 1000:.2f} ms ({n/t_py:.0f}/s)")
    print(f"JIT (compile+run): {t_jit_compile * 1000:.2f} ms")
    print(f"JIT (run only):    {t_jit_run * 1000:.2f} ms ({n/t_jit_run:.0f}/s)")
    print(f"Speedup (run only): {t_py/t_jit_run:.1f}x")
    print(f"Values match: {abs(jit_val - expr.eval(env)) < 1e-10}")

    return {
        'python_time': t_py,
        'jit_compile_time': t_jit_compile,
        'jit_run_time': t_jit_run,
        'speedup': t_py / t_jit_run,
    }
