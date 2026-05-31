import numpy as np
from scipy.interpolate import CubicSpline, interp2d, griddata
from scipy.interpolate import RBFInterpolator
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging
import pandas as pd

from config import Config
from fdm_solver import calculate_implied_volatility, black_scholes_analytical
from market_data import OptionTick

logger = logging.getLogger(__name__)


@dataclass
class VolatilityPoint:
    strike: float
    moneyness: float
    time_to_maturity: float
    implied_volatility: float
    option_type: str
    market_price: float
    volume: int
    
    def to_dict(self) -> Dict:
        return {
            'strike': self.strike,
            'moneyness': self.moneyness,
            'time_to_maturity': self.time_to_maturity,
            'implied_volatility': self.implied_volatility,
            'option_type': self.option_type,
            'market_price': self.market_price,
            'volume': self.volume
        }


@dataclass
class VolatilitySurface:
    timestamp: datetime
    underlying_price: float
    moneyness_grid: np.ndarray
    tenor_grid: np.ndarray
    iv_grid: np.ndarray
    raw_points: List[VolatilityPoint] = field(default_factory=list)
    interpolator: Optional[object] = None
    
    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp.isoformat(),
            'underlying_price': self.underlying_price,
            'moneyness_grid': self.moneyness_grid.tolist(),
            'tenor_grid': self.tenor_grid.tolist(),
            'iv_grid': self.iv_grid.tolist(),
            'raw_points': [p.to_dict() for p in self.raw_points]
        }


