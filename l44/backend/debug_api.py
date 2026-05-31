import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import requests
import json

API_BASE = "http://127.0.0.1:8000"

print("测试 /api/bell/phi+ 接口...")
try:
    r = requests.get(f"{API_BASE}/api/bell/phi+")
    print(f"状态码: {r.status_code}")
    print(f"响应头: {r.headers.get('content-type')}")
    print(f"响应内容前500字符: {r.text[:500]}")
    
    if r.status_code == 200:
        data = r.json()
        print(f"\n解析成功! 键: {list(data.keys())}")
        print(f"n_qubits: {data.get('n_qubits')}")
        print(f"entanglement_result键: {'entanglement_result' in data}")
        if 'entanglement_result' in data:
            print(f"is_entangled: {data['entanglement_result'].get('is_entangled')}")
    else:
        print(f"\n错误详情: {r.json()}")
except Exception as e:
    print(f"异常: {e}")
    import traceback
    traceback.print_exc()
