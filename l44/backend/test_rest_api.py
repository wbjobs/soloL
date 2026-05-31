import sys
import os
import json
import requests

API_BASE = "http://127.0.0.1:8000"


def test_rest_api():
    print("=" * 60)
    print("测试REST API接口")
    print("=" * 60)

    all_passed = True

    print("\n1. 测试 /api/bell/{type} 接口...")
    try:
        r = requests.get(f"{API_BASE}/api/bell/phi+", timeout=10)
        data = r.json()
        assert r.status_code == 200, f"状态码错误: {r.status_code}"
        assert data['n_qubits'] == 2
        assert data['entanglement_result']['is_entangled'] == True
        print("   [OK] Bell态接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    print("\n2. 测试 /api/ghz/{n} 接口...")
    try:
        r = requests.get(f"{API_BASE}/api/ghz/3", timeout=10)
        data = r.json()
        assert r.status_code == 200
        assert data['n_qubits'] == 3
        assert len(data['state_vector']) == 8
        print("   [OK] GHZ态接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    print("\n3. 测试 /api/state 接口 (POST)...")
    try:
        payload = {
            "n_qubits": 2,
            "gates": [
                {"gate_type": "H", "target_qubit": 0},
                {"gate_type": "CNOT", "target_qubit": 1, "control_qubit": 0}
            ]
        }
        r = requests.post(f"{API_BASE}/api/state", json=payload, timeout=10)
        data = r.json()
        assert r.status_code == 200
        assert data['n_qubits'] == 2
        assert data['entanglement_result']['is_entangled'] == True
        print("   [OK] 量子态创建接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    print("\n4. 测试 /api/entanglement 接口...")
    try:
        payload = {
            "n_qubits": 2,
            "gates": [
                {"gate_type": "H", "target_qubit": 0},
                {"gate_type": "CNOT", "target_qubit": 1, "control_qubit": 0}
            ]
        }
        r = requests.post(f"{API_BASE}/api/entanglement", json=payload, timeout=10)
        data = r.json()
        assert r.status_code == 200
        assert 'ppt_criterion' in data
        assert 'concurrence' in data
        print("   [OK] 纠缠检测接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    print("\n5. 测试 /api/interpolate 接口...")
    try:
        payload = {
            "state1": {"n_qubits": 1},
            "state2": {"n_qubits": 1, "gates": [{"gate_type": "X", "target_qubit": 0}]},
            "steps": 10,
            "qubit_index": 0
        }
        r = requests.post(f"{API_BASE}/api/interpolate", json=payload, timeout=10)
        data = r.json()
        assert r.status_code == 200
        assert 'interpolation_points' in data
        assert len(data['interpolation_points']) == 10
        print("   [OK] 插值接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    print("\n6. 测试 /api/history 接口...")
    try:
        r = requests.get(f"{API_BASE}/api/history?limit=5", timeout=10)
        data = r.json()
        assert r.status_code == 200
        assert 'history' in data
        assert 'statistics' in data
        print("   [OK] 历史记录接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    print("\n7. 测试 /api/ 根接口...")
    try:
        r = requests.get(f"{API_BASE}/", timeout=10)
        data = r.json()
        assert r.status_code == 200
        assert 'name' in data
        assert 'version' in data
        print("   [OK] 根接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        all_passed = False

    if all_passed:
        print("\n" + "=" * 60)
        print("[OK] 所有REST API测试通过!")
        print("=" * 60)
        return True
    else:
        print("\n" + "=" * 60)
        print("[FAIL] 部分测试失败!")
        print("=" * 60)
        return False


if __name__ == "__main__":
    success = test_rest_api()
    sys.exit(0 if success else 1)
