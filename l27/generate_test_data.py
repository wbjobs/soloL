import pandas as pd
import numpy as np
from datetime import datetime, timedelta


def generate_test_data(output_path='test_data.csv', days=90, anomalies=True):
    start_date = datetime(2024, 1, 1)
    dates = [start_date + timedelta(days=i) for i in range(days)]
    
    base_value = 100
    trend = np.linspace(0, 50, days)
    
    weekly_seasonality = 10 * np.sin(2 * np.pi * np.arange(days) / 7)
    yearly_seasonality = 20 * np.sin(2 * np.pi * np.arange(days) / 365)
    
    noise = np.random.normal(0, 5, days)
    
    values = base_value + trend + weekly_seasonality + yearly_seasonality + noise
    
    if anomalies:
        anomaly_indices = [30, 31, 32, 45, 60, 61, 62, 63, 75]
        for idx in anomaly_indices:
            if idx < len(values):
                if idx == 45:
                    values[idx] += 40
                else:
                    values[idx] += 30
        
        drop_indices = [50, 70]
        for idx in drop_indices:
            if idx < len(values):
                values[idx] -= 35
    
    df = pd.DataFrame({
        'ds': dates,
        'y': values
    })
    
    df.to_csv(output_path, index=False)
    print(f"Test data generated: {output_path}")
    print(f"Total records: {len(df)}")
    print(f"Date range: {df['ds'].min()} to {df['ds'].max()}")
    
    return df


if __name__ == '__main__':
    generate_test_data('sample_data.csv', days=100, anomalies=True)
