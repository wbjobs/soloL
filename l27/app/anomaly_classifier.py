import pandas as pd
import numpy as np
from collections import defaultdict


class AnomalyClassifier:
    def __init__(self, collective_window=5, collective_threshold=3):
        self.collective_window = collective_window
        self.collective_threshold = collective_threshold
    
    def classify_anomalies(self, anomaly_df):
        df = anomaly_df.copy()
        
        df['pattern_class'] = 'normal'
        
        df = self._classify_point_anomalies(df)
        df = self._classify_contextual_anomalies(df)
        df = self._classify_collective_anomalies(df)
        
        return df
    
    def _classify_point_anomalies(self, df):
        anomaly_indices = df[df['anomaly']].index
        
        for idx in anomaly_indices:
            left_neighbor = idx - 1 if idx > 0 else None
            right_neighbor = idx + 1 if idx < len(df) - 1 else None
            
            left_anomaly = df.loc[left_neighbor, 'anomaly'] if left_neighbor is not None else False
            right_anomaly = df.loc[right_neighbor, 'anomaly'] if right_neighbor is not None else False
            
            if not left_anomaly and not right_anomaly:
                df.loc[idx, 'pattern_class'] = 'point_anomaly'
        
        return df
    
    def _classify_contextual_anomalies(self, df):
        df['hour'] = df['ds'].dt.hour
        df['day_of_week'] = df['ds'].dt.dayofweek
        df['month'] = df['ds'].dt.month
        
        point_anomalies = df[df['pattern_class'] == 'point_anomaly'].index
        
        for idx in point_anomalies:
            row = df.loc[idx]
            hour = row['hour']
            day_of_week = row['day_of_week']
            
            context_mask = (df['hour'] == hour) & (df['day_of_week'] == day_of_week) & (~df['anomaly'])
            context_values = df[context_mask]['y']
            
            if len(context_values) > 5:
                context_mean = context_values.mean()
                context_std = context_values.std()
                
                if context_std > 0:
                    z_context = np.abs((row['y'] - context_mean) / context_std)
                    if z_context > 2:
                        df.loc[idx, 'pattern_class'] = 'contextual_anomaly'
                        df.loc[idx, 'context_score'] = z_context
        
        return df
    
    def _classify_collective_anomalies(self, df):
        anomaly_flags = df['anomaly'].astype(int).values
        n = len(anomaly_flags)
        
        collective_regions = []
        current_start = None
        
        for i in range(n):
            if anomaly_flags[i] == 1:
                if current_start is None:
                    current_start = i
            else:
                if current_start is not None:
                    window_size = i - current_start
                    if window_size >= self.collective_threshold:
                        collective_regions.append((current_start, i - 1))
                    current_start = None
        
        if current_start is not None:
            window_size = n - current_start
            if window_size >= self.collective_threshold:
                collective_regions.append((current_start, n - 1))
        
        for start, end in collective_regions:
            df.loc[start:end, 'pattern_class'] = 'collective_anomaly'
            df.loc[start:end, 'collective_region'] = f"{start}-{end}"
        
        return df
    
    def get_classification_summary(self, classified_df):
        summary = defaultdict(int)
        
        for pattern in classified_df['pattern_class']:
            summary[pattern] += 1
        
        point_anomalies = classified_df[classified_df['pattern_class'] == 'point_anomaly']
        contextual_anomalies = classified_df[classified_df['pattern_class'] == 'contextual_anomaly']
        collective_anomalies = classified_df[classified_df['pattern_class'] == 'collective_anomaly']
        
        collective_regions = collective_anomalies['collective_region'].nunique() if 'collective_region' in collective_anomalies.columns else 0
        
        return {
            'point_anomaly_count': int(summary.get('point_anomaly', 0)),
            'contextual_anomaly_count': int(summary.get('contextual_anomaly', 0)),
            'collective_anomaly_count': int(summary.get('collective_anomaly', 0)),
            'collective_region_count': int(collective_regions),
            'normal_count': int(summary.get('normal', 0)),
            'details': {
                'point_anomalies': self._get_anomaly_details(point_anomalies),
                'contextual_anomalies': self._get_anomaly_details(contextual_anomalies),
                'collective_anomalies': self._get_collective_details(collective_anomalies)
            }
        }
    
    def _get_anomaly_details(self, df):
        if len(df) == 0:
            return []
        
        return df[['ds', 'y', 'yhat', 'z_score', 'anomaly_type']].to_dict('records')
    
    def _get_collective_details(self, df):
        if len(df) == 0:
            return []
        
        regions = df.groupby('collective_region')
        result = []
        
        for region_id, group in regions:
            result.append({
                'region_id': region_id,
                'start_time': group['ds'].min().isoformat(),
                'end_time': group['ds'].max().isoformat(),
                'duration_points': len(group),
                'avg_z_score': group['z_score'].mean(),
                'max_z_score': group['z_score'].max()
            })
        
        return result
