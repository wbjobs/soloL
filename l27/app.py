import os
import uuid
from flask import Flask, render_template, request, jsonify, send_file, url_for
from werkzeug.utils import secure_filename
from config import Config
from app.tasks import detect_anomalies_task

Config.init_dirs()

app = Flask(__name__)
app.config.from_object(Config)


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload_file():
    mode = request.form.get('mode', 'single')
    
    if mode == 'single':
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        if file and allowed_file(file.filename):
            filename = secure_filename(file.filename)
            file_id = str(uuid.uuid4())
            saved_filename = f"{file_id}_{filename}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], saved_filename)
            file.save(file_path)
            
            task = detect_anomalies_task.delay(file_path, filename, mode='single')
            
            return jsonify({
                'task_id': task.id,
                'filename': filename,
                'message': 'File uploaded successfully. Detection task started.'
            }), 202
        
        return jsonify({'error': 'Invalid file type. Only CSV files are allowed.'}), 400
    else:
        if 'files' not in request.files:
            return jsonify({'error': 'No files part'}), 400
        
        files = request.files.getlist('files')
        
        if len(files) < 2:
            return jsonify({'error': 'Please upload at least 2 files for multi-metric analysis'}), 400
        
        file_paths = []
        filenames = []
        
        for file in files:
            if file.filename == '':
                continue
            
            if not allowed_file(file.filename):
                return jsonify({'error': f'Invalid file type: {file.filename}. Only CSV files are allowed.'}), 400
            
            filename = secure_filename(file.filename)
            file_id = str(uuid.uuid4())
            saved_filename = f"{file_id}_{filename}"
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], saved_filename)
            file.save(file_path)
            
            file_paths.append(file_path)
            filenames.append(filename)
        
        task = detect_anomalies_task.delay(file_paths, filenames, mode='multi')
        
        return jsonify({
            'task_id': task.id,
            'filenames': filenames,
            'message': f'{len(filenames)} files uploaded successfully. Multi-metric analysis task started.'
        }), 202


@app.route('/api/task/<task_id>', methods=['GET'])
def get_task_status(task_id):
    task = detect_anomalies_task.AsyncResult(task_id)
    
    if task.state == 'PENDING':
        response = {
            'state': task.state,
            'status': 'Task is pending...'
        }
    elif task.state == 'PROGRESS':
        response = {
            'state': task.state,
            'status': task.info.get('status', 'Processing...')
        }
    elif task.state == 'SUCCESS':
        response = {
            'state': task.state,
            'result': task.result
        }
    elif task.state == 'FAILURE':
        response = {
            'state': task.state,
            'status': str(task.info)
        }
    else:
        response = {
            'state': task.state,
            'status': 'Unknown state'
        }
    
    return jsonify(response)


@app.route('/api/report/<task_id>', methods=['GET'])
def get_report(task_id):
    report_filename = f"anomaly_report_{task_id}.pdf"
    report_path = os.path.join(app.config['REPORTS_FOLDER'], report_filename)
    
    if os.path.exists(report_path):
        return send_file(report_path, as_attachment=True, download_name=report_filename)
    
    return jsonify({'error': 'Report not found'}), 404


@app.route('/api/results/<task_id>', methods=['GET'])
def get_results(task_id):
    results_filename = f"results_{task_id}.csv"
    results_path = os.path.join(app.config['RESULTS_FOLDER'], results_filename)
    
    if os.path.exists(results_path):
        return send_file(results_path, as_attachment=True, download_name=results_filename)
    
    return jsonify({'error': 'Results not found'}), 404


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
