import numpy as np
from typing import Optional, Tuple, Any, Dict
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import hashlib
import logging
import threading

logger = logging.getLogger(__name__)


@dataclass
class CacheEntry:
    key: str
    value: Any
    timestamp: datetime
    access_count: int = 0
    compute_time_ms: float = 0.0
    
    def to_dict(self) -> Dict:
        return {
            'key': self.key,
            'timestamp': self.timestamp.isoformat(),
            'access_count': self.access_count,
            'compute_time_ms': self.compute_time_ms
        }


class L2Cache:
    def __init__(self, max_size: int = 100, ttl_seconds: int = 60):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._lock = threading.RLock()
        self._hits = 0
        self._misses = 0
        self._total_saved_ms = 0.0
    
    @staticmethod
    def generate_key(*args, **kwargs) -> str:
        key_parts = []
        for arg in args:
            if isinstance(arg, float):
                key_parts.append(f"{arg:.8f}")
            elif isinstance(arg, np.ndarray):
                key_parts.append(hashlib.md5(arg.tobytes()).hexdigest())
            else:
                key_parts.append(str(arg))
        
        for k, v in sorted(kwargs.items()):
            if isinstance(v, float):
                key_parts.append(f"{k}={v:.8f}")
            elif isinstance(v, np.ndarray):
                key_parts.append(f"{k}={hashlib.md5(v.tobytes()).hexdigest()}")
            else:
                key_parts.append(f"{k}={v}")
        
        raw_key = "|".join(key_parts)
        return hashlib.md5(raw_key.encode()).hexdigest()
    
    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                self._misses += 1
                return None
            
            entry = self._cache[key]
            
            if datetime.now() - entry.timestamp > timedelta(seconds=self.ttl_seconds):
                del self._cache[key]
                self._misses += 1
                return None
            
            self._cache.move_to_end(key)
            entry.access_count += 1
            self._hits += 1
            self._total_saved_ms += entry.compute_time_ms
            
            return entry.value
    
    def put(self, key: str, value: Any, compute_time_ms: float = 0.0) -> None:
        with self._lock:
            if key in self._cache:
                del self._cache[key]
            
            while len(self._cache) >= self.max_size:
                self._cache.popitem(last=False)
            
            self._cache[key] = CacheEntry(
                key=key,
                value=value,
                timestamp=datetime.now(),
                compute_time_ms=compute_time_ms
            )
    
    def get_or_compute(self, key: str, compute_func, *args, **kwargs) -> Any:
        cached = self.get(key)
        if cached is not None:
            return cached
        
        import time
        start = time.perf_counter()
        result = compute_func(*args, **kwargs)
        compute_time_ms = (time.perf_counter() - start) * 1000
        
        self.put(key, result, compute_time_ms)
        return result
    
    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0
            self._total_saved_ms = 0.0
    
    def stats(self) -> Dict:
        with self._lock:
            total = self._hits + self._misses
            hit_rate = self._hits / total if total > 0 else 0.0
            
            entries = list(self._cache.values())
            avg_compute_time = (
                sum(e.compute_time_ms for e in entries) / len(entries)
                if entries else 0.0
            )
            
            return {
                'size': len(self._cache),
                'max_size': self.max_size,
                'hits': self._hits,
                'misses': self._misses,
                'hit_rate': hit_rate,
                'total_saved_ms': self._total_saved_ms,
                'avg_compute_time_ms': avg_compute_time,
                'entries': [e.to_dict() for e in entries[:10]]
            }


class IVCacheManager:
    def __init__(self):
        self.iv_cache = L2Cache(max_size=500, ttl_seconds=30)
        self.price_cache = L2Cache(max_size=200, ttl_seconds=60)
        self.surface_cache = L2Cache(max_size=50, ttl_seconds=10)
    
    def get_iv(self, S: float, K: float, T: float, r: float, q: float, 
               price: float, opt_type: str) -> Optional[float]:
        key = L2Cache.generate_key('iv', S, K, T, r, q, price, opt_type)
        return self.iv_cache.get(key)
    
    def put_iv(self, S: float, K: float, T: float, r: float, q: float,
               price: float, opt_type: str, iv: float, compute_time_ms: float) -> None:
        key = L2Cache.generate_key('iv', S, K, T, r, q, price, opt_type)
        self.iv_cache.put(key, iv, compute_time_ms)
    
    def get_price(self, S: float, K: float, T: float, r: float, q: float,
                  sigma: float, opt_type: str, method: str) -> Optional[Dict]:
        key = L2Cache.generate_key('price', S, K, T, r, q, sigma, opt_type, method)
        return self.price_cache.get(key)
    
    def put_price(self, S: float, K: float, T: float, r: float, q: float,
                  sigma: float, opt_type: str, method: str, 
                  result: Dict, compute_time_ms: float) -> None:
        key = L2Cache.generate_key('price', S, K, T, r, q, sigma, opt_type, method)
        self.price_cache.put(key, result, compute_time_ms)
    
    def get_surface(self, tick_hash: str) -> Optional[Dict]:
        key = L2Cache.generate_key('surface', tick_hash)
        return self.surface_cache.get(key)
    
    def put_surface(self, tick_hash: str, surface: Dict, compute_time_ms: float) -> None:
        key = L2Cache.generate_key('surface', tick_hash)
        self.surface_cache.put(key, surface, compute_time_ms)
    
    def stats(self) -> Dict:
        return {
            'iv_cache': self.iv_cache.stats(),
            'price_cache': self.price_cache.stats(),
            'surface_cache': self.surface_cache.stats()
        }
    
    def clear(self) -> None:
        self.iv_cache.clear()
        self.price_cache.clear()
        self.surface_cache.clear()
