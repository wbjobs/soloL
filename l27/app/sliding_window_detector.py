import pandas as pd
import numpy as np
from prophet import Prophet
from sklearn.preprocessing import MinMaxScaler, StandardScaler
from config import Config


class SlidingWindowAnomalyDetector:
    def __init__(self, sigma_threshold=Config.SIGMA_THRESHOLD, 
                 min_window_size=14, max_window_size=60,
                 step_size=7, boundary_padding=5):
        self.sigma_threshold = sigma_threshold
        self.min_window_size = min_window_size
        self.max_window_size = max_window_size
        self.step_size = step_size
        self.boundary_padding = boundary_padding
        self.scaler = MinMaxScaler(feature_range=(0, 10))
        
    def _calculate_bic(self, model, df, forecast):
        n = len(df)
        residuals = df['y'].values - forecast['yhat'].values
        rss = np.sum(residuals ** 2)
        
        if rss == 0:
            return np.inf
        
        k = 0
        if model.yearly_seasonality:
            k += 10
        if model.weekly_seasonality:
            k += 6
        if model.daily_seasonality:
            k += 4
        k += 3
        
        bic = n * np.log(rss / n) + k * np.log(n)
        return bic
    
    def _optimize_window_size(self, df, candidate_windows=None):
        if candidate_windows is None:
            n = len(df)
            min_w = max(self.min_window_size, 14)
            max_w = min(self.max_window_size, n // 3)
            max_w = max(max_w, min_w + 7)
            candidate_windows = list(range(min_w, max_w + 1, 7))
        
        if len(candidate_windows) == 0:
            return self.min_window_size
        
        best_window = candidate_windows[0]
        best_bic = np.inf
        
        for window_size in candidate_windows:
            if window_size >= len(df):
                continue
                
            try:
                test_df = df.iloc[-window_size:].copy()
                if len(test_df) < 14:
                    continue
                    
                model = Prophet(
                    yearly_seasonality=True,
                    weekly_seasonality=True,
                    daily_seasonality=False,
                    interval_width=0.997
                )
                model.fit(test_df)
                
                future = model.make_future_dataframe(periods=0)
                forecast = model.predict(future)
                
                bic = self._calculate_bic(model, test_df, forecast)
                
                if bic < best_bic:
                    best_bic = bic
                    best_window = window_size
                    
            except Exception as e:
                continue
        
        return best_window
    
    def _detect_window(self, df_window):
        if len(df_window) < 14:
            return None
            
        try:
            model = Prophet(
                yearly_seasonality=True,
                weekly_seasonality=True,
                daily_seasonality=False,
                interval_width=0.997
            )
            model.fit(df_window)
            
            future = model.make_future_dataframe(periods=0)
            forecast = model.predict(future)
            
            merged = pd.merge(df_window, forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']], on='ds')
            
            residuals = merged['y'] - merged['yhat']
            residual_std = residuals.std()
            residual_mean = residuals.mean()
            
            if residual_std > 0:
                z_scores = np.abs((residuals - residual_mean) / residual_std)
            else:
                z_scores = np.zeros(len(residuals))
            
            merged['window_z_score'] = z_scores
            merged['window_anomaly'] = z_scores > self.sigma_threshold
            
            return merged
            
        except Exception as e:
            return None
    
    def sliding_window_detect(self, df):
        n = len(df)
        window_scores = np.zeros(n)
        vote_count = np.zeros(n)
        anomaly_votes = np.zeros(n)
        
        optimal_window = self._optimize_window_size(df)
        
        window_sizes = [optimal_window, max(optimal_window // 2, 14), min(optimal_window * 2, n // 2)]
        window_sizes = list(set([w for w in window_sizes if w >= 14 and w <= n]))
        
        all_window_results = []
        
        for window_size in window_sizes:
            for start in range(0, n - window_size + 1, max(self.step_size // 2, 1)):
                end = start + window_size
                df_window = df.iloc[start:end].copy()
                
                result = self._detect_window(df_window)
                if result is not None:
                    for i, idx in enumerate(range(start, end)):
                        window_scores[idx] += result['window_z_score'].iloc[i]
                        vote_count[idx] += 1
                        if result['window_anomaly'].iloc[i]:
                            anomaly_votes[idx] += 1
                    
                    all_window_results.append((start, end, result))
        
        avg_scores = np.divide(window_scores, vote_count, out=np.zeros_like(window_scores), where=vote_count > 0)
        
        self.scaler.fit(avg_scores.reshape(-1, 1))
        normalized_scores = self.scaler.transform(avg_scores.reshape(-1, 1)).flatten()
        
        return {
            'optimal_window_size': optimal_window,
            'window_sizes_used': window_sizes,
            'avg_z_scores': avg_scores,
            'normalized_scores': normalized_scores,
            'vote_count': vote_count,
            'anomaly_votes': anomaly_votes,
            'all_window_results': all_window_results
        }
    
    def boundary_enhanced_detect(self, df, prophet_forecast):
        n = len(df)
        
        base_detector = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=True,
            daily_seasonality=False,
            interval_width=0.997
        )
        base_detector.fit(df)
        base_forecast = base_detector.predict(base_detector.make_future_dataframe(periods=0))
        
        merged = pd.merge(df, base_forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']], on='ds')
        residuals = merged['y'] - merged['yhat']
        residual_std = residuals.std()
        residual_mean = residuals.mean()
        
        if residual_std > 0:
            merged['z_score'] = np.abs((residuals - residual_mean) / residual_std)
        else:
            merged['z_score'] = 0
        
        sliding_result = self.sliding_window_detect(df)
        
        merged['avg_window_z'] = sliding_result['avg_z_scores']
        merged['normalized_anomaly_score'] = sliding_result['normalized_scores']
        merged['anomaly_votes'] = sliding_result['anomaly_votes']
        merged['vote_count'] = sliding_result['vote_count']
        
        merged['vote_ratio'] = np.divide(
            merged['anomaly_votes'], 
            merged['vote_count'], 
            out=np.zeros(len(merged)), 
            where=merged['vote_count'] > 0
        )
        
        boundary_region = self.boundary_padding
        
        for i in range(n):
            is_boundary = (i < boundary_region) or (i >= n - boundary_region)
            
            base_anomaly = merged.loc[i, 'z_score'] > self.sigma_threshold
            window_anomaly = merged.loc[i, 'avg_window_z'] > self.sigma_threshold
            vote_anomaly = merged.loc[i, 'vote_ratio'] > 0.5
            
            if is_boundary:
                weight_base = 0.2
                weight_window = 0.5
                weight_vote = 0.3
                
                combined_score = (
                    weight_base * merged.loc[i, 'z_score'] +
                    weight_window * merged.loc[i, 'avg_window_z'] +
                    weight_vote * merged.loc[i, 'vote_ratio'] * 5
                )
                
                merged.loc[i, 'combined_anomaly_score'] = combined_score
                merged.loc[i, 'anomaly'] = window_anomaly or vote_anomaly or (combined_score > self.sigma_threshold)
                merged.loc[i, 'detection_method'] = 'boundary_enhanced'
            else:
                weight_base = 0.6
                weight_window = 0.3
                weight_vote = 0.1
                
                combined_score = (
                    weight_base * merged.loc[i, 'z_score'] +
                    weight_window * merged.loc[i, 'avg_window_z'] +
                    weight_vote * merged.loc[i, 'vote_ratio'] * 5
                )
                
                merged.loc[i, 'combined_anomaly_score'] = combined_score
                merged.loc[i, 'anomaly'] = base_anomaly or (window_anomaly and vote_anomaly)
                merged.loc[i, 'detection_method'] = 'standard'
        
        merged['anomaly_type'] = 'normal'
        merged.loc[merged['anomaly'] & (merged['y'] > merged['yhat']), 'anomaly_type'] = 'spike'
        merged.loc[merged['anomaly'] & (merged['y'] < merged['yhat']), 'anomaly_type'] = 'drop'
        
        return merged, sliding_result
