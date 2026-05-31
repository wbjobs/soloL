import sys
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

print("直接测试回测流程...")

print("\n1. 测试generate_historical_data...")
try:
    from backtest_engine import BacktestEngine, DeltaNeutralStrategy, StrategyConfig
    
    engine = BacktestEngine()
    start = datetime(2024, 1, 1)
    end = datetime(2024, 3, 1)
    
    print(f"  开始: {start}, 结束: {end}")
    
    # 手动生成数据，不调用有问题的函数
    delta = end - start
    days = max(1, delta.days)
    n_steps = days + 1
    
    print(f"  天数: {days}, 步数: {n_steps}")
    
    dates = []
    for i in range(n_steps):
        d = start + timedelta(days=i)
        dates.append(datetime(d.year, d.month, d.day))
    
    print(f"  日期列表长度: {len(dates)}")
    print(f"  第1个日期: {dates[0]}, 类型: {type(dates[0])}")
    
    S0 = 4.0
    mu = 0.05
    sigma = 0.2
    dt = 1 / 252
    drift = (mu - 0.5 * sigma**2) * dt
    vol = sigma * (dt ** 0.5)
    
    prices = [float(S0)]
    current_price = S0
    for i in range(1, n_steps):
        z = np.random.standard_normal()
        current_price = current_price * np.exp(drift + vol * z)
        prices.append(float(current_price))
    
    vols = [float(sigma)] * n_steps
    
    print(f"  价格列表长度: {len(prices)}, 第1个: {prices[0]}, 类型: {type(prices[0])}")
    print(f"  波动率列表长度: {len(vols)}, 第1个: {vols[0]}, 类型: {type(vols[0])}")
    
    data = {
        'timestamp': dates,
        'underlying_price': prices,
        'volatility': vols
    }
    
    print(f"\n  数据字典键: {list(data.keys())}")
    print(f"  各值类型:")
    for k, v in data.items():
        print(f"    {k}: {type(v)}, 第1个元素类型: {type(v[0])}")
    
    print(f"\n  尝试创建DataFrame...")
    
    # 方法1: 直接创建
    try:
        df = pd.DataFrame(data)
        print(f"    方法1成功! 形状: {df.shape}")
    except Exception as e:
        print(f"    方法1失败: {e}")
    
    # 方法2: 使用from_dict
    try:
        df = pd.DataFrame.from_dict(data)
        print(f"    方法2成功! 形状: {df.shape}")
    except Exception as e:
        print(f"    方法2失败: {e}")
    
    # 方法3: 逐列添加
    try:
        df = pd.DataFrame()
        df['timestamp'] = pd.Series(dates, dtype='object')
        df['underlying_price'] = pd.Series(prices, dtype='float64')
        df['volatility'] = pd.Series(vols, dtype='float64')
        print(f"    方法3成功! 形状: {df.shape}")
    except Exception as e:
        print(f"    方法3失败: {e}")
        import traceback
        traceback.print_exc()
    
except Exception as e:
    print(f"  ❌ 错误: {e}")
    import traceback
    traceback.print_exc()

print("\n2. 测试不使用pandas的简单回测...")
try:
    from backtest_engine import run_delta_neutral_backtest
    
    print("  尝试运行回测...")
    result = run_delta_neutral_backtest(start, end, 100000.0, 0.0, 0.1)
    print(f"  ✅ 回测成功!")
    print(f"    总收益率: {result.total_return*100:.2f}%")
    print(f"    夏普比率: {result.sharpe_ratio:.3f}")
except Exception as e:
    print(f"  ❌ 错误: {e}")
    import traceback
    traceback.print_exc()
