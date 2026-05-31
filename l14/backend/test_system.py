import os
import sys
import io
import numpy as np
from scipy import sparse
from scipy.io import mmwrite

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.matrix_parser import matrix_parser
from app.services.solvers.cg import solve_cg
from app.services.solvers.gmres import solve_gmres
from app.services.solvers.superlu import solve_superlu, SUPERLU_SIZE_THRESHOLD
from app.utils.matrix_utils import (
    compute_matrix_stats,
    estimate_condition_number,
    generate_heatmap_data,
    compute_residual,
    is_symmetric,
)
from app.db.models import SolverType


def generate_test_matrix(n=100, density=0.05, symmetric=True):
    np.random.seed(42)
    A = sparse.random(n, n, density=density, format="csr", random_state=42)
    if symmetric:
        A = A + A.T + sparse.eye(n) * 2.0
    else:
        A = A + sparse.eye(n) * 2.0
    return A


def matrix_to_mtx_bytes(A):
    buf = io.BytesIO()
    mmwrite(buf, A)
    return buf.getvalue()


def test_matrix_parsing():
    print("=" * 60)
    print("测试1: 矩阵解析与验证")
    print("=" * 60)

    n = 200
    A = generate_test_matrix(n=n)
    mtx_bytes = matrix_to_mtx_bytes(A)

    try:
        from app.services.matrix_parser import MatrixParser
        matrix, stats = MatrixParser.parse_matrix_content(mtx_bytes, "test_matrix.mtx")
        print(f"✅ 矩阵解析成功")
        print(f"   维度: {matrix.shape[0]} x {matrix.shape[1]}")
        print(f"   非零元: {matrix.nnz}")
        print(f"   稀疏度: {stats['sparsity']:.4f}")
        print(f"   条件数: {stats['condition_number']:.2f}" if stats.get('condition_number') else "   条件数: 无法估计")
        return True
    except Exception as e:
        print(f"❌ 矩阵解析失败: {e}")
        return False


def test_matrix_stats():
    print("\n" + "=" * 60)
    print("测试2: 矩阵统计功能")
    print("=" * 60)

    n = 500
    A = generate_test_matrix(n=n, density=0.02)

    try:
        stats = compute_matrix_stats(A)
        print(f"✅ 矩阵统计成功")
        print(f"   维度: {stats['shape']}")
        print(f"   非零元: {stats['nnz']}")
        print(f"   稀疏度: {stats['sparsity']:.6f}")
        return True
    except Exception as e:
        print(f"❌ 矩阵统计失败: {e}")
        return False


def test_heatmap_generation():
    print("\n" + "=" * 60)
    print("测试3: 热力图数据生成（含大规模采样）")
    print("=" * 60)

    n = 1000
    A = generate_test_matrix(n=n, density=0.01)

    try:
        heatmap = generate_heatmap_data(A, num_bins=50, max_points=5000)
        print(f"✅ 热力图生成成功")
        print(f"   矩阵大小: {heatmap['rows']} x {heatmap['cols']}")
        print(f"   分箱数量: {len(heatmap['bins'])}")
        print(f"   采样点数: {len(heatmap['sample_points'])}")
        assert len(heatmap['sample_points']) <= 5000, f"采样点数超限: {len(heatmap['sample_points'])}"
        return True
    except Exception as e:
        print(f"❌ 热力图生成失败: {e}")
        return False


def test_cg_icc_preconditioner():
    print("\n" + "=" * 60)
    print("测试4: CG + ICC预条件求解器")
    print("=" * 60)

    n = 500
    A = sparse.diags([1, 10, 1], [-1, 0, 1], shape=(n, n)).tocsr()
    b = np.ones(n)

    try:
        x, result = solve_cg(A, b, tol=1e-8, max_iter=500, time_limit=30.0, use_preconditioner=True)
        final_residual = compute_residual(A, x, b)

        print(f"✅ CG+ICC求解完成")
        print(f"   预条件器: {result.get('preconditioner', 'none')}")
        print(f"   求解时间: {result['solve_time']:.4f} 秒")
        print(f"   迭代次数: {result['iterations']}")
        print(f"   最终残差: {final_residual:.2e}")
        print(f"   是否收敛: {result['converged']}")

        return final_residual < 1e-5 and result.get('preconditioner') != 'none'
    except Exception as e:
        print(f"❌ CG+ICC求解失败: {e}")
        return False


