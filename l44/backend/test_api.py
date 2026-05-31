import sys
import os
import asyncio
import json
import requests
import websockets

API_BASE = "http://127.0.0.1:8000"
WS_URL = "ws://127.0.0.1:8000/ws"


def test_rest_api():
    print("=" * 60)
    print("测试REST API接口")
    print("=" * 60)

    print("\n1. 测试 /api/bell/{type} 接口...")
    try:
        r = requests.get(f"{API_BASE}/api/bell/phi+")
        data = r.json()
        print(f"   状态码: {r.status_code}")
        print(f"   量子比特数: {data['n_qubits']}")
        print(f"   态矢量长度: {len(data['state_vector'])}")
        print(f"   纠缠: {data['entanglement_result']['is_entangled']}")
        print("   [OK] Bell态接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False

    print("\n2. 测试 /api/ghz/{n} 接口...")
    try:
        r = requests.get(f"{API_BASE}/api/ghz/3")
        data = r.json()
        print(f"   状态码: {r.status_code}")
        print(f"   量子比特数: {data['n_qubits']}")
        print(f"   态矢量长度: {len(data['state_vector'])}")
        print(f"   纠缠: {data['entanglement_result']['is_entangled']}")
        print("   [OK] GHZ态接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False

    print("\n3. 测试 /api/state 接口 (POST)...")
    try:
        payload = {
            "n_qubits": 2,
            "gates": [
                {"gate_type": "H", "target_qubit": 0},
                {"gate_type": "CNOT", "target_qubit": 1, "control_qubit": 0}
            ]
        }
        r = requests.post(f"{API_BASE}/api/state", json=payload)
        data = r.json()
        print(f"   状态码: {r.status_code}")
        print(f"   量子比特数: {data['n_qubits']}")
        print(f"   纠缠: {data['entanglement_result']['is_entangled']}")
        print(f"   Concurrence: {data['entanglement_result']['concurrence']['concurrence']:.4f}")
        print("   [OK] 量子态创建接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False

    print("\n4. 测试 /api/entanglement 接口...")
    try:
        payload = {
            "n_qubits": 2,
            "gates": [
                {"gate_type": "H", "target_qubit": 0},
                {"gate_type": "CNOT", "target_qubit": 1, "control_qubit": 0}
            ]
        }
        r = requests.post(f"{API_BASE}/api/entanglement", json=payload)
        data = r.json()
        print(f"   状态码: {r.status_code}")
        print(f"   PPT最小本征值: {data['ppt_criterion']['min_eigenvalue']:.6e}")
        print(f"   Negativity: {data['ppt_criterion']['negativity']:.4f}")
        print("   [OK] 纠缠检测接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False

    print("\n5. 测试 /api/interpolate 接口...")
    try:
        payload = {
            "state1": {"n_qubits": 1},
            "state2": {"n_qubits": 1, "gates": [{"gate_type": "X", "target_qubit": 0}]},
            "steps": 10,
            "qubit_index": 0
        }
        r = requests.post(f"{API_BASE}/api/interpolate", json=payload)
        data = r.json()
        print(f"   状态码: {r.status_code}")
        print(f"   插值点数: {len(data['interpolation_points'])}")
        print(f"   起点: ({data['interpolation_points'][0]['x']:.3f}, {data['interpolation_points'][0]['y']:.3f}, {data['interpolation_points'][0]['z']:.3f})")
        print(f"   终点: ({data['interpolation_points'][-1]['x']:.3f}, {data['interpolation_points'][-1]['y']:.3f}, {data['interpolation_points'][-1]['z']:.3f})")
        print("   [OK] 插值接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False

    print("\n6. 测试 /api/history 接口...")
    try:
        r = requests.get(f"{API_BASE}/api/history?limit=5")
        data = r.json()
        print(f"   状态码: {r.status_code}")
        print(f"   记录数: {len(data['history'])}")
        print(f"   统计: {data['statistics']}")
        print("   [OK] 历史记录接口正常")
    except Exception as e:
        print(f"   [FAIL] {e}")
        return False

    print("\n[OK] 所有REST API测试通过!")
    return True


async def test_websocket():
    print("\n" + "=" * 60)
    print("测试WebSocket实时通信")
    print("=" * 60)

    try:
        async with websockets.connect(WS_URL) as websocket:
            print("\n1. 测试 set_qubits 命令...")
            msg = json.dumps({"action": "set_qubits", "n_qubits": 2})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   量子比特数: {response.get('n_qubits')}")
            print(f"   态矢量长度: {len(response.get('state_vector', []))}")
            print("   [OK] set_qubits 正常")

            print("\n2. 测试 apply_gate 命令 (Hadamard)...")
            msg = json.dumps({"action": "apply_gate", "gate": "H", "target": 0})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   门操作: {response.get('gate_applied')}")
            print(f"   纠缠检测: 已执行")
            print("   [OK] apply_gate (H) 正常")

            print("\n3. 测试 apply_gate 命令 (CNOT)...")
            msg = json.dumps({"action": "apply_gate", "gate": "CNOT", "control": 0, "target": 1})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   门操作: {response.get('gate_applied')}")
            print(f"   是否纠缠: {response.get('entanglement_result', {}).get('is_entangled')}")
            print("   [OK] apply_gate (CNOT) 正常")

            print("\n4. 测试 detect_entanglement 命令...")
            msg = json.dumps({"action": "detect_entanglement"})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   PPT最小本征值: {response.get('entanglement_result', {}).get('ppt_criterion', {}).get('min_eigenvalue'):.6e}")
            print(f"   Concurrence: {response.get('entanglement_result', {}).get('concurrence', {}).get('concurrence'):.4f}")
            print("   [OK] detect_entanglement 正常")

            print("\n5. 测试 interpolate 命令...")
            msg = json.dumps({"action": "interpolate", "steps": 5, "qubit_index": 0})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   插值点数: {len(response.get('interpolation_points', []))}")
            print("   [OK] interpolate 正常")

            print("\n6. 测试 get_bell 命令...")
            msg = json.dumps({"action": "get_bell", "bell_type": "psi-"})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   Bell态: {response.get('bell_type')}")
            print("   [OK] get_bell 正常")

            print("\n7. 测试 get_ghz 命令...")
            msg = json.dumps({"action": "get_ghz", "n_qubits": 3})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   GHZ态比特数: {response.get('n_qubits')}")
            print("   [OK] get_ghz 正常")

            print("\n8. 测试 reset 命令...")
            msg = json.dumps({"action": "reset"})
            await websocket.send(msg)
            response = json.loads(await websocket.recv())
            print(f"   响应类型: {response.get('type')}")
            print(f"   重置后比特数: {response.get('n_qubits')}")
            print("   [OK] reset 正常")

        print("\n[OK] 所有WebSocket测试通过!")
        return True

    except Exception as e:
        print(f"\n[FAIL] WebSocket测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 60)
    print("量子态可视化平台 - API和WebSocket测试")
    print("=" * 60)

    try:
        rest_ok = test_rest_api()
        if not rest_ok:
            print("\n[FAIL] REST API测试失败")
            return False

        ws_ok = asyncio.run(test_websocket())
        if not ws_ok:
            print("\n[FAIL] WebSocket测试失败")
            return False

        print("\n" + "=" * 60)
        print("[OK] 所有API和WebSocket测试通过!")
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
