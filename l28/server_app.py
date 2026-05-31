import os
import json
import time
import logging
import threading

from flask import Flask, jsonify, request
from config import Config
from grpc_server import FederatedServicer, create_server

Config.ensure_dirs()
logger = setup_logging_compat()

def setup_logging_compat():
    import logging
    from datetime import datetime
    log_file = os.path.join(Config.LOG_PATH, f"server_{datetime.now().strftime('%Y%m%d')}.log")
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.FileHandler(log_file),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)

app = Flask(__name__)
servicer = None
grpc_server = None

@app.route('/api/status', methods=['GET'])
def get_status():
    if servicer is None:
        return jsonify({'error': 'Server not initialized'}), 500
    
    device_status = servicer.get_device_status()
    online_count = 0
    now = time.time()
    
    devices_info = {}
    for device_id, info in device_status.items():
        last_hb = info.get('last_heartbeat', 0)
        is_online = (now - last_hb) < servicer.heartbeat_timeout
        if is_online:
            online_count += 1
        devices_info[device_id] = {
            'online': is_online,
            'last_heartbeat': last_hb,
            'device_type': info.get('info', {}).get('device_type', 'unknown'),
            'num_classes': info.get('info', {}).get('num_classes', 0),
        }
    
    return jsonify({
        'server_status': 'running',
        'current_round': servicer.aggregator.get_round_number(),
        'online_devices': online_count,
        'total_registered': len(device_status),
        'global_model_available': servicer.global_model_weights is not None,
        'devices': devices_info
    })

@app.route('/api/metrics/<device_id>', methods=['GET'])
def get_device_metrics(device_id):
    if servicer is None:
        return jsonify({'error': 'Server not initialized'}), 500
    
    metrics = servicer.device_metrics.get(device_id)
    if metrics is None:
        return jsonify({'error': 'No metrics found for device'}), 404
    
    return jsonify({
        'device_id': device_id,
        'metrics': metrics
    })

@app.route('/api/metrics', methods=['GET'])
def get_all_metrics():
    if servicer is None:
        return jsonify({'error': 'Server not initialized'}), 500
    
    return jsonify({
        'devices': servicer.device_metrics
    })

@app.route('/api/round', methods=['GET'])
def get_round_info():
    if servicer is None:
        return jsonify({'error': 'Server not initialized'}), 500
    
    return jsonify({
        'current_round': servicer.aggregator.get_round_number(),
        'clients_in_round': servicer.aggregator.get_client_count(),
        'min_clients_for_aggregation': servicer.aggregator.min_clients,
        'global_model_available': servicer.global_model_weights is not None
    })

@app.route('/api/trigger_aggregation', methods=['POST'])
def trigger_aggregation():
    if servicer is None:
        return jsonify({'error': 'Server not initialized'}), 500
    
    with servicer._lock:
        result = servicer.aggregator.aggregate()
        if result is not None:
            servicer.global_model_weights = result
            return jsonify({
                'success': True,
                'round': servicer.aggregator.get_round_number(),
                'message': 'Aggregation triggered successfully'
            })
        else:
            return jsonify({
                'success': False,
                'message': 'Not enough clients for aggregation',
                'clients_reported': servicer.aggregator.get_client_count()
            })

@app.route('/api/config', methods=['GET'])
def get_config():
    return jsonify({
        'sync_interval_hours': Config.FED_SYNC_INTERVAL_HOURS,
        'min_clients': Config.FED_MIN_CLIENTS_FOR_AGGREGATION,
        'client_timeout_seconds': Config.FED_CLIENT_TIMEOUT_SECONDS,
        'tls_enabled': Config.TLS_ENABLED,
        'grpc_port': Config.GRPC_SERVER_PORT,
        'flask_port': Config.FLASK_SERVER_PORT
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': time.time()})


def start_grpc_server():
    global grpc_server, servicer
    grpc_server, servicer = create_server()
    servicer.start_aggregation_watcher()
    grpc_server.start()
    logger.info("gRPC server started")


def main():
    global servicer
    
    grpc_thread = threading.Thread(target=start_grpc_server, daemon=True)
    grpc_thread.start()
    
    time.sleep(1)
    
    logger.info(f"Starting Flask server on {Config.FLASK_SERVER_HOST}:{Config.FLASK_SERVER_PORT}")
    app.run(
        host=Config.FLASK_SERVER_HOST,
        port=Config.FLASK_SERVER_PORT,
        threaded=True,
        use_reloader=False
    )


if __name__ == '__main__':
    main()
