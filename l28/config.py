import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class Config:
    IMAGE_SIZE = (224, 224)
    INITIAL_CLASSES = 10
    MAX_CLASSES = 50
    MEMORY_SIZE = 2000
    BATCH_SIZE = 32
    EPOCHS = 10
    LEARNING_RATE = 0.001
    TEMPERATURE = 2.0
    DISTILLATION_ALPHA = 0.5
    RESAMPLER_TARGET_RATIO = 0.5
    RESAMPLER_MAX_OVERSAMPLE = 10
    RESAMPLER_UNDERSAMPLE_MIN = 0.3
    CAMERA_ID = 0
    FPS_TARGET = 10
    CLOUD_ENDPOINT = "https://api.example.com/metrics"
    REPORT_INTERVAL = 60
    MODEL_SAVE_PATH = os.path.join(BASE_DIR, "models")
    MEMORY_BANK_PATH = os.path.join(BASE_DIR, "memory_bank")
    LOG_PATH = os.path.join(BASE_DIR, "logs")
    
    DEVICE_ID = "rpi-001"
    GRPC_SERVER_HOST = "0.0.0.0"
    GRPC_SERVER_PORT = 50051
    FLASK_SERVER_HOST = "0.0.0.0"
    FLASK_SERVER_PORT = 8080
    FED_SYNC_INTERVAL_HOURS = 24
    FED_MIN_CLIENTS_FOR_AGGREGATION = 2
    FED_CLIENT_TIMEOUT_SECONDS = 120
    FED_MAX_RETRIES = 3
    FED_RETRY_DELAY_SECONDS = 30
    TLS_ENABLED = True
    TLS_CERT_DIR = os.path.join(BASE_DIR, "certs")
    TLS_SERVER_CERT = os.path.join(TLS_CERT_DIR, "server.crt")
    TLS_SERVER_KEY = os.path.join(TLS_CERT_DIR, "server.key")
    TLS_CA_CERT = os.path.join(TLS_CERT_DIR, "ca.crt")
    TLS_CLIENT_CERT = os.path.join(TLS_CERT_DIR, "client.crt")
    TLS_CLIENT_KEY = os.path.join(TLS_CERT_DIR, "client.key")
    
    @classmethod
    def ensure_dirs(cls):
        for path in [cls.MODEL_SAVE_PATH, cls.MEMORY_BANK_PATH, cls.LOG_PATH, cls.TLS_CERT_DIR]:
            os.makedirs(path, exist_ok=True)
