import os
from datetime import datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from config import Config


class ReportGenerator:
    def __init__(self):
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()
    
    def _setup_custom_styles(self):
        self.styles.add(ParagraphStyle(
            'CustomTitle',
            parent=self.styles['Title'],
            fontSize=24,
            spaceAfter=30,
            alignment=TA_CENTER,
            textColor=colors.HexColor('#2c3e50')
        ))
        
        self.styles.add(ParagraphStyle(
            'SectionHeader',
            parent=self.styles['Heading1'],
            fontSize=16,
            spaceAfter=12,
            spaceBefore=20,
            textColor=colors.HexColor('#3498db')
        ))
        
        self.styles.add(ParagraphStyle(
            'SubHeader',
            parent=self.styles['Heading2'],
            fontSize=13,
            spaceAfter=8,
            textColor=colors.HexColor('#2c3e50')
        ))
        
        self.styles.add(ParagraphStyle(
            'CustomBody',
            parent=self.styles['BodyText'],
            fontSize=10,
            leading=14,
            spaceAfter=6
        ))
    
    def _create_time_series_plot(self, df, classified_df, plot_path):
        fig, axes = plt.subplots(2, 1, figsize=(10, 8))
        
        ax1 = axes[0]
        ax1.plot(df['ds'], df['y'], label='Original Data', color='#3498db', linewidth=1)
        
        anomalies = classified_df[classified_df['anomaly']]
        ax1.scatter(anomalies['ds'], anomalies['y'], color='red', s=50, zorder=5, label='Anomalies')
        
        ax1.set_title('Time Series with Anomalies Detected', fontsize=12, fontweight='bold')
        ax1.set_xlabel('Time')
        ax1.set_ylabel('Value')
        ax1.legend()
        ax1.grid(True, alpha=0.3)
        
        ax2 = axes[1]
        pattern_colors = {
            'point_anomaly': '#e74c3c',
            'contextual_anomaly': '#f39c12',
            'collective_anomaly': '#9b59b6',
            'normal': '#3498db'
        }
        
        for pattern, color in pattern_colors.items():
            mask = classified_df['pattern_class'] == pattern
            if mask.any():
                ax2.scatter(classified_df.loc[mask, 'ds'], 
                           classified_df.loc[mask, 'y'], 
                           color=color, 
                           s=30 if pattern == 'normal' else 60,
                           label=pattern.replace('_', ' ').title(),
                           zorder=5 if pattern != 'normal' else 1)
        
        ax2.set_title('Anomaly Pattern Classification', fontsize=12, fontweight='bold')
        ax2.set_xlabel('Time')
        ax2.set_ylabel('Value')
        ax2.legend()
        ax2.grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(plot_path, dpi=100, bbox_inches='tight')
        plt.close()
    
    def generate_report(self, task_id, preprocess_result, anomaly_summary, classification_summary, classified_df):
        report_filename = f"anomaly_report_{task_id}.pdf"
        report_path = os.path.join(Config.REPORTS_FOLDER, report_filename)
        plot_filename = f"plot_{task_id}.png"
        plot_path = os.path.join(Config.REPORTS_FOLDER, plot_filename)
        
        self._create_time_series_plot(preprocess_result['original'], classified_df, plot_path)
        
        doc = SimpleDocTemplate(
            report_path,
            pagesize=A4,
            rightMargin=40,
            leftMargin=40,
            topMargin=40,
            bottomMargin=40
        )
        
        story = []
        
        story.append(Paragraph("Time Series Anomaly Detection Report", self.styles['CustomTitle']))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph(f"Report Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", self.styles['CustomBody']))
        story.append(Paragraph(f"Task ID: {task_id}", self.styles['CustomBody']))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("1. Executive Summary", self.styles['SectionHeader']))
        
        summary_data = [
            ['Metric', 'Value'],
            ['Total Data Points', str(anomaly_summary['total_count'])],
            ['Anomalies Detected', str(anomaly_summary['anomaly_count'])],
            ['Anomaly Rate', f"{anomaly_summary['anomaly_rate'] * 100:.2f}%"],
            ['Spike Anomalies', str(anomaly_summary['spike_count'])],
            ['Drop Anomalies', str(anomaly_summary['drop_count'])],
        ]
        
        if 'boundary_anomaly_count' in anomaly_summary:
            summary_data.append(['Boundary Anomalies', str(anomaly_summary['boundary_anomaly_count'])])
        
        summary_table = Table(summary_data, colWidths=[3*inch, 2*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3498db')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f9fa')),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#dee2e6')),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("2. Detection Method Enhancement", self.styles['SectionHeader']))
        
        sliding_info = anomaly_summary.get('sliding_window_info', {})
        comparison = anomaly_summary.get('detection_comparison', {})
        
        if sliding_info:
            story.append(Paragraph("<b>Sliding Window Parameters:</b>", self.styles['CustomBody']))
            story.append(Paragraph(f"Optimal Window Size (BIC optimized): {sliding_info.get('optimal_window_size', 'N/A')} days", self.styles['CustomBody']))
            story.append(Paragraph(f"Window Sizes Evaluated: {', '.join(map(str, sliding_info.get('window_sizes_used', [])))} days", self.styles['CustomBody']))
            story.append(Paragraph(f"Score Normalization: Min-Max scaling to [0, 10] range", self.styles['CustomBody']))
            story.append(Spacer(1, 10))
        
        if comparison and 'standard' in comparison and 'enhanced' in comparison:
            story.append(Paragraph("<b>Detection Performance Comparison:</b>", self.styles['CustomBody']))
            comp_data = [
                ['Metric', 'Standard Method', 'Enhanced Method'],
                ['Total Anomalies', 
                 str(comparison['standard']['anomaly_count']), 
                 str(comparison['enhanced']['anomaly_count'])],
                ['Boundary Anomalies (Last 5)', 
                 str(comparison['standard']['boundary_anomalies']), 
                 str(comparison['enhanced']['boundary_anomalies'])],
            ]
            comp_table = Table(comp_data, colWidths=[2*inch, 1.5*inch, 1.5*inch])
            comp_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#27ae60')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f0fff4')),
                ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#a9dfbf')),
            ]))
            story.append(comp_table)
            story.append(Spacer(1, 5))
            
            improvement = comparison['enhanced']['boundary_anomalies'] - comparison['standard']['boundary_anomalies']
            if improvement > 0:
                story.append(Paragraph(
                    f"<font color='#27ae60'><b>✓ Improvement: {improvement} additional boundary anomalies detected by sliding window enhancement</b></font>",
                    self.styles['CustomBody']
                ))
            story.append(Spacer(1, 15))
        
        story.append(Paragraph("<b>Detection Methods Used:</b>", self.styles['CustomBody']))
        story.append(Paragraph("• <b>Standard Method:</b> Prophet prediction with global 3-sigma rule (weights: 60%)", self.styles['CustomBody']))
        story.append(Paragraph("• <b>Sliding Window:</b> Multi-scale window detection with BIC optimization (weights: 30%)", self.styles['CustomBody']))
        story.append(Paragraph("• <b>Voting System:</b> Consensus across multiple overlapping windows (weights: 10%)", self.styles['CustomBody']))
        story.append(Paragraph("• <b>Boundary Enhancement:</b> Adaptive weighting for sequence edges (higher window/vote weights)", self.styles['CustomBody']))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("3. Data Preprocessing", self.styles['SectionHeader']))
        story.append(Paragraph(f"Missing values handled: {preprocess_result['missing_count']}", self.styles['CustomBody']))
        story.append(Paragraph(f"Interpolation method: Linear", self.styles['CustomBody']))
        story.append(Paragraph(f"Detrending method: Seasonal Decomposition", self.styles['CustomBody']))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("4. Anomaly Pattern Classification", self.styles['SectionHeader']))
        
        pattern_data = [
            ['Pattern Type', 'Count', 'Description'],
            ['Point Anomalies', str(classification_summary['point_anomaly_count']), 'Single isolated outliers'],
            ['Contextual Anomalies', str(classification_summary['contextual_anomaly_count']), 'Anomalous in specific context'],
            ['Collective Anomalies', str(classification_summary['collective_anomaly_count']), f"{classification_summary['collective_region_count']} regions of consecutive outliers"],
        ]
        
        pattern_table = Table(pattern_data, colWidths=[1.8*inch, 0.8*inch, 2.4*inch])
        pattern_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3498db')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f9fa')),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#dee2e6')),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ]))
        story.append(pattern_table)
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("5. Visualization", self.styles['SectionHeader']))
        if os.path.exists(plot_path):
            img = Image(plot_path, width=6*inch, height=4.5*inch)
            story.append(img)
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("6. Top Anomalies", self.styles['SectionHeader']))
        
        top_anomalies = anomaly_summary['anomalies'][:10]
        if top_anomalies:
            anomaly_data = [['Timestamp', 'Actual', 'Predicted', 'Norm Score', 'Type', 'Method']]
            for anomaly in top_anomalies:
                ds = anomaly['ds'].strftime('%Y-%m-%d %H:%M:%S') if hasattr(anomaly['ds'], 'strftime') else str(anomaly['ds'])
                
                norm_score = anomaly.get('normalized_anomaly_score', anomaly.get('z_score', 0))
                method = anomaly.get('detection_method', 'standard')
                
                anomaly_data.append([
                    ds,
                    f"{anomaly['y']:.2f}",
                    f"{anomaly['yhat']:.2f}",
                    f"{norm_score:.2f}",
                    anomaly['anomaly_type'].replace('_', ' ').title(),
                    method.replace('_', ' ').title()
                ])
            
            anomaly_table = Table(anomaly_data, colWidths=[1.3*inch, 0.7*inch, 0.7*inch, 0.7*inch, 0.6*inch, 1*inch])
            anomaly_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e74c3c')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 8),
                ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#fdf2f2')),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#f5c6cb')),
                ('FONTSIZE', (0, 1), (-1, -1), 7),
            ]))
            story.append(anomaly_table)
        else:
            story.append(Paragraph("No anomalies detected in the dataset.", self.styles['CustomBody']))
        
        doc.build(story)
        
        if os.path.exists(plot_path):
            os.remove(plot_path)
        
        return report_path
    
    def _create_multi_metric_plots(self, df, analysis_result, plot_path):
        metrics = analysis_result['network_graph']['metric_names']
        n_metrics = len(metrics)
        
        fig, axes = plt.subplots(n_metrics, 1, figsize=(10, 4 * n_metrics), sharex=True)
        if n_metrics == 1:
            axes = [axes]
        
        for idx, metric in enumerate(metrics):
            ax = axes[idx]
            col = f'value_{metric}'
            
            ax.plot(df['ds'], df[col], label=metric, color='#3498db', linewidth=1)
            
            anomalies = df[df['joint_anomaly']]
            ax.scatter(anomalies['ds'], anomalies[col], color='red', s=80, zorder=5, label='Joint Anomaly')
            
            ax.set_title(f'{metric} Time Series', fontsize=11, fontweight='bold')
            ax.set_ylabel('Value')
            ax.legend()
            ax.grid(True, alpha=0.3)
        
        axes[-1].set_xlabel('Time')
        plt.tight_layout()
        plt.savefig(plot_path, dpi=100, bbox_inches='tight')
        plt.close()
    
    def generate_multi_metric_report(self, task_id, filenames, analysis_result):
        report_filename = f"multi_metric_report_{task_id}.pdf"
        report_path = os.path.join(Config.REPORTS_FOLDER, report_filename)
        plot_filename = f"multi_plot_{task_id}.png"
        plot_path = os.path.join(Config.REPORTS_FOLDER, plot_filename)
        
        df = analysis_result['df']
        corr_analysis = analysis_result['correlation_analysis']
        joint_anomalies = analysis_result['joint_anomalies']
        network_graph = analysis_result['network_graph']
        
        self._create_multi_metric_plots(df, analysis_result, plot_path)
        
        doc = SimpleDocTemplate(
            report_path,
            pagesize=A4,
            rightMargin=40,
            leftMargin=40,
            topMargin=40,
            bottomMargin=40
        )
        
        story = []
        
        story.append(Paragraph("Multi-Metric Anomaly Detection Report", self.styles['CustomTitle']))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph(f"Report Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", self.styles['CustomBody']))
        story.append(Paragraph(f"Task ID: {task_id}", self.styles['CustomBody']))
        story.append(Paragraph(f"Files Analyzed: {', '.join(filenames)}", self.styles['CustomBody']))
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("1. Executive Summary", self.styles['SectionHeader']))
        
        summary_data = [
            ['Metric', 'Value'],
            ['Number of Metrics', str(len(network_graph['metric_names']))],
            ['Total Data Points', str(len(df))],
            ['Joint Anomalies Detected', str(joint_anomalies['joint_anomaly_count'])],
            ['Significant Correlations', str(len(corr_analysis['significant_correlations']))],
            ['Mahalanobis Threshold', f"{joint_anomalies['mahalanobis_threshold']:.2f}"],
            ['Covariance Method', str(analysis_result.get('covariance_method', 'robust'))],
        ]
        
        summary_table = Table(summary_data, colWidths=[3*inch, 2*inch])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3498db')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f8f9fa')),
            ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#dee2e6')),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("2. Correlation Analysis", self.styles['SectionHeader']))
        
        if corr_analysis['significant_correlations']:
            story.append(Paragraph("<b>Significant Correlations:</b>", self.styles['CustomBody']))
            
            corr_data = [['Metric 1', 'Metric 2', 'Correlation', 'Strength']]
            for corr in corr_analysis['significant_correlations']:
                corr_data.append([
                    corr['source'],
                    corr['target'],
                    f"{corr['correlation']:.3f}",
                    corr['strength'].title()
                ])
            
            corr_table = Table(corr_data, colWidths=[1.3*inch, 1.3*inch, 1.2*inch, 1.2*inch])
            corr_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#9b59b6')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f5f0ff')),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d4b8ff')),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
            ]))
            story.append(corr_table)
        else:
            story.append(Paragraph("No significant correlations found between metrics.", self.styles['CustomBody']))
        
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("3. Time Series Visualization", self.styles['SectionHeader']))
        if os.path.exists(plot_path):
            img = Image(plot_path, width=6*inch, height=4*len(network_graph['metric_names'])*inch/2.5)
            story.append(img)
        story.append(Spacer(1, 20))
        
        story.append(Paragraph("4. Joint Anomaly Details", self.styles['SectionHeader']))
        
        if joint_anomalies['anomaly_details']:
            story.append(Paragraph("<b>Top Joint Anomalies with Root Cause Analysis:</b>", self.styles['CustomBody']))
            story.append(Spacer(1, 10))
            
            for i, anomaly in enumerate(joint_anomalies['anomaly_details'][:10]):
                story.append(Paragraph(f"<b>Anomaly #{i+1}</b>", self.styles['SubHeader']))
                
                anomaly_info = [
                    ['Property', 'Value'],
                    ['Timestamp', anomaly['timestamp']],
                    ['Mahalanobis Distance', f"{anomaly['mahalanobis_distance']:.2f}"],
                    ['Root Cause Metric', anomaly['root_cause_metric']],
                    ['Anomaly Type', anomaly['anomaly_type']],
                ]
                
                info_table = Table(anomaly_info, colWidths=[2*inch, 3*inch])
                info_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e74c3c')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, 0), 9),
                    ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#fef5f5')),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#fecaca')),
                    ('FONTSIZE', (0, 1), (-1, -1), 8),
                ]))
                story.append(info_table)
                story.append(Spacer(1, 8))
                
                metric_data = [['Metric', 'Expected', 'Actual', 'Deviation']]
                for m in anomaly['expected_vs_actual']:
                    dev_str = f"+{m['deviation']:.2f}" if m['deviation'] > 0 else f"{m['deviation']:.2f}"
                    metric_data.append([
                        m['metric'],
                        f"{m['expected']:.2f}",
                        f"{m['actual']:.2f}",
                        dev_str
                    ])
                
                metric_table = Table(metric_data, colWidths=[1.2*inch, 1.2*inch, 1.2*inch, 1.2*inch])
                metric_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#f39c12')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, 0), (-1, 0), 8),
                    ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#fff8e1')),
                    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#ffe082')),
                    ('FONTSIZE', (0, 1), (-1, -1), 7),
                ]))
                story.append(metric_table)
                story.append(Spacer(1, 15))
        else:
            story.append(Paragraph("No joint anomalies detected in the dataset.", self.styles['CustomBody']))
        
        doc.build(story)
        
        if os.path.exists(plot_path):
            os.remove(plot_path)
        
        return report_path
