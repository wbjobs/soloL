import pandas as pd
import numpy as np
from scipy import stats
from sklearn.preprocessing import StandardScaler
from sklearn.covariance import MinCovDet, EmpiricalCovariance
from sklearn.decomposition import PCA
import warnings
warnings.filterwarnings('ignore')


class MultiMetricAnalyzer:
    def __init__(self, correlation_threshold=0.3, anomaly_alpha=0.01):
        self.correlation_threshold = correlation_threshold
        self.anomaly_alpha = anomaly_alpha
        self.metric_names = []
        self.correlation_matrix = None
        self.covariance_matrix = None
        self.mean_vector = None
        self.anomaly_scores = None
        
    def load_multi_metric_data(self, file_paths, date_column='ds'):
        all_data = {}
        self.metric_names = []
        
        for file_path in file_paths:
            metric_name = file_path.split('/')[-1].split('\\')[-1].replace('.csv', '')
            self.metric_names.append(metric_name)
            
            df = pd.read_csv(file_path)
            
            if date_column not in df.columns:
                date_col = df.select_dtypes(include=['object', 'datetime64']).columns[0]
                df = df.rename(columns={date_col: 'ds'})
            else:
                df = df.rename(columns={date_column: 'ds'})
            
            numeric_cols = df.select_dtypes(include=[np.number]).columns
            if len(numeric_cols) > 0:
                df = df.rename(columns={numeric_cols[0]: f'value_{metric_name}'})
            
            df['ds'] = pd.to_datetime(df['ds'])
            all_data[metric_name] = df[['ds', f'value_{metric_name}']]
        
        merged_df = all_data[self.metric_names[0]]
        for metric in self.metric_names[1:]:
            merged_df = pd.merge(merged_df, all_data[metric], on='ds', how='outer')
        
        merged_df = merged_df.sort_values('ds').reset_index(drop=True)
        
        for metric in self.metric_names:
            col = f'value_{metric}'
            merged_df[col] = merged_df[col].interpolate(method='linear', limit_direction='both')
            if merged_df[col].isna().any():
                merged_df[col] = merged_df[col].fillna(merged_df[col].mean())
        
        return merged_df
    
    def calculate_correlation_matrix(self, df):
        value_cols = [f'value_{m}' for m in self.metric_names]
        values_df = df[value_cols].copy()
        
        self.correlation_matrix = values_df.corr(method='pearson')
        
        p_values = pd.DataFrame(np.ones_like(self.correlation_matrix), 
                                index=self.correlation_matrix.index,
                                columns=self.correlation_matrix.columns)
        
        for i in range(len(self.metric_names)):
            for j in range(i+1, len(self.metric_names)):
                corr, p_val = stats.pearsonr(
                    values_df.iloc[:, i].dropna(), 
                    values_df.iloc[:, j].dropna()
                )
                p_values.iloc[i, j] = p_val
                p_values.iloc[j, i] = p_val
        
        return {
            'correlation_matrix': self.correlation_matrix.to_dict(),
            'p_values': p_values.to_dict(),
            'metric_names': self.metric_names,
            'significant_correlations': self._get_significant_correlations()
        }
    
    def _get_significant_correlations(self):
        correlations = []
        for i, m1 in enumerate(self.metric_names):
            for j, m2 in enumerate(self.metric_names):
                if i < j:
                    corr = self.correlation_matrix.iloc[i, j]
                    if abs(corr) >= self.correlation_threshold:
                        correlations.append({
                            'source': m1,
                            'target': m2,
                            'correlation': float(corr),
                            'strength': 'strong' if abs(corr) > 0.7 else 'medium' if abs(corr) > 0.5 else 'weak'
                        })
        return correlations
    
    def fit_covariance_model(self, df):
        value_cols = [f'value_{m}' for m in self.metric_names]
        values = df[value_cols].values
        
        scaler = StandardScaler()
        values_scaled = scaler.fit_transform(values)
        
        self.mean_vector = np.mean(values_scaled, axis=0)
        
        try:
            mcd = MinCovDet(random_state=42)
            mcd.fit(values_scaled)
            self.covariance_matrix = mcd.covariance_
            self.location = mcd.location_
            self.cov_method = 'robust'
        except:
            emp_cov = EmpiricalCovariance()
            emp_cov.fit(values_scaled)
            self.covariance_matrix = emp_cov.covariance_
            self.location = emp_cov.location_
            self.cov_method = 'empirical'
        
        self.scaler = scaler
        return self.covariance_matrix
    
    def calculate_mahalanobis_distance(self, df):
        value_cols = [f'value_{m}' for m in self.metric_names]
        values = df[value_cols].values
        
        values_scaled = self.scaler.transform(values)
        
        centered = values_scaled - self.location
        inv_cov = np.linalg.inv(self.covariance_matrix + np.eye(len(self.metric_names)) * 1e-6)
        
        mahalanobis = np.sqrt(np.sum(centered @ inv_cov * centered, axis=1))
        
        return mahalanobis
    
    def detect_joint_anomalies(self, df):
        mahalanobis = self.calculate_mahalanobis_distance(df)
        
        df = df.copy()
        df['mahalanobis_distance'] = mahalanobis
        
        threshold = stats.chi2.ppf(1 - self.anomaly_alpha, df=len(self.metric_names))
        threshold = np.sqrt(threshold)
        
        df['joint_anomaly'] = mahalanobis > threshold
        
        single_metric_anomalies = self._detect_single_metric_anomalies(df)
        
        expected_values = self._calculate_expected_values(df)
        
        anomaly_details = []
        for idx, row in df[df['joint_anomaly']].iterrows():
            deviation = self._analyze_anomaly_contribution(idx, row, df, expected_values)
            anomaly_details.append({
                'timestamp': row['ds'].isoformat(),
                'mahalanobis_distance': float(row['mahalanobis_distance']),
                'root_cause_metric': deviation['root_cause'],
                'contributions': deviation['contributions'],
                'anomaly_type': deviation['type'],
                'expected_vs_actual': deviation['expected_vs_actual']
            })
        
        return {
            'df': df,
            'mahalanobis_threshold': float(threshold),
            'joint_anomaly_count': int(df['joint_anomaly'].sum()),
            'anomaly_details': anomaly_details,
            'single_metric_anomalies': single_metric_anomalies
        }
    
    def _detect_single_metric_anomalies(self, df):
        anomalies = {}
        for metric in self.metric_names:
            col = f'value_{metric}'
            values = df[col].values
            
            mean_val = np.mean(values)
            std_val = np.std(values)
            if std_val > 0:
                z_scores = np.abs((values - mean_val) / std_val)
                anomalies[metric] = {
                    'anomaly_indices': df[z_scores > 3].index.tolist(),
                    'anomaly_count': int((z_scores > 3).sum())
                }
            else:
                anomalies[metric] = {'anomaly_indices': [], 'anomaly_count': 0}
        
        return anomalies
    
    def _calculate_expected_values(self, df):
        expected = {}
        
        for i, m1 in enumerate(self.metric_names):
            col1 = f'value_{m1}'
            expected[m1] = {}
            
            for j, m2 in enumerate(self.metric_names):
                if i != j and abs(self.correlation_matrix.iloc[i, j]) > self.correlation_threshold:
                    col2 = f'value_{m2}'
                    
                    x = df[col2].values
                    y = df[col1].values
                    
                    slope, intercept, r_value, p_value, std_err = stats.linregress(x, y)
                    
                    expected_vals = intercept + slope * x
                    expected[m1][m2] = {
                        'slope': float(slope),
                        'intercept': float(intercept),
                        'r_squared': float(r_value ** 2),
                        'values': expected_vals
                    }
        
        return expected
    
    def _analyze_anomaly_contribution(self, idx, row, df, expected_values):
        contributions = {}
        deviations = {}
        
        for metric in self.metric_names:
            col = f'value_{metric}'
            actual_val = row[col]
            
            related_expected = []
            for related_metric, exp_info in expected_values.get(metric, {}).items():
                expected_val = exp_info['values'][idx]
                deviation_pct = (actual_val - expected_val) / (abs(expected_val) + 1e-8) * 100
                related_expected.append({
                    'related_to': related_metric,
                    'expected': float(expected_val),
                    'actual': float(actual_val),
                    'deviation_pct': float(deviation_pct)
                })
            
            if related_expected:
                avg_deviation = np.mean([abs(x['deviation_pct']) for x in related_expected])
                contributions[metric] = float(avg_deviation)
                deviations[metric] = related_expected
        
        root_cause = max(contributions, key=contributions.get) if contributions else self.metric_names[0]
        
        anomaly_type = self._classify_anomaly_type(idx, row, df, expected_values)
        
        expected_vs_actual = []
        for metric in self.metric_names:
            col = f'value_{metric}'
            actual = float(row[col])
            
            if metric in expected_values and expected_values[metric]:
                first_related = list(expected_values[metric].keys())[0]
                expected = float(expected_values[metric][first_related]['values'][idx])
                expected_vs_actual.append({
                    'metric': metric,
                    'expected': expected,
                    'actual': actual,
                    'deviation': float(actual - expected)
                })
            else:
                mean_val = float(df[f'value_{metric}'].mean())
                expected_vs_actual.append({
                    'metric': metric,
                    'expected': mean_val,
                    'actual': actual,
                    'deviation': float(actual - mean_val)
                })
        
        return {
            'root_cause': root_cause,
            'contributions': {k: round(v, 2) for k, v in contributions.items()},
            'type': anomaly_type,
            'expected_vs_actual': expected_vs_actual
        }
    
    def _classify_anomaly_type(self, idx, row, df, expected_values):
        metric_status = {}
        
        for metric in self.metric_names:
            col = f'value_{metric}'
            actual = row[col]
            mean_val = df[col].mean()
            std_val = df[col].std()
            
            if std_val > 0:
                z_score = (actual - mean_val) / std_val
                if z_score > 2:
                    metric_status[metric] = 'high'
                elif z_score < -2:
                    metric_status[metric] = 'low'
                else:
                    metric_status[metric] = 'normal'
            else:
                metric_status[metric] = 'normal'
        
        high_metrics = [m for m, s in metric_status.items() if s == 'high']
        low_metrics = [m for m, s in metric_status.items() if s == 'low']
        
        if len(high_metrics) > 0 and len(low_metrics) > 0:
            return f"contradictory: {'+'.join(high_metrics)} high, {'+'.join(low_metrics)} low"
        elif len(high_metrics) > 1:
            return f"concurrent_high: {'+'.join(high_metrics)}"
        elif len(low_metrics) > 1:
            return f"concurrent_low: {'+'.join(low_metrics)}"
        elif len(high_metrics) == 1:
            return f"single_high: {high_metrics[0]}"
        elif len(low_metrics) == 1:
            return f"single_low: {low_metrics[0]}"
        else:
            return "multivariate: covariance structure anomaly"
    
    def generate_network_graph_data(self, df, joint_anomalies):
        nodes = []
        for metric in self.metric_names:
            col = f'value_{metric}'
            anomaly_count = int(np.sum(np.abs(stats.zscore(df[col])) > 3))
            nodes.append({
                'id': metric,
                'name': metric,
                'value': float(df[col].mean()),
                'anomaly_count': anomaly_count,
                'size': 20 + anomaly_count * 2
            })
        
        links = []
        for corr in self._get_significant_correlations():
            links.append({
                'source': corr['source'],
                'target': corr['target'],
                'value': abs(corr['correlation']),
                'correlation': corr['correlation'],
                'strength': corr['strength'],
                'color': '#27ae60' if corr['correlation'] > 0 else '#e74c3c'
            })
        
        anomaly_nodes = set()
        anomaly_links = []
        
        for anomaly in joint_anomalies:
            root_cause = anomaly['root_cause_metric']
            anomaly_nodes.add(root_cause)
            
            for contrib_metric, contrib_score in anomaly['contributions'].items():
                if contrib_metric != root_cause and contrib_score > 10:
                    anomaly_links.append({
                        'source': root_cause,
                        'target': contrib_metric,
                        'timestamp': anomaly['timestamp'],
                        'contribution': contrib_score,
                        'anomaly_type': anomaly['anomaly_type']
                    })
        
        return {
            'nodes': nodes,
            'links': links,
            'anomaly_nodes': list(anomaly_nodes),
            'anomaly_links': anomaly_links,
            'metric_names': self.metric_names
        }
    
    def run_full_analysis(self, file_paths):
        df = self.load_multi_metric_data(file_paths)
        
        corr_result = self.calculate_correlation_matrix(df)
        
        self.fit_covariance_model(df)
        
        anomaly_result = self.detect_joint_anomalies(df)
        
        network_data = self.generate_network_graph_data(
            anomaly_result['df'], 
            anomaly_result['anomaly_details']
        )
        
        return {
            'df': anomaly_result['df'],
            'correlation_analysis': corr_result,
            'joint_anomalies': anomaly_result,
            'network_graph': network_data,
            'covariance_method': self.cov_method
        }