class VolatilitySurfaceBuilder:
    def __init__(self):
        self.fdm_solver = None
        self.surface_history: List[VolatilitySurface] = []
        
    def _extract_iv_points(self, ticks: List[OptionTick]) -> List[VolatilityPoint]:
        points = []
        r = Config.RISK_FREE_RATE
        q = Config.DIVIDEND_YIELD
        
        for tick in ticks:
            S = tick.underlying_price
            K = tick.strike
            T = tick.time_to_maturity
            price = tick.mid_price
            opt_type = tick.option_type
            
            if price <= 0:
                continue
            
            iv = calculate_implied_volatility(S, K, T, r, q, price, opt_type)
            
            if not np.isnan(iv) and iv > 0:
                point = VolatilityPoint(
                    strike=K,
                    moneyness=tick.moneyness,
                    time_to_maturity=T,
                    implied_volatility=iv,
                    option_type=opt_type,
                    market_price=price,
                    volume=tick.volume
                )
                points.append(point)
        
        return points
    
    def _filter_outliers(self, points: List[VolatilityPoint]) -> List[VolatilityPoint]:
        if len(points) < 4:
            return points
        
        ivs = np.array([p.implied_volatility for p in points])
        median = np.median(ivs)
        mad = np.median(np.abs(ivs - median))
        
        if mad == 0:
            return points
        
        threshold = 5 * mad
        filtered = []
        for p in points:
            if abs(p.implied_volatility - median) < threshold:
                filtered.append(p)
        
        return filtered
    
    def _build_smile_curve(self, points: List[VolatilityPoint], tenor: float, 
                            moneyness_grid: np.ndarray) -> Optional[np.ndarray]:
        tenor_points = [p for p in points if abs(p.time_to_maturity - tenor) < 5/365]
        
        if len(tenor_points) < 4:
            return None
        
        tenor_points.sort(key=lambda p: p.moneyness)
        
        moneyness = np.array([p.moneyness for p in tenor_points])
        ivs = np.array([p.implied_volatility for p in tenor_points])
        
        weights = np.array([np.sqrt(p.volume + 1) for p in tenor_points])
        
        try:
            sorted_indices = np.argsort(moneyness)
            moneyness_sorted = moneyness[sorted_indices]
            ivs_sorted = ivs[sorted_indices]
            weights_sorted = weights[sorted_indices]
            
            unique_moneyness, unique_indices = np.unique(moneyness_sorted, return_index=True)
            if len(unique_moneyness) < 4:
                return None
            
            unique_ivs = ivs_sorted[unique_indices]
            unique_weights = weights_sorted[unique_indices]
            
            cs = CubicSpline(unique_moneyness, unique_ivs, bc_type='natural')
            interpolated_ivs = cs(moneyness_grid)
            
            interpolated_ivs = np.clip(interpolated_ivs, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
            
            return interpolated_ivs
            
        except Exception as e:
            logger.warning(f"Cubic spline interpolation failed for tenor {tenor}: {e}")
            return None
    
    def _interpolate_along_tenor(self, smile_curves: Dict[float, np.ndarray], 
                                  moneyness_grid: np.ndarray, 
                                  tenor_grid: np.ndarray) -> np.ndarray:
        iv_grid = np.zeros((len(tenor_grid), len(moneyness_grid)))
        
        available_tenors = sorted(smile_curves.keys())
        
        if len(available_tenors) == 0:
            return np.full_like(iv_grid, 0.2)
        
        for i, target_tenor in enumerate(tenor_grid):
            if target_tenor in smile_curves:
                iv_grid[i, :] = smile_curves[target_tenor]
                continue
            
            lower_tenors = [t for t in available_tenors if t <= target_tenor]
            upper_tenors = [t for t in available_tenors if t >= target_tenor]
            
            if not lower_tenors and upper_tenors:
                nearest = upper_tenors[0]
                iv_grid[i, :] = smile_curves[nearest]
            elif lower_tenors and not upper_tenors:
                nearest = lower_tenors[-1]
                iv_grid[i, :] = smile_curves[nearest]
            else:
                t1 = lower_tenors[-1]
                t2 = upper_tenors[0]
                if t1 == t2:
                    iv_grid[i, :] = smile_curves[t1]
                else:
                    w = (target_tenor - t1) / (t2 - t1)
                    iv_grid[i, :] = (1 - w) * smile_curves[t1] + w * smile_curves[t2]
        
        return iv_grid
    
    def _rbf_interpolation(self, points: List[VolatilityPoint], 
                           moneyness_grid: np.ndarray, 
                           tenor_grid: np.ndarray) -> np.ndarray:
        if len(points) < 10:
            return None
        
        moneyness = np.array([p.moneyness for p in points])
        tenors = np.array([p.time_to_maturity for p in points])
        ivs = np.array([p.implied_volatility for p in points])
        weights = np.array([np.sqrt(p.volume + 1) for p in points])
        
        coords = np.column_stack([moneyness, tenors])
        
        try:
            rbf = RBFInterpolator(coords, ivs, weights=weights, kernel='thin_plate_spline', smoothing=1e-4)
            
            M, K = np.meshgrid(moneyness_grid, tenor_grid)
            grid_coords = np.column_stack([M.ravel(), K.ravel()])
            
            iv_flat = rbf(grid_coords)
            iv_grid = iv_flat.reshape(M.shape)
            
            iv_grid = np.clip(iv_grid, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
            
            return iv_grid
        except Exception as e:
            logger.warning(f"RBF interpolation failed: {e}")
            return None
    
    def build_surface(self, ticks: List[OptionTick], timestamp: datetime = None) -> VolatilitySurface:
        if timestamp is None:
            timestamp = datetime.now()
        
        underlying_price = ticks[0].underlying_price if ticks else 4.0
        
        iv_points = self._extract_iv_points(ticks)
        iv_points = self._filter_outliers(iv_points)
        
        if len(iv_points) < 5:
            return self._create_default_surface(timestamp, underlying_price, iv_points)
        
        moneyness_grid = Config.MONEYNESS_RANGE
        tenor_grid = Config.TENORS
        
        smile_curves = {}
        unique_tenors = np.unique([p.time_to_maturity for p in iv_points])
        
        for tenor in unique_tenors:
            curve = self._build_smile_curve(iv_points, tenor, moneyness_grid)
            if curve is not None:
                smile_curves[tenor] = curve
        
        if len(smile_curves) >= 2:
            iv_grid = self._interpolate_along_tenor(smile_curves, moneyness_grid, tenor_grid)
        else:
            iv_grid = self._rbf_interpolation(iv_points, moneyness_grid, tenor_grid)
            if iv_grid is None:
                return self._create_default_surface(timestamp, underlying_price, iv_points)
        
        surface = VolatilitySurface(
            timestamp=timestamp,
            underlying_price=underlying_price,
            moneyness_grid=moneyness_grid,
            tenor_grid=tenor_grid,
            iv_grid=iv_grid,
            raw_points=iv_points
        )
        
        self.surface_history.append(surface)
        if len(self.surface_history) > Config.HISTORY_LENGTH:
            self.surface_history = self.surface_history[-Config.HISTORY_LENGTH:]
        
        return surface
    
    def _create_default_surface(self, timestamp: datetime, underlying_price: float, 
                                 points: List[VolatilityPoint]) -> VolatilitySurface:
        moneyness_grid = Config.MONEYNESS_RANGE
        tenor_grid = Config.TENORS
        
        M, T = np.meshgrid(moneyness_grid, tenor_grid)
        atm_vol = 0.2
        if points:
            atm_vol = np.median([p.implied_volatility for p in points])
        
        smile = 0.08 * (M - 1.0) ** 2
        term = 0.03 * np.exp(-T * 4)
        skew = -0.05 * (M - 1.0)
        
        iv_grid = atm_vol + smile + skew + term
        iv_grid = np.clip(iv_grid, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
        
        surface = VolatilitySurface(
            timestamp=timestamp,
            underlying_price=underlying_price,
            moneyness_grid=moneyness_grid,
            tenor_grid=tenor_grid,
            iv_grid=iv_grid,
            raw_points=points
        )
        
        self.surface_history.append(surface)
        if len(self.surface_history) > Config.HISTORY_LENGTH:
            self.surface_history = self.surface_history[-Config.HISTORY_LENGTH:]
        
        return surface
    
    def get_iv_at_point(self, surface: VolatilitySurface, moneyness: float, 
                        time_to_maturity: float) -> float:
        m_idx = np.argmin(np.abs(surface.moneyness_grid - moneyness))
        t_idx = np.argmin(np.abs(surface.tenor_grid - time_to_maturity))
        return surface.iv_grid[t_idx, m_idx]
    
    def get_history(self) -> List[Dict]:
        return [s.to_dict() for s in self.surface_history]
    
    def get_surface_at_index(self, index: int) -> Optional[VolatilitySurface]:
        if 0 <= index < len(self.surface_history):
            return self.surface_history[index]
        return None


class OptionPricer:
    def __init__(self):
        self.vol_builder = VolatilitySurfaceBuilder()
    
    def price_option(self, S: float, K: float, T: float, r: float, q: float,
                     option_type: str, surface: VolatilitySurface = None,
                     use_fdm: bool = False) -> Dict:
        moneyness = K / S
        
        if surface is not None:
            sigma = self.vol_builder.get_iv_at_point(surface, moneyness, T)
        else:
            sigma = 0.2
        
        if use_fdm:
            from fdm_solver import BlackScholesFDM, FDMConfig
            fdm_config = FDMConfig(scheme='implicit')
            fdm = BlackScholesFDM(fdm_config)
            result = fdm.price(1.0, K/S, T, r, q, sigma, option_type)
            price, delta, gamma, theta = fdm.get_price_at_spot(result, S)
        else:
            price, delta, gamma, theta, _ = black_scholes_analytical(S, K, T, r, q, sigma, option_type)
        
        return {
            'price': price,
            'delta': delta,
            'gamma': gamma,
            'theta': theta,
            'vega': self._calculate_vega(S, K, T, r, q, sigma, option_type),
            'implied_volatility': sigma,
            'moneyness': moneyness,
            'pricing_method': 'FDM' if use_fdm else 'Analytical'
        }
    
    def _calculate_vega(self, S: float, K: float, T: float, r: float, q: float,
                        sigma: float, option_type: str) -> float:
        from fdm_solver import black_scholes_analytical_with_vega
        _, vega, _, _ = black_scholes_analytical_with_vega(S, K, T, r, q, sigma, option_type)
        return vega
