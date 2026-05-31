import httpx
import json

BASE_URL = "http://localhost:8080"

print("检查希腊值API返回...")
try:
    r = httpx.get(f"{BASE_URL}/api/greeks/current", timeout=10.0)
    print(f"状态码: {r.status_code}")
    data = r.json()
    print(f"返回键: {list(data.keys())}")
    
    if 'delta_grid' in data:
        print(f"delta_grid类型: {type(data['delta_grid'])}")
        print(f"delta_grid长度: {len(data['delta_grid'])}")
        if len(data['delta_grid']) > 0:
            print(f"delta_grid[0]长度: {len(data['delta_grid'][0])}")
            print(f"delta_grid[0][:5]: {data['delta_grid'][0][:5]}")
    
    if 'moneyness_grid' in data:
        print(f"moneyness_grid长度: {len(data['moneyness_grid'])}")
        print(f"moneyness_grid[:5]: {data['moneyness_grid'][:5]}")
    
    if 'tenor_grid' in data:
        print(f"tenor_grid长度: {len(data['tenor_grid'])}")
        print(f"tenor_grid[:5]: {data['tenor_grid'][:5]}")
    
    print("\n完整返回(前1000字符):")
    print(json.dumps(data, indent=2)[:1000])
    
except Exception as e:
    print(f"错误: {e}")

print("\n\n检查surface API返回...")
try:
    r = httpx.get(f"{BASE_URL}/api/surface/current", timeout=10.0)
    print(f"状态码: {r.status_code}")
    data = r.json()
    print(f"返回键: {list(data.keys())}")
    
    if 'moneyness_grid' in data:
        print(f"moneyness_grid长度: {len(data['moneyness_grid'])}")
    if 'tenor_grid' in data:
        print(f"tenor_grid长度: {len(data['tenor_grid'])}")
    if 'iv_grid' in data:
        print(f"iv_grid维度: {len(data['iv_grid'])}x{len(data['iv_grid'][0]) if data['iv_grid'] else 0}")
        
except Exception as e:
    print(f"错误: {e}")
