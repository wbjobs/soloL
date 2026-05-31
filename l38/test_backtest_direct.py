import sys
from datetime import datetime
import numpy as np

print("直接测试回测引擎...\n")

try:
    from backtest_engine import run_delta_neutral_backtest
    
    start = datetime(2024, 1, 1)
    end = datetime(2024, 2, 1)
    
    print(f"1. 调用 run_delta_neutral_backtest...")
    print(f"   开始: {start}")
    print(f"   结束: {end}")
    print(f"   初始资金: 100000.0")
    
    result = run_delta_neutral_backtest(start, end, 100000.0, 0.0, 0.1)
    
    print(f"\n2. 回测结果对象:")
    print(f"   类型: {type(result)}")
    
    print(f"\n3. BacktestResult属性:")
    print(f"   timestamps: {len(result.timestamps)} 条")
    print(f"   portfolio_values: {len(result.portfolio_values)} 条")
    print(f"   cash_values: {len(result.cash_values)} 条")
    print(f"   positions_values: {len(result.positions_values)} 条")
    print(f"   total_pnl: {result.total_pnl}")
    print(f"   total_return: {result.total_return}")
    print(f"   sharpe_ratio: {result.sharpe_ratio}")
    print(f"   max_drawdown: {result.max_drawdown}")
    print(f"   num_trades: {result.num_trades}")
    print(f"   signals: {len(result.signals)} 条")
    
    print(f"\n4. to_dict() 结果:")
    result_dict = result.to_dict()
    for k, v in result_dict.items():
        if isinstance(v, list):
            print(f"   {k}: {len(v)} 条, 前3个: {v[:3] if len(v) >= 3 else v}")
        else:
            print(f"   {k}: {v}")
    
    print(f"\n5. 检查 portfolio_values:")
    if result.portfolio_values:
        print(f"   第1个: {result.portfolio_values[0]}")
        print(f"   最后1个: {result.portfolio_values[-1]}")
        print(f"   最小: {min(result.portfolio_values)}")
        print(f"   最大: {max(result.portfolio_values)}")
    
except Exception as e:
    print(f"\n❌ 错误: {e}")
    import traceback
    traceback.print_exc()
