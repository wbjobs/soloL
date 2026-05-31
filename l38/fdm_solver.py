import numpy as np
from scipy import linalg
from scipy.stats import norm
from dataclasses import dataclass
from typing import Tuple, List
import logging

from config import Config

logger = logging.getLogger(__name__)


@dataclass
class FDMConfig:
    spot_min: float = Config.FDM_SPOT_MIN
    spot_max: float = Config.FDM_SPOT_MAX
    spot_points: int = Config.FDM_SPOT_POINTS
    time_points: int = Config.FDM_TIME_POINTS
    scheme: str = Config.FDM_SCHEME


@dataclass
class FDMResult:
    spot_grid: np.ndarray
    time_grid: np.ndarray
    price_grid: np.ndarray
    delta_grid: np.ndarray
    gamma_grid: np.ndarray
    theta_grid: np.ndarray


class BlackScholesFDM:
    def __init__(self, config: FDMConfig = None):
        self.config = config or FDMConfig()
        self.S_min = self.config.spot_min
        self.S_max = self.config.spot_max
        self.N = self.config.spot_points
        self.M = self.config.time_points
        self.scheme = self.config.scheme
        
        self._setup_grids()
    
    def _setup_grids(self):
        self.S = np.linspace(self.S_min, self.S_max, self.N + 1)
        self.dS = (self.S_max - self.S_min) / self.N
    
    def _setup_time_grid(self, T: float):
        self.T = T
        self.t = np.linspace(0, T, self.M + 1)
        self.dt = T / self.M
    
    def _payoff(self, S: np.ndarray, K: float, option_type: str) -> np.ndarray:
        if option_type == 'call':
            return np.maximum(S - K, 0)
        elif option_type == 'put':
            return np.maximum(K - S, 0)
        else:
            raise ValueError(f"Unknown option type: {option_type}")
    
    def _setup_boundary_conditions(self, K: float, r: float, q: float, option_type: str):
        self.V = np.zeros((self.N + 1, self.M + 1))
        self.V[:, -1] = self._payoff(self.S, K, option_type)
        
        if option_type == 'call':
            self.V[0, :] = 0
            self.V[-1, :] = self.S[-1] * np.exp(-q * (self.T - self.t)) - K * np.exp(-r * (self.T - self.t))
        elif option_type == 'put':
            self.V[0, :] = K * np.exp(-r * (self.T - self.t)) - self.S[0] * np.exp(-q * (self.T - self.t))
            self.V[-1, :] = 0
    
    def _coefficients(self, r: float, q: float, sigma: float):
        j = np.arange(1, self.N)
        alpha = 0.5 * self.dt * (sigma ** 2 * j ** 2 - (r - q) * j)
        beta = 1 - self.dt * (sigma ** 2 * j ** 2 + r)
        gamma = 0.5 * self.dt * (sigma ** 2 * j ** 2 + (r - q) * j)
        return alpha, beta, gamma
    
    def _solve_explicit(self, r: float, q: float, sigma: float):
        alpha, beta, gamma = self._coefficients(r, q, sigma)
        
        for m in range(self.M, 0, -1):
            self.V[1:self.N, m-1] = (alpha * self.V[0:self.N-1, m] + 
                                    beta * self.V[1:self.N, m] + 
                                    gamma * self.V[2:self.N+1, m])
    
    def _solve_implicit(self, r: float, q: float, sigma: float):
        j = np.arange(1, self.N)
        alpha = 0.5 * self.dt * ((r - q) * j - sigma ** 2 * j ** 2)
        beta = 1 + self.dt * (sigma ** 2 * j ** 2 + r)
        gamma = -0.5 * self.dt * (sigma ** 2 * j ** 2 + (r - q) * j)
        
        A = np.zeros((self.N - 1, self.N - 1))
        for i in range(self.N - 1):
            A[i, i] = beta[i]
            if i > 0:
                A[i, i-1] = alpha[i]
            if i < self.N - 2:
                A[i, i+1] = gamma[i]
        
        for m in range(self.M, 0, -1):
            V_interior = self.V[1:self.N, m].copy()
            
            V_interior[0] -= alpha[0] * self.V[0, m-1]
            V_interior[-1] -= gamma[-1] * self.V[-1, m-1]
            
            self.V[1:self.N, m-1] = linalg.solve(A, V_interior)
    
    def _calculate_greeks(self) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        delta = np.zeros_like(self.V)
        gamma = np.zeros_like(self.V)
        theta = np.zeros_like(self.V)
        
        for m in range(self.M + 1):
            delta[1:-1, m] = (self.V[2:, m] - self.V[:-2, m]) / (2 * self.dS)
            delta[0, m] = (self.V[1, m] - self.V[0, m]) / self.dS
            delta[-1, m] = (self.V[-1, m] - self.V[-2, m]) / self.dS
            
            gamma[1:-1, m] = (self.V[2:, m] - 2 * self.V[1:-1, m] + self.V[:-2, m]) / (self.dS ** 2)
            gamma[0, m] = gamma[1, m]
            gamma[-1, m] = gamma[-2, m]
        
        theta[:, :-1] = -(self.V[:, 1:] - self.V[:, :-1]) / self.dt
        theta[:, -1] = theta[:, -2]
        
        return delta, gamma, theta
    
    def price(self, S0: float, K: float, T: float, r: float, q: float, 
              sigma: float, option_type: str) -> FDMResult:
        
        self._setup_time_grid(T)
        self._setup_boundary_conditions(K, r, q, option_type)
        
        if self.scheme == 'explicit':
            self._solve_explicit(r, q, sigma)
        elif self.scheme == 'implicit':
            self._solve_implicit(r, q, sigma)
        else:
            raise ValueError(f"Unknown scheme: {self.scheme}. Use 'explicit' or 'implicit'.")
        
        delta, gamma, theta = self._calculate_greeks()
        
        S_scaled = self.S * S0
        K_scaled = K * S0
        
        return FDMResult(
            spot_grid=S_scaled,
            time_grid=self.t,
            price_grid=self.V * S0,
            delta_grid=delta,
            gamma_grid=gamma / S0,
            theta_grid=theta * S0
        )
    
    def get_price_at_spot(self, result: FDMResult, S: float, t: float = 0) -> Tuple[float, float, float, float]:
        time_idx = np.argmin(np.abs(result.time_grid - t))
        
        if S <= result.spot_grid[0]:
            idx = 0
            price = result.price_grid[idx, time_idx]
            delta = result.delta_grid[idx, time_idx]
            gamma = result.gamma_grid[idx, time_idx]
            theta = result.theta_grid[idx, time_idx]
        elif S >= result.spot_grid[-1]:
            idx = -1
            price = result.price_grid[idx, time_idx]
            delta = result.delta_grid[idx, time_idx]
            gamma = result.gamma_grid[idx, time_idx]
            theta = result.theta_grid[idx, time_idx]
        else:
            idx = np.searchsorted(result.spot_grid, S) - 1
            S1, S2 = result.spot_grid[idx], result.spot_grid[idx + 1]
            w = (S - S1) / (S2 - S1)
            
            price = (1 - w) * result.price_grid[idx, time_idx] + w * result.price_grid[idx + 1, time_idx]
            delta = (1 - w) * result.delta_grid[idx, time_idx] + w * result.delta_grid[idx + 1, time_idx]
            gamma = (1 - w) * result.gamma_grid[idx, time_idx] + w * result.gamma_grid[idx + 1, time_idx]
            theta = (1 - w) * result.theta_grid[idx, time_idx] + w * result.theta_grid[idx + 1, time_idx]
        
        return price, delta, gamma, theta


