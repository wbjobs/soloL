import os
import json
import traceback
from celery_app import celery
from app.preprocessing import DataPreprocessor
from app.anomaly_detector import AnomalyDetector
from app.anomaly_classifier import AnomalyClassifier
from app.report_generator import ReportGenerator
from app.multi_metric_analyzer import MultiMetricAnalyzer
from config import Config


@celery.task(bind=True, name='anomaly_detection.detect_anomalies')
def detect_anomalies_task(self, file_path, filename, mode='single'):
    try:
        if mode == 'single':
            return _run_single_metric_detection(self, file_path, filename)
        else:
            return _run_multi_metric_detection(self, file_path, filename)


def _run_single_metric_detection(self, file_path, filename):
    self.update_state(state='PROGRESS', meta={'status': 'Preprocessing data...'})
    
    preprocessor = DataPreprocessor()
    preprocess_result = preprocessor.preprocess(file_path)
    
    self.update_state(state='PROGRESS', meta={'status': 'Optimizing sliding window parameters...'})
    
    detector = AnomalyDetector(use_sliding_window=True)
    
    self.update_state(state='PROGRESS', meta={'status': 'Running Prophet anomaly detection with sliding window...'})
    
    forecast = detector.fit_predict(preprocess_result['processed'])
    anomaly_df = detector.detect_anomalies(preprocess_result['processed'])
    anomaly_summary = detector.get_anomaly_summary(anomaly_df)
    
    self.update_state(state='PROGRESS', meta={'status': 'Comparing detection methods...'})
    
    try:
        comparison = detector.get_detection_comparison(preprocess_result['processed'])
        anomaly_summary['detection_comparison'] = comparison
    except Exception as comp_err:
        anomaly_summary['detection_comparison'] = {'error': str(comp_err)}
    
    self.update_state(state='PROGRESS', meta={'status': 'Classifying anomaly patterns...'})
    
    classifier = AnomalyClassifier()
    classified_df = classifier.classify_anomalies(anomaly_df)
    classification_summary = classifier.get_classification_summary(classified_df)
    
    self.update_state(state='PROGRESS', meta={'status': 'Generating PDF report...'})
    
    report_generator = ReportGenerator()
    report_path = report_generator.generate_report(
        self.request.id,
        preprocess_result,
        anomaly_summary,
        classification_summary,
        classified_df
    )
    
    results_csv_path = os.path.join(Config.RESULTS_FOLDER, f"results_{self.request.id}.csv")
    classified_df.to_csv(results_csv_path, index=False)
    
    return {
        'status': 'completed',
        'mode': 'single',
        'task_id': self.request.id,
        'filename': filename,
        'anomaly_summary': anomaly_summary,
        'classification_summary': classification_summary,
        'preprocess_stats': {
            'missing_count': preprocess_result['missing_count'],
            'total_count': preprocess_result['total_count']
        },
        'report_path': report_path,
        'results_csv_path': results_csv_path
    }


def _run_multi_metric_detection(self, file_paths, filenames):
    self.update_state(state='PROGRESS', meta={'status': 'Loading multi-metric data...'})
    
    analyzer = MultiMetricAnalyzer()
    
    self.update_state(state='PROGRESS', meta={'status': 'Calculating correlation matrix...'})
    
    analysis_result = analyzer.run_full_analysis(file_paths)
    
    self.update_state(state='PROGRESS', meta={'status': 'Detecting joint anomalies...'})
    
    self.update_state(state='PROGRESS', meta={'status': 'Generating network graph data...'})
    
    self.update_state(state='PROGRESS', meta={'status': 'Generating PDF report...'})
    
    report_generator = ReportGenerator()
    report_path = report_generator.generate_multi_metric_report(
        self.request.id,
        filenames,
        analysis_result
    )
    
    results_csv_path = os.path.join(Config.RESULTS_FOLDER, f"results_{self.request.id}.csv")
    analysis_result['df'].to_csv(results_csv_path, index=False)
    
    serializable_result = _make_serializable(analysis_result)
    
    return {
        'status': 'completed',
        'mode': 'multi',
        'task_id': self.request.id,
        'filenames': filenames,
        'multi_metric_analysis': serializable_result,
        'report_path': report_path,
        'results_csv_path': results_csv_path
    }


def _make_serializable(obj):
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_make_serializable(item) for item in obj]
    elif isinstance(obj, (int, float, str, bool, type(None))):
        return obj
    else:
        return str(obj)

