import httpx
import json
from datetime import datetime

print("单独测试回测API...")

params = {
    'start_date': '2024-01-01',
    'end_date': '2024-02-01',
    'initial_cash': 100000.0,
    'strategy': 'delta_neutral',
    'delta_target': 0.0,
    'delta_tolerance': 0.1
}

print(f"参数: {params}")
print(f"开始时间: {datetime.now()}")

try:
    with httpx.Client(timeout=30.0) as client:
        response = client.post('http://localhost:8080/api/backtest/run', params=params)
        print(f"结束时间: {datetime.now()}")
        print(f"状态码: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            backtest_result = result.get('result', {})
            print(f"\n✅ 回测成功!")
            print(f"  计算时间: {result.get('calculation_time_ms', 0):.0f}ms")
            print(f"  总收益率: {backtest_result.get('total_return', 0)*100:.4f}%")
            print(f"  总盈亏: {backtest_result.get('total_pnl', 0):.2f}")
            print(f"  夏普比率: {backtest_result.get('sharpe_ratio', 0):.3f}")
            print(f"  最大回撤: {backtest_result.get('max_drawdown', 0)*100:.4f}%")
            print(f"  交易次数: {backtest_result.get('num_trades', 0)}")
            print(f"  收益率曲线点数: {len(backtest_result.get('portfolio_values', []))}")
        else:
            print(f"\n❌ 回测失败!")
            print(f"  错误: {response.text}")
            
except Exception as e:
    print(f"结束时间: {datetime.now()}")
    print(f"❌ 异常: {e}")
    import traceback
    traceback.print_exc()