def black_scholes_analytical(S: float, K: float, T: float, r: float, 
                             q: float, sigma: float, option_type: str) -> Tuple[float, float, float, float, float]:
    if T <= 0 or sigma <= 0:
        intrinsic = max(0, S - K) if option_type == 'call' else max(0, K - S)
        delta = 1.0 if option_type == 'call' else -1.0
        return intrinsic, delta, 0.0, 0.0, 0.0
    
    d1 = (np.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    if option_type == 'call':
        price = S * np.exp(-q * T) * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        delta = np.exp(-q * T) * norm.cdf(d1)
    else:
        price = K * np.exp(-r * T) * norm.cdf(-d2) - S * np.exp(-q * T) * norm.cdf(-d1)
        delta = -np.exp(-q * T) * norm.cdf(-d1)
    
    gamma = np.exp(-q * T) * norm.pdf(d1) / (S * sigma * np.sqrt(T))
    theta = -np.exp(-q * T) * S * norm.pdf(d1) * sigma / (2 * np.sqrt(T)) \
            - r * K * np.exp(-r * T) * norm.cdf(d2 if option_type == 'call' else -d2) \
            + q * S * np.exp(-q * T) * norm.cdf(d1 if option_type == 'call' else -d1)
    vega = S * np.exp(-q * T) * norm.pdf(d1) * np.sqrt(T)
    
    return price, delta, gamma, theta, vega


def calculate_implied_volatility(S: float, K: float, T: float, r: float, 
                                  q: float, market_price: float, option_type: str,
                                  tol: float = Config.IV_TOLERANCE, 
                                  max_iter: int = Config.IV_MAX_ITERATIONS) -> float:
    if market_price <= 0 or T <= 0:
        return np.nan
    
    intrinsic = max(0, S - K) if option_type == 'call' else max(0, K - S)
    if market_price < intrinsic - 1e-6:
        return np.nan
    
    sigma_low = Config.VOLATILITY_MIN
    sigma_high = Config.VOLATILITY_MAX
    
    price_low, _, _, _, _ = black_scholes_analytical(S, K, T, r, q, sigma_low, option_type)
    price_high, _, _, _, _ = black_scholes_analytical(S, K, T, r, q, sigma_high, option_type)
    
    if price_low > market_price:
        return sigma_low
    if price_high < market_price:
        return sigma_high
    
    for _ in range(max_iter):
        sigma_mid = (sigma_low + sigma_high) / 2
        price_mid, vega, _, _ = black_scholes_analytical_with_vega(S, K, T, r, q, sigma_mid, option_type)
        
        if abs(price_mid - market_price) < tol:
            return sigma_mid
        
        if price_mid < market_price:
            sigma_low = sigma_mid
        else:
            sigma_high = sigma_mid
        
        if vega > 1e-10:
            sigma_new = sigma_mid - (price_mid - market_price) / vega
            sigma_new = max(Config.VOLATILITY_MIN, min(Config.VOLATILITY_MAX, sigma_new))
            price_new, _, _, _, _ = black_scholes_analytical(S, K, T, r, q, sigma_new, option_type)
            
            if abs(price_new - market_price) < abs(price_mid - market_price):
                if price_new < market_price:
                    sigma_low = sigma_new
                else:
                    sigma_high = sigma_new
    
    return (sigma_low + sigma_high) / 2


def black_scholes_analytical_with_vega(S: float, K: float, T: float, r: float, 
                                        q: float, sigma: float, option_type: str) -> Tuple[float, float, float, float]:
    price, delta, gamma, theta, vega = black_scholes_analytical(S, K, T, r, q, sigma, option_type)
    
    if T <= 0 or sigma <= 0:
        vega = 0
    else:
        d1 = (np.log(S / K) + (r - q + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        vega = S * np.exp(-q * T) * norm.pdf(d1) * np.sqrt(T)
    
    return price, vega, delta, gamma
