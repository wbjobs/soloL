import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings
warnings.filterwarnings('ignore')

from app.preprocessing import DataPreprocessor
from app.anomaly_detector import AnomalyDetector
from app.anomaly_classifier import AnomalyClassifier


def generate_boundary_test_data(days=100, anomaly_start=90, anomaly_length=8):
    start_date = datetime(2024, 1, 1)
    dates = [start_date + timedelta(days=i) for i in range(days)]
    
    base_value = 100
    trend = np.linspace(0, 30, days)
    weekly_seasonality = 8 * np.sin(2 * np.pi * np.arange(days) / 7)
    noise = np.random.normal(0, 3, days)
    
    values = base_value + trend + weekly_seasonality + noise
    
    anomaly_end = min(anomaly_start + anomaly_length, days)
    ground_truth = np.zeros(days, dtype=bool)
    
    for i in range(anomaly_start, anomaly_end):
        if i < days:
            values[i] += 25 + np.random.normal(0, 3)
            ground_truth[i] = True
    
    df = pd.DataFrame({
        'ds': dates,
        'y': values,
        'ground_truth': ground_truth
    })
    
    return df


def calculate_metrics(ground_truth, predictions):
    tp = np.sum((ground_truth == 1) & (predictions == 1))
    fp = np.sum((ground_truth == 0) & (predictions == 1))
    fn = np.sum((ground_truth == 1) & (predictions == 0))
    tn = np.sum((ground_truth == 0) & (predictions == 0))
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    
    return {
        'tp': int(tp),
        'fp': int(fp),
        'fn': int(fn),
        'tn': int(tn),
        'precision': precision,
        'recall': recall,
        'f1': f1
    }


def run_boundary_detection_test():
    print("=" * 80)
    print("边界集体异常检测性能测试")
    print("=" * 80)
    print()
    
    np.random.seed(42)
    
    test_configs = [
        {'name': '末尾集体异常 (8个点)', 'anomaly_start': 92, 'anomaly_length': 8},
        {'name': '末尾集体异常 (5个点)', 'anomaly_start': 95, 'anomaly_length': 5},
        {'name': '末尾集体异常 (10个点)', 'anomaly_start': 90, 'anomaly_length': 10},
        {'name': '开头集体异常 (8个点)', 'anomaly_start': 0, 'anomaly_length': 8},
    ]
    
    all_results = []
    
    for config in test_configs:
        print(f"\n{'─' * 80}")
        print(f"测试场景: {config['name']}")
        print(f"{'─' * 80}")
        
        df = generate_boundary_test_data(
            days=100, 
            anomaly_start=config['anomaly_start'], 
            anomaly_length=config['anomaly_length']
        )
        
        ground_truth = df['ground_truth'].values
        
        print(f"数据点数: {len(df)}")
        print(f"注入异常位置: {config['anomaly_start']}-{config['anomaly_start']+config['anomaly_length']-1}")
        print(f"真实异常点数量: {np.sum(ground_truth)}")
        print()
        
        preprocessor = DataPreprocessor()
        
        temp_file = 'temp_test_data.csv'
        df[['ds', 'y']].to_csv(temp_file, index=False)
        
        preprocess_result = preprocessor.preprocess(temp_file)
        processed_df = preprocess_result['processed']
        
        print("1. 标准Prophet + 3-Sigma检测:")
        print("-" * 40)
        standard_detector = AnomalyDetector(use_sliding_window=False)
        forecast_std = standard_detector.fit_predict(processed_df)
        result_std = standard_detector.detect_anomalies(processed_df, forecast_std)
        
        boundary_region = config['anomaly_start']
        boundary_gt = ground_truth[boundary_region:]
        boundary_pred_std = result_std['anomaly'].values[boundary_region:]
        
        metrics_std_all = calculate_metrics(ground_truth, result_std['anomaly'].values)
        metrics_std_boundary = calculate_metrics(boundary_gt, boundary_pred_std)
        
        print(f"  全局召回率: {metrics_std_all['recall']:.2%}")
        print(f"  边界区域召回率: {metrics_std_boundary['recall']:.2%}")
        print(f"  边界检测到异常: {metrics_std_boundary['tp']}/{metrics_std_boundary['tp'] + metrics_std_boundary['fn']}")
        print()
        
        print("2. 滑动窗口增强检测:")
        print("-" * 40)
        enhanced_detector = AnomalyDetector(use_sliding_window=True)
        forecast_enh = enhanced_detector.fit_predict(processed_df)
        result_enh = enhanced_detector.detect_anomalies(processed_df, forecast_enh)
        
        boundary_pred_enh = result_enh['anomaly'].values[boundary_region:]
        
        metrics_enh_all = calculate_metrics(ground_truth, result_enh['anomaly'].values)
        metrics_enh_boundary = calculate_metrics(boundary_gt, boundary_pred_enh)
        
        print(f"  全局召回率: {metrics_enh_all['recall']:.2%}")
        print(f"  边界区域召回率: {metrics_enh_boundary['recall']:.2%}")
        print(f"  边界检测到异常: {metrics_enh_boundary['tp']}/{metrics_enh_boundary['tp'] + metrics_enh_boundary['fn']}")
        print()
        
        if 'sliding_window_info' in enhanced_detector.get_anomaly_summary(result_enh):
            sliding_info = enhanced_detector.get_anomaly_summary(result_enh)['sliding_window_info']
            print(f"  BIC最优窗口大小: {sliding_info['optimal_window_size']}天")
        
        print()
        print("3. 性能对比:")
        print("-" * 40)
        
        boundary_improvement = (metrics_enh_boundary['recall'] - metrics_std_boundary['recall']) * 100
        
        comparison_data = [
            ['指标', '标准方法', '增强方法', '提升'],
            ['全局召回率', f"{metrics_std_all['recall']:.2%}", f"{metrics_enh_all['recall']:.2%}", 
             f"+{(metrics_enh_all['recall'] - metrics_std_all['recall'])*100:.1f}%"],
            ['边界召回率', f"{metrics_std_boundary['recall']:.2%}", f"{metrics_enh_boundary['recall']:.2%}", 
             f"+{boundary_improvement:.1f}%"],
            ['边界检测数', f"{metrics_std_boundary['tp']}", f"{metrics_enh_boundary['tp']}", 
             f"+{metrics_enh_boundary['tp'] - metrics_std_boundary['tp']}"],
        ]
        
        for row in comparison_data:
            print(f"  {row[0]:<15} {row[1]:<15} {row[2]:<15} {row[3]:<15}")
        
        all_results.append({
            'config': config,
            'standard': metrics_std_boundary,
            'enhanced': metrics_enh_boundary,
            'boundary_improvement': boundary_improvement
        })
        
        import os
        if os.path.exists(temp_file):
            os.remove(temp_file)
    
    print("\n" + "=" * 80)
    print("测试总结")
    print("=" * 80)
    
    avg_std_recall = np.mean([r['standard']['recall'] for r in all_results])
    avg_enh_recall = np.mean([r['enhanced']['recall'] for r in all_results])
    avg_improvement = np.mean([r['boundary_improvement'] for r in all_results])
    
    print(f"\n平均边界区域召回率:")
    print(f"  标准方法: {avg_std_recall:.2%}")
    print(f"  增强方法: {avg_enh_recall:.2%}")
    print(f"  平均提升: {avg_improvement:.1f}%")
    print()
    
    if avg_enh_recall >= 0.8:
        print("✅ 边界异常检测率达到80%以上目标！")
    else:
        print(f"⚠️  边界检测率 {avg_enh_recall:.2%}，需进一步优化")
    
    print()
    
    return all_results


