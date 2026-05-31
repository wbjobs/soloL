import os

class Config:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
    RESULTS_FOLDER = os.path.join(BASE_DIR, 'results')
    REPORTS_FOLDER = os.path.join(BASE_DIR, 'reports')
    
    CELERY_BROKER_URL = 'redis://localhost:6379/0'
    CELERY_RESULT_BACKEND = 'redis://localhost:6379/0'
    
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    ALLOWED_EXTENSIONS = {'csv'}
    
    SIGMA_THRESHOLD = 3
    
    @staticmethod
    def init_dirs():
        for folder in [Config.UPLOAD_FOLDER, Config.RESULTS_FOLDER, Config.REPORTS_FOLDER]:
            os.makedirs(folder, exist_ok=True)