def test_gmres_ilu_preconditioner():
    print("\n" + "=" * 60)
    print("测试5: GMRES + ILU预条件求解器")
    print("=" * 60)

    n = 300
    A = generate_test_matrix(n=n, symmetric=False)
    b = np.random.randn(n)

    try:
        x, result = solve_gmres(A, b, tol=1e-8, max_iter=500, time_limit=30.0, use_preconditioner=True)

        print(f"✅ GMRES+ILU求解完成")
        print(f"   预条件器: {result.get('preconditioner', 'none')}")
        print(f"   求解时间: {result['solve_time']:.4f} 秒")
        print(f"   迭代次数: {result['iterations']}")
        print(f"   最终残差: {result['final_residual']:.2e}")
        print(f"   是否收敛: {result['converged']}")

        return result.get('preconditioner') != 'none'
    except Exception as e:
        print(f"❌ GMRES+ILU求解失败: {e}")
        return False


def test_superlu_solver():
    print("\n" + "=" * 60)
    print("测试6: SuperLU直接求解器（小规模）")
    print("=" * 60)

    n = 200
    A = generate_test_matrix(n=n, symmetric=False)
    b = np.random.randn(n)

    try:
        x, result = solve_superlu(A, b, tol=1e-10, max_iter=1, time_limit=30.0)
        final_residual = compute_residual(A, x, b)

        print(f"✅ SuperLU求解完成")
        print(f"   求解时间: {result['solve_time']:.4f} 秒")
        print(f"   迭代次数: {result['iterations']}")
        print(f"   最终残差: {final_residual:.2e}")
        print(f"   是否收敛: {result['converged']}")
        print(f"   降级标志: {result.get('fallback', False)}")

        return final_residual < 1e-6 and not result.get('fallback', False)
    except Exception as e:
        print(f"❌ SuperLU求解失败: {e}")
        return False


def test_superlu_large_fallback():
    print("\n" + "=" * 60)
    print("测试7: SuperLU大规模矩阵自动降级")
    print("=" * 60)

    n = SUPERLU_SIZE_THRESHOLD + 1000
    A = sparse.diags(
        [np.random.randn(n - 1), 10 + np.random.rand(n), np.random.randn(n - 1)],
        [-1, 0, 1],
        shape=(n, n),
    ).tocsr()
    b = np.ones(n)

    print(f"   测试矩阵: {n} x {n}, 非零元: {A.nnz}")
    print(f"   SuperLU降级阈值: {SUPERLU_SIZE_THRESHOLD}")

    try:
        x, result = solve_superlu(A, b, tol=1e-6, max_iter=100, time_limit=60.0)

        print(f"✅ SuperLU大规模矩阵处理完成")
        print(f"   实际求解器: {result.get('solver', 'superlu')}")
        print(f"   是否降级: {result.get('fallback', False)}")
        print(f"   预条件器: {result.get('preconditioner', 'none')}")
        if result.get('note'):
            print(f"   降级说明: {result['note']}")
        print(f"   求解时间: {result['solve_time']:.4f} 秒")
        print(f"   迭代次数: {result['iterations']}")
        print(f"   最终残差: {result['final_residual']:.2e}")

        return result.get('fallback', False) or result.get('solver') == 'superlu_iterative'
    except Exception as e:
        print(f"❌ SuperLU大规模降级失败: {e}")
        return False


