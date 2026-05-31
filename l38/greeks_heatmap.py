import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

from config import Config
from market_data import OptionTick
from volatility_surface_optimized import VolatilitySurface, OptimizedOptionPricer


logger = logging.getLogger(__name__)


@dataclass
class GreeksGrid:
    moneyness_grid: np.ndarray
    tenor_grid: np.ndarray
    delta_grid: np.ndarray
    gamma_grid: np.ndarray
    vega_grid: np.ndarray
    theta_grid: np.ndarray
    rho_grid: Optional[np.ndarray] = None
    timestamp: datetime = field(default_factory=datetime.now)
    build_time_ms: float = 0.0
    
    def to_dict(self) -> Dict:
        return {
            'moneyness_grid': self.moneyness_grid.tolist(),
            'tenor_grid': self.tenor_grid.tolist(),
            'delta_grid': self.delta_grid.tolist(),
            'gamma_grid': self.gamma_grid.tolist(),
            'vega_grid': self.vega_grid.tolist(),
            'theta_grid': self.theta_grid.tolist(),
            'rho_grid': self.rho_grid.tolist() if self.rho_grid is not None else None,
            'timestamp': self.timestamp.isoformat(),
            'build_time_ms': float(self.build_time_ms)
        }


class GreeksHeatmapCalculator:
    def __init__(self, use_cpp: bool = True, num_threads: int = 4):
        self.use_cpp = use_cpp
        self.num_threads = num_threads
        self.pricer = OptimizedOptionPricer(use_cpp=use_cpp)
    
    def calculate_greeks_grid(self,
                              surface: VolatilitySurface,
                              S: float,
                              r: float,
                              q: float) -> GreeksGrid:
        from fdm_solver import black_scholes_analytical
        
        start_time = time.perf_counter()
        
        moneyness = surface.moneyness_grid
        tenors = surface.tenor_grid
        iv_grid = surface.iv_grid
        
        n_tenors = len(tenors)
        n_moneyness = len(moneyness)
        
        delta_grid = np.zeros((n_tenors, n_moneyness))
        gamma_grid = np.zeros((n_tenors, n_moneyness))
        vega_grid = np.zeros((n_tenors, n_moneyness))
        theta_grid = np.zeros((n_tenors, n_moneyness))
        
        def calculate_point(args):
            i, j = args
            K = moneyness[j] * S
            T = tenors[i]
            sigma = iv_grid[i, j]
            
            price, delta, gamma, theta, vega = black_scholes_analytical(
                S=S, K=K, T=T, r=r, q=q,
                sigma=sigma,
                option_type='call'
            )
            
            return i, j, delta, gamma, theta, vega
        
        tasks = [(i, j) for i in range(n_tenors) for j in range(n_moneyness)]
        
        with ThreadPoolExecutor(max_workers=self.num_threads) as executor:
            futures = [executor.submit(calculate_point, task) for task in tasks]
            for future in as_completed(futures):
                i, j, delta, gamma, theta, vega = future.result()
                delta_grid[i, j] = delta
                gamma_grid[i, j] = gamma
                vega_grid[i, j] = vega
                theta_grid[i, j] = theta
        
        build_time_ms = (time.perf_counter() - start_time) * 1000
        
        return GreeksGrid(
            moneyness_grid=moneyness,
            tenor_grid=tenors,
            delta_grid=delta_grid,
            gamma_grid=gamma_grid,
            vega_grid=vega_grid,
            theta_grid=theta_grid,
            timestamp=surface.timestamp,
            build_time_ms=build_time_ms
        )


class MonteCarloSimulator:
    def __init__(self, num_threads: int = 4):
        self.num_threads = num_threads
    
    def simulate_paths(self,
                      S0: float,
                      r: float,
                      q: float,
                      sigma: float,
                      T: float,
                      n_paths: int = 10000,
                      n_steps: int = 252) -> np.ndarray:
        dt = T / n_steps
        drift = (r - q - 0.5 * sigma**2) * dt
        diffusion = sigma * np.sqrt(dt)
        
        paths_per_thread = n_paths // self.num_threads
        remainder = n_paths % self.num_threads
        
        def simulate_chunk(n):
            Z = np.random.standard_normal((n, n_steps))
            log_returns = drift + diffusion * Z
            log_paths = np.cumsum(log_returns, axis=1)
            paths = S0 * np.exp(log_paths)
            paths = np.hstack([np.full((n, 1), S0), paths])
            return paths
        
        with ThreadPoolExecutor(max_workers=self.num_threads) as executor:
            chunks = []
            for t in range(self.num_threads):
                n = paths_per_thread + (1 if t < remainder else 0)
                if n > 0:
                    chunks.append(executor.submit(simulate_chunk, n))
            
            all_paths = []
            for chunk in chunks:
                all_paths.append(chunk.result())
        
        return np.vstack(all_paths)
    
    def price_european_option_mc(self,
                                  S0: float,
                                  K: float,
                                  T: float,
                                  r: float,
                                  q: float,
                                  sigma: float,
                                  option_type: str = 'call',
                                  n_paths: int = 10000,
                                  n_steps: int = 252,
                                  confidence: float = 0.95) -> Dict:
        paths = self.simulate_paths(S0, r, q, sigma, T, n_paths, n_steps)
        
        if option_type == 'call':
            payoffs = np.maximum(paths[:, -1] - K, 0)
        else:
            payoffs = np.maximum(K - paths[:, -1], 0)
        
        discount_factor = np.exp(-r * T)
        prices = discount_factor * payoffs
        
        mean_price = np.mean(prices)
        std_price = np.std(prices, ddof=1)
        std_error = std_price / np.sqrt(n_paths)
        
        from scipy.stats import norm
        z = norm.ppf((1 + confidence) / 2)
        ci_lower = mean_price - z * std_error
        ci_upper = mean_price + z * std_error
        
        return {
            'price': float(mean_price),
            'std_error': float(std_error),
            'confidence_interval': [float(ci_lower), float(ci_upper)],
            'confidence_level': confidence,
            'n_paths': n_paths,
            'n_steps': n_steps,
            'paths': paths.tolist() if n_paths <= 1000 else None
        }
    
    def simulate_greeks_mc(self,
                           S0: float,
                           K: float,
                           T: float,
                           r: float,
                           q: float,
                           sigma: float,
                           option_type: str = 'call',
                           n_paths: int = 10000) -> Dict:
        bump = 0.01
        
        price = self.price_european_option_mc(S0, K, T, r, q, sigma, option_type, n_paths)['price']
        price_up = self.price_european_option_mc(S0 * (1 + bump), K, T, r, q, sigma, option_type, n_paths)['price']
        price_down = self.price_european_option_mc(S0 * (1 - bump), K, T, r, q, sigma, option_type, n_paths)['price']
        price_sigma_up = self.price_european_option_mc(S0, K, T, r, q, sigma * (1 + bump), option_type, n_paths)['price']
        price_T_down = self.price_european_option_mc(S0, K, T * (1 - bump), r, q, sigma, option_type, n_paths)['price']
        
        delta = (price_up - price_down) / (2 * S0 * bump)
        gamma = (price_up - 2 * price + price_down) / (S0 * bump)**2
        vega = (price_sigma_up - price) / (sigma * bump) * 0.01
        theta = -(price_T_down - price) / (T * bump) / 365
        
        return {
            'delta': float(delta),
            'gamma': float(gamma),
            'vega': float(vega),
            'theta': float(theta),
            'price': float(price)
        }
