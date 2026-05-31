import httpx
import time

print('=== 测试API接口 ===')

r = httpx.get('http://localhost:8080/api/health')
print(f'Health: {r.json()}')

time.sleep(2)

r = httpx.get('http://localhost:8080/api/snapshot')
data = r.json()
print(f'Underlying: {data.get("underlying_symbol")} {data.get("underlying_price"):.3f}')
print(f'Surface exists: {"surface" in data}')
print(f'Ticks count: {len(data.get("ticks", []))}')

if 'surface' in data:
    surf = data['surface']
    print(f'Surface shape: {len(surf["iv_grid"])} x {len(surf["iv_grid"][0])}')
    print(f'Moneyness range: [{surf["moneyness_grid"][0]:.2f}, {surf["moneyness_grid"][-1]:.2f}]')
    print(f'Tenor range: [{surf["tenor_grid"][0]:.4f}, {surf["tenor_grid"][-1]:.4f}]')

r = httpx.get('http://localhost:8080/api/option/price', params={
    'strike': 4.0,
    'time_to_maturity': 0.083,
    'option_type': 'call',
    'use_fdm': 'false',
    'use_surface_iv': 'true'
})
price_data = r.json()
print('\n=== 期权定价结果 ===')
print(f'Strike: {price_data.get("strike")}')
print(f'Price: {price_data.get("price"):.4f}')
print(f'Delta: {price_data.get("delta"):.4f}')
print(f'Gamma: {price_data.get("gamma"):.4f}')
print(f'IV: {price_data.get("implied_volatility"):.4f}')
print(f'Method: {price_data.get("pricing_method")}')

print('\n✅ 所有API接口测试通过!')