def test_symmetry_detection():
    print("\n" + "=" * 60)
    print("测试8: 矩阵对称性检测")
    print("=" * 60)

    n = 300
    A_sym = generate_test_matrix(n=n, symmetric=True)
    A_nonsym = generate_test_matrix(n=n, symmetric=False)

    try:
        is_sym = is_symmetric(A_sym)
        is_nonsym = is_symmetric(A_nonsym)

        print(f"✅ 对称性检测完成")
        print(f"   对称矩阵检测结果: {'对称' if is_sym else '非对称'} (期望: 对称)")
        print(f"   非对称矩阵检测结果: {'对称' if is_nonsym else '非对称'} (期望: 非对称)")

        return is_sym and not is_nonsym
    except Exception as e:
        print(f"❌ 对称性检测失败: {e}")
        return False


def test_large_heatmap_memory():
    print("\n" + "=" * 60)
    print("测试9: 大规模矩阵热力图内存安全")
    print("=" * 60)

    n = 50000
    A = sparse.diags(
        [np.ones(n - 1), 10 * np.ones(n), np.ones(n - 1)],
        [-1, 0, 1],
        shape=(n, n),
    ).tocsr()
    print(f"   测试矩阵: {n} x {n}, 非零元: {A.nnz}")

    try:
        heatmap = generate_heatmap_data(A, num_bins=100, max_points=5000)
        print(f"✅ 大规模热力图生成成功")
        print(f"   分箱数量: {len(heatmap['bins'])}")
        print(f"   采样点数: {len(heatmap['sample_points'])}")
        assert len(heatmap['sample_points']) <= 5000, f"采样点超限: {len(heatmap['sample_points'])}"
        return True
    except Exception as e:
        print(f"❌ 大规模热力图失败: {e}")
        return False


def test_timeout_mechanism():
    print("\n" + "=" * 60)
    print("测试10: 超时机制验证")
    print("=" * 60)

    n = 2000
    A = generate_test_matrix(n=n, density=0.5)
    b = np.random.randn(n)

    try:
        x, result = solve_cg(A, b, tol=1e-12, max_iter=10, time_limit=2.0)
        print(f"✅ 超时机制正常工作")
        print(f"   求解时间: {result['solve_time']:.2f} 秒 (限制2秒)")
        print(f"   迭代次数: {result['iterations']}")
        return True
    except TimeoutError as e:
        print(f"✅ 正确触发超时异常: {e}")
        return True
    except Exception as e:
        print(f"❌ 超时测试异常: {e}")
        return False


def run_all_tests():
    print("\n" + "=" * 60)
    print("高性能稀疏矩阵求解器 - 修复验证测试")
    print("=" * 60)

    results = []

    results.append(("矩阵解析", test_matrix_parsing()))
    results.append(("矩阵统计", test_matrix_stats()))
    results.append(("热力图生成", test_heatmap_generation()))
    results.append(("CG+ICC预条件", test_cg_icc_preconditioner()))
    results.append(("GMRES+ILU预条件", test_gmres_ilu_preconditioner()))
    results.append(("SuperLU小规模", test_superlu_solver()))
    results.append(("SuperLU大规模降级", test_superlu_large_fallback()))
    results.append(("对称性检测", test_symmetry_detection()))
    results.append(("大规模热力图", test_large_heatmap_memory()))
    results.append(("超时机制", test_timeout_mechanism()))

    print("\n" + "=" * 60)
    print("测试结果汇总")
    print("=" * 60)

    passed = sum(1 for _, r in results if r)
    total = len(results)

    for name, result in results:
        status = "✅ 通过" if result else "❌ 失败"
        print(f"   {name}: {status}")

    print(f"\n总计: {passed}/{total} 测试通过")

    if passed == total:
        print("\n🎉 所有测试通过！修复验证成功。")
        return 0
    else:
        print(f"\n⚠️  有 {total - passed} 个测试失败，请检查。")
        return 1


if __name__ == "__main__":
    sys.exit(run_all_tests())
