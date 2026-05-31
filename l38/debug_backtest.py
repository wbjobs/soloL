import sys
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

print("测试pandas DataFrame创建...")

start_date = datetime(2024, 1, 1)
end_date = datetime(2024, 6, 1)

print(f"开始日期: {start_date}")
print(f"结束日期: {end_date}")

try:
    print("\n方法1: pd.date_range")
    dates = pd.date_range(start=start_date, end=end_date, freq='D')
    print(f"  日期类型: {type(dates)}")
    print(f"  日期长度: {len(dates)}")
    print(f"  第1个元素: {dates[0]}, 类型: {type(dates[0])}")
    
    dates_list = dates.to_pydatetime().tolist()
    print(f"  转换后类型: {type(dates_list)}")
    print(f"  第1个元素: {dates_list[0]}, 类型: {type(dates_list[0])}")
    
    n_steps = len(dates_list)
    prices = 4.0 * np.exp(np.cumsum(np.random.standard_normal(n_steps) * 0.01))
    
    print(f"\n尝试创建DataFrame...")
    df = pd.DataFrame({
        'timestamp': list(dates_list),
        'underlying_price': [float(p) for p in prices],
        'volatility': [float(0.2)] * n_steps
    })
    print(f"  DataFrame创建成功! 形状: {df.shape}")
    print(f"  列类型: {df.dtypes}")
except Exception as e:
    print(f"  方法1失败: {e}")
    import traceback
    traceback.print_exc()

print("\n\n方法2: 纯Python日期列表")
try:
    delta = end_date - start_date
    days = max(1, delta.days)
    dates = [datetime(start_date.year, start_date.month, start_date.day) + timedelta(days=i) 
             for i in range(days + 1)]
    print(f"  日期长度: {len(dates)}")
    print(f"  第1个元素: {dates[0]}, 类型: {type(dates[0])}")
    
    n_steps = len(dates)
    prices = 4.0 * np.exp(np.cumsum(np.random.standard_normal(n_steps) * 0.01))
    
    print(f"\n尝试创建DataFrame...")
    df = pd.DataFrame({
        'timestamp': list(dates),
        'underlying_price': [float(p) for p in prices],
        'volatility': [float(0.2)] * n_steps
    })
    print(f"  DataFrame创建成功! 形状: {df.shape}")
except Exception as e:
    print(f"  方法2失败: {e}")
    import traceback
    traceback.print_exc()

print("\n\n方法3: 使用pd.Timestamp")
try:
    dates = pd.date_range(start=start_date, end=end_date, freq='D')
    dates_ts = [pd.Timestamp(d) for d in dates]
    print(f"  第1个元素: {dates_ts[0]}, 类型: {type(dates_ts[0])}")
    
    n_steps = len(dates_ts)
    prices = [float(4.0 * np.exp(np.random.normal(0, 0.01))) for _ in range(n_steps)]
    
    df = pd.DataFrame({
        'timestamp': dates_ts,
        'underlying_price': prices,
        'volatility': [0.2] * n_steps
    })
    print(f"  DataFrame创建成功! 形状: {df.shape}")
except Exception as e:
    print(f"  方法3失败: {e}")
    import traceback
    traceback.print_exc()

print("\n\npandas版本:", pd.__version__)
print("numpy版本:", np.__version__)
