import pandas as pd
import numpy as np
from scipy import signal
from statsmodels.tsa.seasonal import seasonal_decompose


class DataPreprocessor:
    def __init__(self, interpolation_method='linear', detrend_method='seasonal_decompose'):
        self.interpolation_method = interpolation_method
        self.detrend_method = detrend_method
    
    def load_csv(self, file_path, date_column='ds', value_column='y'):
        df = pd.read_csv(file_path)
        
        if date_column not in df.columns:
            date_col = df.select_dtypes(include=['object', 'datetime64']).columns[0]
            df = df.rename(columns={date_col: 'ds'})
        else:
            df = df.rename(columns={date_column: 'ds'})
        
        if value_column not in df.columns:
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            if len(numeric_cols) > 0:
                df = df.rename(columns={numeric_cols[0]: 'y'})
        else:
            df = df.rename(columns={value_column: 'y'})
        
        df['ds'] = pd.to_datetime(df['ds'])
        df = df.sort_values('ds').reset_index(drop=True)
        
        return df[['ds', 'y']]
    
    def handle_missing_values(self, df):
        df_processed = df.copy()
        
        df_processed['y'] = df_processed['y'].interpolate(
            method=self.interpolation_method,
            limit_direction='both'
        )
        
        if df_processed['y'].isna().any():
            df_processed['y'] = df_processed['y'].fillna(df_processed['y'].mean())
        
        return df_processed
    
    def detrend(self, df):
        df_processed = df.copy()
        
        if self.detrend_method == 'seasonal_decompose':
            try:
                result = seasonal_decompose(df_processed['y'], model='additive', period=min(7, len(df_processed)//2), extrapolate_trend='freq')
                df_processed['y'] = result.resid + result.seasonal
                df_processed['trend'] = result.trend
            except:
                df_processed['y'] = signal.detrend(df_processed['y'])
                df_processed['trend'] = df['y'].values - df_processed['y'].values
        
        elif self.detrend_method == 'differencing':
            df_processed['y'] = df_processed['y'].diff().fillna(0)
            df_processed['trend'] = df['y'].values
        
        else:
            df_processed['y'] = signal.detrend(df_processed['y'])
            df_processed['trend'] = df['y'].values - df_processed['y'].values
        
        return df_processed
    
    def preprocess(self, file_path, date_column='ds', value_column='y'):
        df = self.load_csv(file_path, date_column, value_column)
        df = self.handle_missing_values(df)
        
        original_df = df.copy()
        df_detrend = self.detrend(df)
        
        return {
            'original': original_df,
            'processed': df_detrend,
            'missing_count': original_df['y'].isna().sum(),
            'total_count': len(original_df)
        }
