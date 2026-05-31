import pandas as pd
import numpy as np
from prophet import Prophet
from config import Config
from app.sliding_window_detector import SlidingWindowAnomalyDetector


class AnomalyDetector:
    def __init__(self, sigma_threshold=Config.SIGMA_THRESHOLD, use_sliding_window=True):
        self.sigma_threshold = sigma_threshold
        self.use_sliding_window = use_sliding_window
        self.model = None
        self.forecast = None
        self.sliding_detector = None
        self.sliding_result = None
    
    def fit_predict(self, df):
        self.model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True,
            daily_seasonality=False,
            interval_width=0.997
        )
        self.model.fit(df)
        
        future = self.model.make_future_dataframe(periods=0)
        self.forecast = self.model.predict(future)
        
        return self.forecast
    
    def detect_anomalies(self, df, forecast=None):
        if forecast is None:
            forecast = self.forecast
        
        if self.use_sliding_window:
            return self._detect_with_sliding_window(df, forecast)
        else:
            return self._detect_standard(df, forecast)
    
    def _detect_standard(self, df, forecast):
        merged = pd.merge(df, forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']], on='ds')
        
        residuals = merged['y'] - merged['yhat']
        residual_std = residuals.std()
        residual_mean = residuals.mean()
        
        merged['residual'] = residuals
        merged['z_score'] = np.abs((residuals - residual_mean) / residual_std) if residual_std > 0 else 0
        merged['anomaly'] = merged['z_score'] > self.sigma_threshold
        
        merged['anomaly_type'] = 'normal'
        merged.loc[merged['anomaly'] & (merged['y'] > merged['yhat']), 'anomaly_type'] = 'spike'
        merged.loc[merged['anomaly'] & (merged['y'] < merged['yhat']), 'anomaly_type'] = 'drop'
        
        merged['normalized_anomaly_score'] = self._normalize_scores(merged['z_score'].values)
        merged['detection_method'] = 'standard'
        merged['avg_window_z'] = merged['z_score']
        merged['vote_ratio'] = merged['anomaly'].astype(float)
        merged['combined_anomaly_score'] = merged['z_score']
        
        return merged
    
    def _detect_with_sliding_window(self, df, forecast):
        if self.sliding_detector is None:
            self.sliding_detector = SlidingWindowAnomalyDetector(
                sigma_threshold=self.sigma_threshold
            )
        
        merged, self.sliding_result = self.sliding_detector.boundary_enhanced_detect(df, forecast)
        merged['residual'] = merged['y'] - merged['yhat']
        
        return merged
    
    def _normalize_scores(self, scores):
        from sklearn.preprocessing import MinMaxScaler
        scaler = MinMaxScaler(feature_range=(0, 10))
        scores_reshaped = np.array(scores).reshape(-1, 1)
        normalized = scaler.fit_transform(scores_reshaped).flatten()
        return normalized
    
    def get_anomaly_summary(self, anomaly_df):
        total_anomalies = anomaly_df['anomaly'].sum()
        spike_count = (anomaly_df['anomaly_type'] == 'spike').sum()
        drop_count = (anomaly_df['anomaly_type'] == 'drop').sum()
        
        boundary_anomalies = anomaly_df[anomaly_df['detection_method'] == 'boundary_enhanced']
        boundary_anomaly_count = boundary_anomalies['anomaly'].sum()
        
        anomalies = anomaly_df[anomaly_df['anomaly']].copy()
        
        anomaly_columns = ['ds', 'y', 'yhat', 'z_score', 'avg_window_z', 'normalized_anomaly_score', 
                          'anomaly_type', 'detection_method', 'vote_ratio']
        available_columns = [col for col in anomaly_columns if col in anomalies.columns]
        anomalies = anomalies[available_columns]
        anomalies = anomalies.sort_values('normalized_anomaly_score' if 'normalized_anomaly_score' in anomalies.columns else 'z_score', ascending=False)
        
        summary = {
            'total_count': len(anomaly_df),
            'anomaly_count': int(total_anomalies),
            'spike_count': int(spike_count),
            'drop_count': int(drop_count),
            'anomaly_rate': float(total_anomalies / len(anomaly_df)) if len(anomaly_df) > 0 else 0,
            'boundary_anomaly_count': int(boundary_anomaly_count),
            'anomalies': anomalies.to_dict('records')
        }
        
        if self.sliding_result is not None:
            summary['sliding_window_info'] = {
                'optimal_window_size': int(self.sliding_result['optimal_window_size']),
                'window_sizes_used': [int(w) for w in self.sliding_result['window_sizes_used']]
            }
        
        return summary
    
    def get_detection_comparison(self, df):
        standard_detector = AnomalyDetector(
            sigma_threshold=self.sigma_threshold, 
            use_sliding_window=False
        )
        forecast = standard_detector.fit_predict(df)
        standard_results = standard_detector.detect_anomalies(df, forecast)
        
        enhanced_results = self.detect_anomalies(df, forecast)
        
        comparison = {
            'standard': {
                'anomaly_count': int(standard_results['anomaly'].sum()),
                'boundary_anomalies': int(standard_results.iloc[-5:]['anomaly'].sum())
            },
            'enhanced': {
                'anomaly_count': int(enhanced_results['anomaly'].sum()),
                'boundary_anomalies': int(enhanced_results.iloc[-5:]['anomaly'].sum())
            }
        }
        
        return comparison
