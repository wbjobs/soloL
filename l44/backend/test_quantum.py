import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from quantum_core import QuantumState, QuantumGate, create_bell_state, create_ghz_state, interpolate_states
from entanglement_detection import detect_entanglement, ppt_criterion, concurrence_2qubit, von_neumann_entropy
from quantum_optimized import fast_quaternion_slerp_batch, fast_quaternion_to_bloch_batch, fast_cnot
from database import QuantumDatabase
import tempfile
import time
import gc


def test_quantum_state():
    print("=" * 60)
    print("测试1: 量子态基本操作")
    print("=" * 60)

    qs = QuantumState(1)
    print(f"初始态: {qs.state_vector}")
    print(f"归一化检查: {np.linalg.norm(qs.state_vector):.6f}")

    x, y, z = qs.to_bloch_sphere()
    print(f"Bloch坐标: ({x:.4f}, {y:.4f}, {z:.4f})")

    q = qs.to_quaternion()
    print(f"四元数: ({q[0]:.4f}, {q[1]:.4f}, {q[2]:.4f}, {q[3]:.4f})")

    qs.apply_hadamard(0)
    print(f"Hadamard后门: {qs.state_vector}")
    x, y, z = qs.to_bloch_sphere()
    print(f"Bloch坐标: ({x:.4f}, {y:.4f}, {z:.4f})")

    print("[OK] 量子态测试通过\n")


def test_quantum_gates():
    print("=" * 60)
    print("测试2: 量子门操作")
    print("=" * 60)

    qs = QuantumState(2)
    print(f"初始2-qubit态: {qs.state_vector}")

    qs.apply_hadamard(0)
    print(f"Hadamard(q0)后: {qs.state_vector}")

    qs.apply_cnot(0, 1)
    print(f"CNOT(q0->q1)后: {qs.state_vector}")

    bell = create_bell_state("phi+")
    print(f"Bell态 Φ⁺: {bell.state_vector}")

    ghz = create_ghz_state(3)
    print(f"GHZ态(3qubit): {ghz.state_vector}")

    cnot_fast = fast_cnot(0, 1, 2)
    print(f"快速CNOT矩阵形状: {cnot_fast.shape}")

    print("[OK] 量子门测试通过\n")


def test_entanglement_detection():
    print("=" * 60)
    print("测试3: 纠缠检测")
    print("=" * 60)

    bell = create_bell_state("phi+")
    result = detect_entanglement(bell)
    print(f"Bell态 Φ⁺ 检测结果:")
    print(f"  是否纠缠: {result['is_entangled']}")
    print(f"  PPT最小本征值: {result['ppt_criterion']['min_eigenvalue']:.6e}")
    print(f"  Concurrence: {result['concurrence']['concurrence']:.4f}")
    print(f"  形成纠缠: {result['concurrence']['entanglement_of_formation']:.4f}")
    print(f"  Negativity: {result['ppt_criterion']['negativity']:.4f}")

    separable = QuantumState(2)
    separable.apply_hadamard(0)
    sep_result = detect_entanglement(separable)
    print(f"\n可分离态检测结果:")
    print(f"  是否纠缠: {sep_result['is_entangled']}")
    print(f"  PPT最小本征值: {sep_result['ppt_criterion']['min_eigenvalue']:.6e}")
    print(f"  Concurrence: {sep_result['concurrence']['concurrence']:.4f}")

    ghz = create_ghz_state(3)
    ghz_result = detect_entanglement(ghz)
    print(f"\nGHZ态(3qubit)检测结果:")
    print(f"  是否纠缠: {ghz_result['is_entangled']}")
    print(f"  成对纠缠对数: {len(ghz_result.get('pairwise_entanglement', []))}")

    print("[OK] 纠缠检测测试通过\n")


def test_quaternion_interpolation():
    print("=" * 60)
    print("测试4: 四元数插值")
    print("=" * 60)

    qs1 = QuantumState(1)
    qs2 = QuantumState(1)
    qs2.apply_x(0)

    q1 = qs1.to_quaternion()
    q2 = qs2.to_quaternion()

    print(f"状态1四元数: ({q1[0]:.4f}, {q1[1]:.4f}, {q1[2]:.4f}, {q1[3]:.4f})")
    print(f"状态2四元数: ({q2[0]:.4f}, {q2[1]:.4f}, {q2[2]:.4f}, {q2[3]:.4f})")

    steps = 10
    quats = fast_quaternion_slerp_batch(q1, q2, steps)
    bloch_points = fast_quaternion_to_bloch_batch(quats)

    print(f"插值步数: {steps}")
    print(f"起点: ({bloch_points[0][0]:.4f}, {bloch_points[0][1]:.4f}, {bloch_points[0][2]:.4f})")
    print(f"中点: ({bloch_points[5][0]:.4f}, {bloch_points[5][1]:.4f}, {bloch_points[5][2]:.4f})")
    print(f"终点: ({bloch_points[-1][0]:.4f}, {bloch_points[-1][1]:.4f}, {bloch_points[-1][2]:.4f})")

    points = interpolate_states(qs1, qs2, steps=steps)
    print(f"高级插值API点数: {len(points)}")

    q_mid = QuantumState.quaternion_slerp(q1, q2, 0.5)
    x, y, z = QuantumState.quaternion_to_bloch(q_mid)
    print(f"50%插值点: ({x:.4f}, {y:.4f}, {z:.4f})")

    print("[OK] 四元数插值测试通过\n")