def run_ablation_study():
    print("\n" + "=" * 80)
    print("消融实验：各组件贡献分析")
    print("=" * 80)
    print()
    
    np.random.seed(42)
    df = generate_boundary_test_data(days=100, anomaly_start=92, anomaly_length=8)
    ground_truth = df['ground_truth'].values
    
    preprocessor = DataPreprocessor()
    temp_file = 'temp_ablation.csv'
    df[['ds', 'y']].to_csv(temp_file, index=False)
    preprocess_result = preprocessor.preprocess(temp_file)
    processed_df = preprocess_result['processed']
    
    from app.sliding_window_detector import SlidingWindowAnomalyDetector
    
    base_detector = AnomalyDetector(use_sliding_window=False)
    forecast = base_detector.fit_predict(processed_df)
    base_result = base_detector.detect_anomalies(processed_df, forecast)
    
    sliding_detector = SlidingWindowAnomalyDetector()
    merged, sliding_result = sliding_detector.boundary_enhanced_detect(processed_df, forecast)
    
    boundary_start = 92
    
    print("各检测信号边界区域表现:")
    print("-" * 60)
    
    signals = [
        ('基础Prophet Z-Score', base_result['z_score'].values > 3),
        ('滑动窗口平均Z', merged['avg_window_z'].values > 3),
        ('投票机制(>50%)', merged['vote_ratio'].values > 0.5),
        ('加权融合(边界)', (merged['detection_method'] == 'boundary_enhanced') & merged['anomaly']),
        ('最终结果', merged['anomaly'].values),
    ]
    
    for name, pred in signals:
        metrics = calculate_metrics(ground_truth[boundary_start:], pred[boundary_start:])
        print(f"  {name:<25} 召回率: {metrics['recall']:.2%}  TP: {metrics['tp']}/{len(ground_truth[boundary_start:])}")
    
    print()
    print(f"最优窗口大小 (BIC): {sliding_result['optimal_window_size']}天")
    print(f"使用的窗口尺度: {sliding_result['window_sizes_used']}天")
    print()
    
    import os
    if os.path.exists(temp_file):
        os.remove(temp_file)


if __name__ == '__main__':
    results = run_boundary_detection_test()
    run_ablation_study()
    
    print("\n" + "=" * 80)
    print("测试完成")
    print("=" * 80)
