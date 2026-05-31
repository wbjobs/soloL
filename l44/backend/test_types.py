import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np
from quantum_core import create_bell_state
from entanglement_detection import detect_entanglement
from database import convert_numpy_types
import json

print("测试数据类型转换...")

qs = create_bell_state("phi+")
result = detect_entanglement(qs)

print("\n检查detect_entanglement返回值中的数据类型:")
for k, v in result.items():
    if isinstance(v, dict):
        for k2, v2 in v.items():
            if not isinstance(v2, (str, int, float, list, dict)):
                print(f"  {k}.{k2}: {type(v2)} = {v2}")
    elif not isinstance(v, (str, int, float, list, dict)):
        print(f"  {k}: {type(v)} = {v}")

print("\n检查'is_entangled'字段类型:")
print(f"  result['is_entangled']: {type(result['is_entangled'])} = {result['is_entangled']}")
print(f"  isinstance(np.bool_(True), bool): {isinstance(np.bool_(True), bool)}")

print("\n测试convert_numpy_types:")
converted = convert_numpy_types(result)
print(f"  converted['is_entangled']: {type(converted['is_entangled'])} = {converted['is_entangled']}")

print("\n检查成对纠缠中的bool类型:")
if 'pairwise_entanglement' in result:
    for i, pair in enumerate(result['pairwise_entanglement']):
        print(f"  pair {i} is_entangled: {type(pair['is_entangled'])}")

print("\n测试JSON序列化:")
try:
    json_str = json.dumps(convert_numpy_types(result))
    print(f"  序列化成功! 长度: {len(json_str)}")
except Exception as e:
    print(f"  序列化失败: {e}")

print("\n测试PPT结果中的bool类型:")
ppt = result.get('ppt_criterion', {})
for k, v in ppt.items():
    if not isinstance(v, (str, int, float, list, dict)):
        print(f"  ppt.{k}: {type(v)} = {v}")