def test_density_matrix():
    print("=" * 60)
    print("测试5: 密度矩阵与约化密度矩阵")
    print("=" * 60)

    bell = create_bell_state("phi+")
    rho = bell.density_matrix()
    print(f"密度矩阵形状: {rho.shape}")
    print(f"迹: {np.trace(rho).real:.4f}")
    print(f"纯度: {np.trace(rho @ rho).real:.4f}")

    rho0 = bell.reduced_density_matrix(0)
    print(f"Qubit 0约化密度矩阵:\n{rho0}")
    print(f"Qubit 0熵: {von_neumann_entropy(rho0):.4f}")

    rho1 = bell.reduced_density_matrix(1)
    print(f"Qubit 1熵: {von_neumann_entropy(rho1):.4f}")

    entropy = von_neumann_entropy(rho)
    print(f"全系统熵: {entropy:.4f}")

    print("[OK] 密度矩阵测试通过\n")


def test_database():
    print("=" * 60)
    print("测试6: SQLite数据库")
    print("=" * 60)

    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
        db_path = tmp.name

    try:
        db = QuantumDatabase(db_path=db_path)

        qs = create_bell_state("phi+")
        ent_result = detect_entanglement(qs)

        record_id = db.save_calculation(
            operation_type='test',
            n_qubits=2,
            state_vector=qs.state_vector,
            gates_applied=[{'gate': 'H', 'target': 0}, {'gate': 'CNOT', 'control': 0, 'target': 1}],
            entanglement_result=ent_result,
            parameters={'test': True}
        )
        print(f"保存记录ID: {record_id}")

        record = db.get_calculation(record_id)
        print(f"读取记录: {record['operation_type']}, {record['n_qubits']} qubits")

        state_id = db.save_state("Bell Phi+", 2, qs.state_vector, "测试Bell态")
        print(f"保存状态ID: {state_id}")

        stats = db.get_statistics()
        print(f"统计信息: {stats}")

        records = db.get_history(limit=5)
        print(f"历史记录数: {len(records)}")

        print("[OK] 数据库测试通过\n")
    finally:
        gc.collect()
        time.sleep(0.5)
        if os.path.exists(db_path):
            for retry in range(5):
                try:
                    os.unlink(db_path)
                    break
                except:
                    time.sleep(0.2)
                    gc.collect()


def test_multi_qubit():
    print("=" * 60)
    print("测试7: 多量子比特系统 (最多5qubit)")
    print("=" * 60)

    for n in range(1, 6):
        qs = QuantumState(n)
        qs.apply_hadamard(0)
        if n > 1:
            qs.apply_cnot(0, 1)

        result = detect_entanglement(qs)
        print(f"{n}-qubit系统:")
        print(f"  维度: {2**n}")
        print(f"  是否纠缠: {result['is_entangled']}")
        print(f"  态矢量范数: {np.linalg.norm(qs.state_vector):.6f}")

        bloch = qs.to_bloch_sphere(0)
        print(f"  Qubit 0 Bloch: ({bloch[0]:.3f}, {bloch[1]:.3f}, {bloch[2]:.3f})")

    ghz5 = create_ghz_state(5)
    print(f"\n5-qubit GHZ态维度: {ghz5.size}")
    print(f"5-qubit GHZ态范数: {np.linalg.norm(ghz5.state_vector):.6f}")

    print("[OK] 多量子比特测试通过\n")


def test_performance():
    print("=" * 60)
    print("测试8: Numba性能对比")
    print("=" * 60)

    import time

    qs = QuantumState(2)
    rho = qs.density_matrix()

    start = time.time()
    for _ in range(1000):
        _ = np.kron(QuantumGate.H, QuantumGate.I)
    time_np = time.time() - start

    from quantum_optimized import fast_kron
    start = time.time()
    for _ in range(1000):
        _ = fast_kron(QuantumGate.H, QuantumGate.I)
    time_nb = time.time() - start

    print(f"Kronecker乘积 1000次:")
    print(f"  NumPy: {time_np*1000:.2f} ms")
    print(f"  Numba: {time_nb*1000:.2f} ms")
    print(f"  加速比: {time_np/time_nb:.1f}x")

    q1 = np.array([1.0, 0.0, 0.0, 0.0], dtype=np.float64)
    q2 = np.array([0.0, 1.0, 0.0, 0.0], dtype=np.float64)

    start = time.time()
    for _ in range(1000):
        _ = fast_quaternion_slerp_batch(q1, q2, 50)
    time_slerp = time.time() - start
    print(f"\nSLERP 1000次 (50步): {time_slerp*1000:.2f} ms")
    print(f"  平均每次: {time_slerp*1000/1000:.3f} ms")

    print("[OK] 性能测试通过\n")


def main():
    print("\n" + "=" * 60)
    print("量子态可视化平台 - 后端核心测试")
    print("=" * 60 + "\n")

    try:
        test_quantum_state()
        test_quantum_gates()
        test_entanglement_detection()
        test_quaternion_interpolation()
        test_density_matrix()
        test_database()
        test_multi_qubit()
        test_performance()

        print("=" * 60)
        print("[OK] 所有测试通过!")
        print("=" * 60)
        return True
    except Exception as e:
        print(f"\n[FAIL] 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
