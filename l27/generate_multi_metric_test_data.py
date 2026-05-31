import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import os


def generate_multi_metric_data(output_dir='test_multi_metric', days=100, anomalies=True):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    start_date = datetime(2024, 1, 1)
    dates = [start_date + timedelta(days=i) for i in range(days)]
    
    base_trend = np.linspace(0, 20, days)
    weekly_seasonality = 10 * np.sin(2 * np.pi * np.arange(days) / 7)
    
    cpu_base = 40 + base_trend + weekly_seasonality + np.random.normal(0, 5, days)
    
    memory_base = 60 + 0.5 * base_trend + 0.8 * weekly_seasonality + np.random.normal(0, 4, days)
    
    network_base = 50 + 0.3 * base_trend + 0.6 * weekly_seasonality + np.random.normal(0, 6, days)
    
    disk_io_base = 30 + 0.2 * base_trend + 0.4 * weekly_seasonality + np.random.normal(0, 3, days)
    
    if anomalies:
        anomaly_period = range(70, 78)
        for i in anomaly_period:
            if i < days:
                cpu_base[i] += 40
                network_base[i] -= 30
        
        anomaly_period_2 = range(85, 88)
        for i in anomaly_period_2:
            if i < days:
                memory_base[i] += 25
                cpu_base[i] -= 15
        
        single_anomalies = [50, 60]
        for i in single_anomalies:
            if i < days:
                disk_io_base[i] += 50
    
    cpu_df = pd.DataFrame({
        'ds': dates,
        'value': np.clip(cpu_base, 0, 100)
    })
    cpu_df.to_csv(os.path.join(output_dir, 'CPU.csv'), index=False)
    
    memory_df = pd.DataFrame({
        'ds': dates,
        'value': np.clip(memory_base, 0, 100)
    })
    memory_df.to_csv(os.path.join(output_dir, '内存.csv'), index=False)
    
    network_df = pd.DataFrame({
        'ds': dates,
        'value': np.clip(network_base, 0, 100)
    })
    network_df.to_csv(os.path.join(output_dir, '网络流量.csv'), index=False)
    
    disk_df = pd.DataFrame({
        'ds': dates,
        'value': np.clip(disk_io_base, 0, 100)
    })
    disk_df.to_csv(os.path.join(output_dir, '磁盘IO.csv'), index=False)
    
    print(f"多指标测试数据已生成到目录: {output_dir}")
    print(f"生成的文件:")
    print(f"  - CPU.csv (与网络流量正相关)")
    print(f"  - 内存.csv")
    print(f"  - 网络流量.csv")
    print(f"  - 磁盘IO.csv")
    print(f"\n注入的联合异常:")
    print(f"  - 第70-77天: CPU升高 (+40%), 网络流量降低 (-30%) → 矛盾异常")
    print(f"  - 第85-87天: 内存升高 (+25%), CPU降低 (-15%) → 矛盾异常")
    print(f"  - 第50、60天: 磁盘IO单点异常 (+50%)")
    print(f"\n数据点数: {days}")
    print(f"日期范围: {dates[0].date()} 到 {dates[-1].date()}")
    
    return output_dir


def generate_correlated_metrics(output_dir='test_correlated', days=120):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    start_date = datetime(2024, 1, 1)
    dates = [start_date + timedelta(days=i) for i in range(days)]
    
    base_signal = 50 + 20 * np.sin(2 * np.pi * np.arange(days) / 30) + np.random.normal(0, 3, days)
    
    metric1 = base_signal + np.random.normal(0, 2, days)
    metric2 = 0.8 * base_signal + 10 + np.random.normal(0, 2, days)
    metric3 = 1.2 * base_signal - 5 + np.random.normal(0, 2, days)
    metric4 = -0.6 * base_signal + 80 + np.random.normal(0, 2, days)
    
    for i in [50, 51, 52]:
        if i < days:
            metric1[i] += 30
            metric2[i] -= 20
    
    for i in [90, 91]:
        if i < days:
            metric3[i] -= 25
            metric4[i] += 15
    
    pd.DataFrame({'ds': dates, 'value': metric1}).to_csv(os.path.join(output_dir, '指标A.csv'), index=False)
    pd.DataFrame({'ds': dates, 'value': metric2}).to_csv(os.path.join(output_dir, '指标B.csv'), index=False)
    pd.DataFrame({'ds': dates, 'value': metric3}).to_csv(os.path.join(output_dir, '指标C.csv'), index=False)
    pd.DataFrame({'ds': dates, 'value': metric4}).to_csv(os.path.join(output_dir, '指标D.csv'), index=False)
    
    print(f"\n相关指标测试数据已生成到目录: {output_dir}")
    print(f"指标A、B、C强正相关，指标D强负相关")
    print(f"注入的矛盾异常:")
    print(f"  - 第50-52天: A(+30), B(-20) → 打破相关性")
    print(f"  - 第90-91天: C(-25), D(+15) → 打破相关性")


if __name__ == '__main__':
    generate_multi_metric_data()
    generate_correlated_metrics()
