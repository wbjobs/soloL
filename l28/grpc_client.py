import os
import time
import logging
import threading
import numpy as np
import grpc

from proto import federated_pb2
from proto import federated_pb2_grpc
from config import Config

logger = logging.getLogger(__name__)

class FederatedClient:
    def __init__(self, server_host=None, server_port=None, device_id=None):
        self.server_host = server_host or Config.GRPC_SERVER_HOST
        self.server_port = server_port or Config.GRPC_SERVER_PORT
        self.device_id = device_id or Config.DEVICE_ID
        self.server_address = f"{self.server_host}:{self.server_port}"
        
        self.channel = None
        self.stub = None
        self.is_registered = False
        self.current_round = 0
        self.device_token = None
        
        self.sync_interval = Config.FED_SYNC_INTERVAL_HOURS * 3600
        self.max_retries = Config.FED_MAX_RETRIES
        self.retry_delay = Config.FED_RETRY_DELAY_SECONDS
        
        self.sync_thread = None
        self.is_syncing = False
        self.model_ref = None
        
        self._last_heartbeat = 0
        self._heartbeat_interval = 60

    def _create_secure_channel(self):
        if not Config.TLS_ENABLED:
            return grpc.insecure_channel(self.server_address)
        
        if not os.path.exists(Config.TLS_CA_CERT):
            logger.warning("TLS CA cert not found, falling back to insecure channel")
            return grpc.insecure_channel(self.server_address)
        
        try:
            with open(Config.TLS_CA_CERT, 'rb') as f:
                ca_cert = f.read()
            with open(Config.TLS_CLIENT_CERT, 'rb') as f:
                client_cert = f.read()
            with open(Config.TLS_CLIENT_KEY, 'rb') as f:
                client_key = f.read()
            
            credentials = grpc.ssl_channel_credentials(
                root_certificates=ca_cert,
                private_key=client_key,
                certificate_chain=client_cert
            )
            
            channel = grpc.secure_channel(
                self.server_address,
                credentials,
                options=[
                    ('grpc.ssl_target_name_override', 'federated-server'),
                    ('grpc.max_receive_message_length', 100 * 1024 * 1024),
                    ('grpc.max_send_message_length', 100 * 1024 * 1024),
                ]
            )
            return channel
        except Exception as e:
            logger.error(f"Failed to create secure channel: {e}")
            return grpc.insecure_channel(self.server_address)

    def connect(self):
        self.channel = self._create_secure_channel()
        self.stub = federated_pb2_grpc.FederatedServiceStub(self.channel)
        
        try:
            grpc.channel_ready_future(self.channel).result(timeout=10)
            logger.info(f"Connected to server at {self.server_address}")
            return True
        except grpc.FutureTimeoutError:
            logger.error(f"Connection timeout to {self.server_address}")
            return False

    def disconnect(self):
        if self.channel:
            self.channel.close()
            self.channel = None
            self.stub = None
        self.is_registered = False

    def register(self, num_classes, memory_bank_size=0):
        for attempt in range(self.max_retries):
            try:
                if not self.stub:
                    if not self.connect():
                        continue
                
                response = self.stub.RegisterDevice(
                    federated_pb2.RegisterRequest(
                        device_id=self.device_id,
                        device_type="raspberry_pi_4b",
                        num_classes=num_classes,
                        memory_bank_size=memory_bank_size
                    ),
                    timeout=Config.FED_CLIENT_TIMEOUT_SECONDS
                )
                
                if response.success:
                    self.is_registered = True
                    self.device_token = response.device_token
                    self.current_round = response.round_number
                    logger.info(f"Registered successfully, round={self.current_round}")
                    return True
                else:
                    logger.warning(f"Registration rejected: {response.message}")
                    return False
                    
            except grpc.RpcError as e:
                logger.warning(f"Registration attempt {attempt + 1} failed: {e.code()}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay)
                    self.connect()
        
        logger.error("Registration failed after all retries")
        return False

    def _model_weights_to_proto(self, model):
        weight_entries = []
        for layer in model.layers:
            weights = layer.get_weights()
            if not weights:
                continue
            
            w = weights[0]
            entry = federated_pb2.WeightEntry(
                layer_name=layer.name,
                weight_data=w.tobytes(),
                weight_shape=list(w.shape),
            )
            
            if len(weights) > 1:
                b = weights[1]
                entry.bias_data = b.tobytes()
                entry.bias_shape.extend(list(b.shape))
            
            weight_entries.append(entry)
        
        return weight_entries

    def _proto_to_model_weights(self, weight_entries):
        weights_dict = {}
        for entry in weight_entries:
            w_shape = tuple(entry.weight_shape)
            w_data = np.frombuffer(entry.weight_data, dtype=np.float32).reshape(w_shape)
            
            b_data = None
            if entry.bias_data:
                b_shape = tuple(entry.bias_shape)
                b_data = np.frombuffer(entry.bias_data, dtype=np.float32).reshape(b_shape)
            
            weights_dict[entry.layer_name] = (w_data, b_data)
        
        return weights_dict

    def upload_model_update(self, model, num_samples, accuracy=0.0, loss=0.0):
        for attempt in range(self.max_retries):
            try:
                if not self.stub:
                    if not self.connect():
                        continue
                
                weight_entries = self._model_weights_to_proto(model)
                
                response = self.stub.UploadModelUpdate(
                    federated_pb2.ModelUpdateRequest(
                        device_id=self.device_id,
                        round_number=self.current_round,
                        weights=weight_entries,
                        num_samples=num_samples,
                        training_accuracy=accuracy,
                        training_loss=loss
                    ),
                    timeout=Config.FED_CLIENT_TIMEOUT_SECONDS
                )
                
                if response.accepted:
                    logger.info(f"Model update accepted, round={response.current_round}, "
                                f"clients_reported={response.clients_reported}")
                    return True
                else:
                    logger.warning(f"Model update rejected: {response.message}")
                    return False
                    
            except grpc.RpcError as e:
                logger.warning(f"Upload attempt {attempt + 1} failed: {e.code()}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay)
                    self.connect()
        
        logger.error("Model upload failed after all retries")
        return False

    def download_global_model(self):
        for attempt in range(self.max_retries):
            try:
                if not self.stub:
                    if not self.connect():
                        continue
                
                response = self.stub.DownloadGlobalModel(
                    federated_pb2.GlobalModelRequest(
                        device_id=self.device_id,
                        current_round=self.current_round
                    ),
                    timeout=Config.FED_CLIENT_TIMEOUT_SECONDS
                )
                
                if response.available:
                    self.current_round = response.round_number
                    weights_dict = self._proto_to_model_weights(response.weights)
                    logger.info(f"Downloaded global model, round={response.round_number}, "
                                f"num_classes={response.num_classes}")
                    return weights_dict, response.num_classes
                else:
                    logger.info(f"No global model available: {response.message}")
                    return None, 0
                    
            except grpc.RpcError as e:
                logger.warning(f"Download attempt {attempt + 1} failed: {e.code()}")
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay)
                    self.connect()
        
        logger.error("Global model download failed after all retries")
        return None, 0

    def apply_global_weights(self, model, weights_dict):
        applied = 0
        for layer in model.layers:
            if layer.name in weights_dict:
                w_data, b_data = weights_dict[layer.name]
                if b_data is not None:
                    layer.set_weights([w_data, b_data])
                else:
                    layer.set_weights([w_data])
                applied += 1
        logger.info(f"Applied global weights to {applied} layers")
        return applied

    def heartbeat(self, cpu_percent=0.0, memory_mb=0.0):
        try:
            if not self.stub:
                return False
            
            response = self.stub.Heartbeat(
                federated_pb2.HeartbeatRequest(
                    device_id=self.device_id,
                    current_round=self.current_round,
                    cpu_percent=cpu_percent,
                    memory_mb=memory_mb
                ),
                timeout=10
            )
            
            self._last_heartbeat = time.time()
            
            if response.model_update_available:
                logger.info("Server reports global model update available")
            
            return response.alive
            
        except grpc.RpcError:
            return False

    def report_metrics(self, fps, accuracy, avg_latency_ms, memory_mb,
                       cpu_percent, total_predictions, uptime_seconds):
        try:
            if not self.stub:
                return False
            
            response = self.stub.ReportMetrics(
                federated_pb2.MetricsRequest(
                    device_id=self.device_id,
                    fps=fps,
                    accuracy=accuracy,
                    avg_latency_ms=avg_latency_ms,
                    memory_mb=memory_mb,
                    cpu_percent=cpu_percent,
                    total_predictions=total_predictions,
                    uptime_seconds=uptime_seconds
                ),
                timeout=10
            )
            return response.received
        except grpc.RpcError:
            return False

    def start_sync_loop(self, model_ref):
        self.model_ref = model_ref
        self.is_syncing = True
        self.sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self.sync_thread.start()
        logger.info(f"Started federated sync loop (interval={self.sync_interval}s)")

    def stop_sync_loop(self):
        self.is_syncing = False
        if self.sync_thread:
            self.sync_thread.join(timeout=30)

    def _sync_loop(self):
        while self.is_syncing:
            try:
                if not self.is_registered:
                    if self.model_ref:
                        self.register(
                            self.model_ref.num_classes,
                            self.model_ref.memory_bank.get_size()
                        )
                    if not self.is_registered:
                        time.sleep(self.retry_delay)
                        continue
                
                if self.model_ref:
                    memory_images, memory_labels = self.model_ref.memory_bank.get_all_samples()
                    num_samples = len(memory_labels)
                    
                    self.upload_model_update(
                        self.model_ref.model,
                        num_samples=max(num_samples, 1)
                    )
                
                weights_dict, num_classes = self.download_global_model()
                if weights_dict and self.model_ref:
                    self.apply_global_weights(self.model_ref.model, weights_dict)
                
                last_hb = time.time() - self._last_heartbeat
                if last_hb > self._heartbeat_interval:
                    import psutil
                    self.heartbeat(
                        cpu_percent=psutil.cpu_percent(),
                        memory_mb=psutil.Process().memory_info().rss / (1024 * 1024)
                    )
                
            except Exception as e:
                logger.error(f"Sync loop error: {e}")
            
            sleep_until = time.time() + self.sync_interval
            while self.is_syncing and time.time() < sleep_until:
                time.sleep(5)
