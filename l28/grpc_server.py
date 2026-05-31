import time
import uuid
import logging
import threading
from concurrent import futures

import grpc
import numpy as np

from proto import federated_pb2
from proto import federated_pb2_grpc
from fedavg import FedAvgAggregator
from config import Config

logger = logging.getLogger(__name__)

class FederatedServicer(federated_pb2_grpc.FederatedServiceServicer):
    def __init__(self, aggregator=None):
        self.aggregator = aggregator or FedAvgAggregator()
        self.aggregator.min_clients = Config.FED_MIN_CLIENTS_FOR_AGGREGATION
        
        self.registered_devices = {}
        self.device_heartbeats = {}
        self.device_metrics = {}
        
        self.client_timeout = Config.FED_CLIENT_TIMEOUT_SECONDS
        self.heartbeat_timeout = self.client_timeout * 3
        
        self.global_model_weights = None
        self.global_model_num_classes = Config.INITIAL_CLASSES
        self._lock = threading.Lock()
        
        self._aggregation_thread = None
        self._running = False

    def start_aggregation_watcher(self):
        self._running = True
        self._aggregation_thread = threading.Thread(
            target=self._watch_and_aggregate, daemon=True
        )
        self._aggregation_thread.start()
        logger.info("Aggregation watcher started")

    def stop_aggregation_watcher(self):
        self._running = False
        if self._aggregation_thread:
            self._aggregation_thread.join(timeout=30)

    def _watch_and_aggregate(self):
        while self._running:
            time.sleep(30)
            
            with self._lock:
                self._cleanup_stale_devices()
                
                if self.aggregator.can_aggregate():
                    result = self.aggregator.aggregate()
                    if result is not None:
                        self.global_model_weights = result
                        logger.info(f"Global model updated, "
                                     f"round={self.aggregator.get_round_number()}")

    def _cleanup_stale_devices(self):
        now = time.time()
        stale = [
            device_id for device_id, last_hb in self.device_heartbeats.items()
            if now - last_hb > self.heartbeat_timeout
        ]
        for device_id in stale:
            logger.warning(f"Removing stale device: {device_id}")
            del self.device_heartbeats[device_id]
            self.registered_devices.pop(device_id, None)
            self.aggregator.client_updates.pop(device_id, None)

    def _proto_to_weights(self, weight_entries):
        weights = []
        for entry in weight_entries:
            w_shape = tuple(entry.weight_shape)
            w_data = np.frombuffer(entry.weight_data, dtype=np.float32).copy()
            w_data = w_data.reshape(w_shape)
            
            if entry.bias_data:
                b_shape = tuple(entry.bias_shape)
                b_data = np.frombuffer(entry.bias_data, dtype=np.float32).copy()
                b_data = b_data.reshape(b_shape)
                weights.append((w_data, b_data, entry.layer_name))
            else:
                weights.append((w_data, None, entry.layer_name))
        
        return weights

    def _weights_to_proto(self, weight_list):
        entries = []
        for w_data, b_data, layer_name in weight_list:
            entry = federated_pb2.WeightEntry(
                layer_name=layer_name,
                weight_data=w_data.tobytes(),
                weight_shape=list(w_data.shape),
            )
            if b_data is not None:
                entry.bias_data = b_data.tobytes()
                entry.bias_shape.extend(list(b_data.shape))
            entries.append(entry)
        return entries

    def _global_model_to_proto(self):
        if self.global_model_weights is None:
            return []
        
        weight_list = []
        layer_names = getattr(self, '_global_layer_names', [])
        
        for i, w in enumerate(self.global_model_weights):
            name = layer_names[i] if i < len(layer_names) else f"layer_{i}"
            weight_list.append((w, None, name))
        
        return self._weights_to_proto(weight_list)

    def RegisterDevice(self, request, context):
        device_id = request.device_id
        logger.info(f"Registration request from {device_id}")
        
        with self._lock:
            token = str(uuid.uuid4())
            self.registered_devices[device_id] = {
                'device_type': request.device_type,
                'num_classes': request.num_classes,
                'memory_bank_size': request.memory_bank_size,
                'token': token,
                'registered_at': time.time()
            }
            self.device_heartbeats[device_id] = time.time()
        
        return federated_pb2.RegisterResponse(
            success=True,
            device_token=token,
            round_number=self.aggregator.get_round_number(),
            message="Registration successful"
        )

    def UploadModelUpdate(self, request, context):
        device_id = request.device_id
        
        with self._lock:
            if device_id not in self.registered_devices:
                context.set_code(grpc.StatusCode.UNAUTHENTICATED)
                context.set_details("Device not registered")
                return federated_pb2.ModelUpdateResponse(
                    accepted=False, message="Device not registered"
                )
            
            self.device_heartbeats[device_id] = time.time()
        
        weights = self._proto_to_weights(request.weights)
        layer_weights = [w for w, b, name in weights]
        
        if not layer_weights:
            return federated_pb2.ModelUpdateResponse(
                accepted=False,
                current_round=self.aggregator.get_round_number(),
                clients_reported=self.aggregator.get_client_count(),
                message="No weights received"
            )
        
        if not hasattr(self, '_global_layer_names') or not self._global_layer_names:
            self._global_layer_names = [name for w, b, name in weights]
        
        self.aggregator.register_update(
            device_id=device_id,
            weights=layer_weights,
            num_samples=request.num_samples
        )
        
        return federated_pb2.ModelUpdateResponse(
            accepted=True,
            current_round=self.aggregator.get_round_number(),
            clients_reported=self.aggregator.get_client_count(),
            message="Update accepted"
        )

    def DownloadGlobalModel(self, request, context):
        device_id = request.device_id
        
        with self._lock:
            if device_id not in self.registered_devices:
                context.set_code(grpc.StatusCode.UNAUTHENTICATED)
                context.set_details("Device not registered")
                return federated_pb2.GlobalModelResponse(
                    available=False, message="Device not registered"
                )
            
            self.device_heartbeats[device_id] = time.time()
        
        if self.global_model_weights is None:
            return federated_pb2.GlobalModelResponse(
                available=False,
                round_number=self.aggregator.get_round_number(),
                message="No global model available yet"
            )
        
        proto_weights = self._global_model_to_proto()
        
        return federated_pb2.GlobalModelResponse(
            available=True,
            round_number=self.aggregator.get_round_number(),
            weights=proto_weights,
            num_classes=self.global_model_num_classes,
            message="Global model available"
        )

    def ReportMetrics(self, request, context):
        device_id = request.device_id
        
        with self._lock:
            self.device_metrics[device_id] = {
                'fps': request.fps,
                'accuracy': request.accuracy,
                'avg_latency_ms': request.avg_latency_ms,
                'memory_mb': request.memory_mb,
                'cpu_percent': request.cpu_percent,
                'total_predictions': request.total_predictions,
                'uptime_seconds': request.uptime_seconds,
                'reported_at': time.time()
            }
        
        logger.info(f"Metrics from {device_id}: fps={request.fps:.1f}, "
                     f"acc={request.accuracy:.4f}")
        
        return federated_pb2.MetricsResponse(received=True, message="Metrics recorded")

    def Heartbeat(self, request, context):
        device_id = request.device_id
        
        with self._lock:
            if device_id not in self.registered_devices:
                context.set_code(grpc.StatusCode.UNAUTHENTICATED)
                context.set_details("Device not registered")
                return federated_pb2.HeartbeatResponse(alive=False)
            
            self.device_heartbeats[device_id] = time.time()
        
        model_available = self.global_model_weights is not None
        
        return federated_pb2.HeartbeatResponse(
            alive=True,
            server_round=self.aggregator.get_round_number(),
            model_update_available=model_available,
            sync_interval_seconds=Config.FED_SYNC_INTERVAL_HOURS * 3600
        )

    def get_device_status(self):
        with self._lock:
            return {
                device_id: {
                    'last_heartbeat': self.device_heartbeats.get(device_id, 0),
                    'info': info
                }
                for device_id, info in self.registered_devices.items()
            }


def create_server(servicer=None, port=None):
    port = port or Config.GRPC_SERVER_PORT
    servicer = servicer or FederatedServicer()
    
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10),
        options=[
            ('grpc.max_receive_message_length', 100 * 1024 * 1024),
            ('grpc.max_send_message_length', 100 * 1024 * 1024),
        ]
    )
    federated_pb2_grpc.add_FederatedServiceServicer_to_server(servicer, server)
    
    if Config.TLS_ENABLED and os.path.exists(Config.TLS_SERVER_CERT):
        with open(Config.TLS_SERVER_CERT, 'rb') as f:
            server_cert = f.read()
        with open(Config.TLS_SERVER_KEY, 'rb') as f:
            server_key = f.read()
        with open(Config.TLS_CA_CERT, 'rb') as f:
            ca_cert = f.read()
        
        credentials = grpc.ssl_server_credentials(
            [(server_key, server_cert)],
            root_certificates=ca_cert,
            require_client_auth=True
        )
        server.add_secure_port(f'[::]:{port}', credentials)
        logger.info(f"gRPC server started with TLS on port {port}")
    else:
        server.add_insecure_port(f'[::]:{port}')
        logger.info(f"gRPC server started (insecure) on port {port}")
    
    return server, servicer


import os
