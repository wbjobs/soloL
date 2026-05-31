import numpy as np

class Config:
    SERVER_HOST = "0.0.0.0"
    SERVER_PORT = 8080
    
    UNDERLYING_SYMBOL = "510300"
    UNDERLYING_NAME = "沪深300ETF"
    
    RISK_FREE_RATE = 0.025
    DIVIDEND_YIELD = 0.0
    
    FDM_SPOT_MIN = 0.5
    FDM_SPOT_MAX = 1.5
    FDM_SPOT_POINTS = 100
    FDM_TIME_POINTS = 200
    FDM_SCHEME = "implicit"
    
    TENORS = np.array([1/365, 7/365, 14/365, 21/365, 30/365, 60/365, 90/365, 180/365, 270/365, 365/365])
    TENOR_NAMES = ["1D", "7D", "14D", "21D", "1M", "2M", "3M", "6M", "9M", "1Y"]
    
    MONEYNESS_RANGE = np.linspace(0.8, 1.2, 50)
    
    VOLATILITY_MIN = 0.05
    VOLATILITY_MAX = 0.8
    
    IV_TOLERANCE = 1e-8
    IV_MAX_ITERATIONS = 100
    
    HISTORY_LENGTH = 100
    
    ENABLE_MOCK_DATA = True
    MOCK_TICK_INTERVAL = 0.2
    
    ENABLE_CPP_EXTENSION = False
    NUM_THREADS = 4
    
    ENABLE_DOWNSAMPLING = True
    DOWNSAMPLE_WINDOW_MS = 100
    DOWNSAMPLE_MAX_POINTS = 5
    DOWNSAMPLE_MIN_TICKS = 50
    
    ENABLE_L2_CACHE = True
    CACHE_MAX_SIZE = 500
    CACHE_TTL_SECONDS = 30
    
    SURFACE_BUILDER = "rbf"
    RBF_KERNEL = "thin_plate_spline"
    
    FRONTEND_PAGE = "index_optimized.html"
