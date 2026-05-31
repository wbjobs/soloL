import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from config import Config
from market_data import OptionTick
from l2_cache import IVCacheManager

logger = logging.getLogger(__name__)

try:
    import pricing_kernel_cpp as pk
    HAS_CPP_EXTENSION = True
    logger.info("C++ pricing kernel extension loaded successfully")
except ImportError:
    HAS_CPP_EXTENSION = False
    logger.warning("C++ pricing kernel extension not available, falling back to Python implementation")
    from fdm_solver import calculate_implied_volatility


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
    build_time_ms: float = 0.0
    
    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp.isoformat(),
            'underlying_price': self.underlying_price,
            'moneyness_grid': self.moneyness_grid.tolist(),
            'tenor_grid': self.tenor_grid.tolist(),
            'iv_grid': self.iv_grid.tolist(),
            'raw_points': [p.to_dict() for p in self.raw_points],
            'build_time_ms': self.build_time_ms
        }


class OptimizedVolatilitySurfaceBuilder:
    def __init__(self, use_cpp: bool = True, num_threads: int = 4):
        self.use_cpp = use_cpp and HAS_CPP_EXTENSION
        self.num_threads = num_threads
        self.cache_manager = IVCacheManager()
        self.surface_history: List[VolatilitySurface] = []
        
        if self.use_cpp:
            self.iv_calculator = pk.IVCalculator()
            self.rbf_interpolator = pk.RBFInterpolator(
                kernel=pk.KernelType.THIN_PLATE_SPLINE,
                epsilon=1.0
            )
        else:
            self.iv_calculator = None
            self.rbf_interpolator = None
        
        self._build_count = 0
        self._total_build_time_ms = 0.0
    
    def _extract_iv_points_cpp(self, ticks: List[OptionTick]) -> List[VolatilityPoint]:
        if not ticks:
            return []
        
        r = Config.RISK_FREE_RATE
        q = Config.DIVIDEND_YIELD
        
        S_list = []
        K_list = []
        T_list = []
        prices_list = []
        types_list = []
        tick_info = []
        
        for tick in ticks:
            price = tick.mid_price
            if price <= 0:
                continue
            
            cached_iv = self.cache_manager.get_iv(
                tick.underlying_price, tick.strike, tick.time_to_maturity,
                r, q, price, tick.option_type
            )
            
            if cached_iv is not None and cached_iv > 0:
                point = VolatilityPoint(
                    strike=tick.strike,
                    moneyness=tick.moneyness,
                    time_to_maturity=tick.time_to_maturity,
                    implied_volatility=cached_iv,
                    option_type=tick.option_type,
                    market_price=price,
                    volume=tick.volume
                )
                tick_info.append((tick, point, True))
                continue
            
            S_list.append(tick.underlying_price)
            K_list.append(tick.strike)
            T_list.append(tick.time_to_maturity)
            prices_list.append(price)
            types_list.append(ord(tick.option_type[0].upper()))
            tick_info.append((tick, None, False))
        
        points = []
        
        if S_list:
            start = time.perf_counter()
            ivs = self.iv_calculator.batch_calculate(
                S_list, K_list, T_list, prices_list, types_list, r, q, self.num_threads
            )
            calc_time_ms = (time.perf_counter() - start) * 1000
            
            iv_idx = 0
            for tick, cached_point, was_cached in tick_info:
                if was_cached:
                    points.append(cached_point)
                else:
                    iv = ivs[iv_idx]
                    iv_idx += 1
                    
                    if iv > 0:
                        point = VolatilityPoint(
                            strike=tick.strike,
                            moneyness=tick.moneyness,
                            time_to_maturity=tick.time_to_maturity,
                            implied_volatility=iv,
                            option_type=tick.option_type,
                            market_price=tick.mid_price,
                            volume=tick.volume
                        )
                        points.append(point)
                        
                        self.cache_manager.put_iv(
                            tick.underlying_price, tick.strike, tick.time_to_maturity,
                            r, q, tick.mid_price, tick.option_type, iv, calc_time_ms / len(S_list)
                        )
        else:
            for _, cached_point, _ in tick_info:
                points.append(cached_point)
        
        return points
    
    def _extract_iv_points_python(self, ticks: List[OptionTick]) -> List[VolatilityPoint]:
        r = Config.RISK_FREE_RATE
        q = Config.DIVIDEND_YIELD
        
        points = []
        for tick in ticks:
            price = tick.mid_price
            if price <= 0:
                continue
            
            cached_iv = self.cache_manager.get_iv(
                tick.underlying_price, tick.strike, tick.time_to_maturity,
                r, q, price, tick.option_type
            )
            
            if cached_iv is not None and cached_iv > 0:
                point = VolatilityPoint(
                    strike=tick.strike,
                    moneyness=tick.moneyness,
                    time_to_maturity=tick.time_to_maturity,
                    implied_volatility=cached_iv,
                    option_type=tick.option_type,
                    market_price=price,
                    volume=tick.volume
                )
                points.append(point)
                continue
            
            start = time.perf_counter()
            iv = calculate_implied_volatility(
                tick.underlying_price, tick.strike, tick.time_to_maturity,
                r, q, price, tick.option_type
            )
            calc_time_ms = (time.perf_counter() - start) * 1000
            
            if not np.isnan(iv) and iv > 0:
                point = VolatilityPoint(
                    strike=tick.strike,
                    moneyness=tick.moneyness,
                    time_to_maturity=tick.time_to_maturity,
                    implied_volatility=iv,
                    option_type=tick.option_type,
                    market_price=price,
                    volume=tick.volume
                )
                points.append(point)
                
                self.cache_manager.put_iv(
                    tick.underlying_price, tick.strike, tick.time_to_maturity,
                    r, q, price, tick.option_type, iv, calc_time_ms
                )
        
        return points
    
    def _extract_iv_points(self, ticks: List[OptionTick]) -> List[VolatilityPoint]:
        if self.use_cpp:
            return self._extract_iv_points_cpp(ticks)
        else:
            return self._extract_iv_points_python(ticks)
    
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
    
    def _build_surface_rbf_cpp(self, points: List[VolatilityPoint],
                               moneyness_grid: np.ndarray,
                               tenor_grid: np.ndarray) -> np.ndarray:
        if len(points) < 10:
            return None
        
        x = np.array([p.moneyness for p in points], dtype=np.float64)
        y = np.array([p.time_to_maturity for p in points], dtype=np.float64)
        z = np.array([p.implied_volatility for p in points], dtype=np.float64)
        weights = np.array([np.sqrt(p.volume + 1) for p in points], dtype=np.float64)
        
        try:
            self.rbf_interpolator.fit(x.tolist(), y.tolist(), z.tolist(), weights.tolist())
            
            M, T = np.meshgrid(moneyness_grid, tenor_grid)
            xi = M.ravel().tolist()
            yi = T.ravel().tolist()
            
            zi = self.rbf_interpolator.interpolate(xi, yi)
            iv_grid = np.array(zi).reshape(M.shape)
            
            iv_grid = np.clip(iv_grid, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
            
            return iv_grid
        except Exception as e:
            logger.warning(f"RBF interpolation failed: {e}")
            return None
    
    def _build_surface_rbf_python(self, points: List[VolatilityPoint],
                                  moneyness_grid: np.ndarray,
                                  tenor_grid: np.ndarray) -> np.ndarray:
        if len(points) < 10:
            return None
        
        try:
            from scipy.interpolate import RBFInterpolator
            
            x = np.array([p.moneyness for p in points], dtype=np.float64)
            y = np.array([p.time_to_maturity for p in points], dtype=np.float64)
            z = np.array([p.implied_volatility for p in points], dtype=np.float64)
            weights = np.array([np.sqrt(p.volume + 1) for p in points], dtype=np.float64)
            
            coords = np.column_stack([x, y])
            
            unique_coords, unique_indices = np.unique(coords, axis=0, return_index=True)
            if len(unique_indices) < len(coords):
                coords = unique_coords
                z = z[unique_indices]
                weights = weights[unique_indices]
                logger.debug(f"Removed {len(coords) - len(unique_indices)} duplicate points for RBF")
            
            if len(coords) < 10:
                return None
            
            M, T = np.meshgrid(moneyness_grid, tenor_grid)
            xi = np.column_stack([M.ravel(), T.ravel()])
            
            kernel_map = {
                'thin_plate_spline': 'thin_plate_spline',
                'multi_quadric': 'multiquadric',
                'gaussian': 'gaussian',
                'inverse_multi_quadric': 'inverse_multiquadric'
            }
            
            kernel = kernel_map.get(Config.RBF_KERNEL, 'thin_plate_spline')
            epsilon = 1.0
            
            for regularization in [0.0, 1e-8, 1e-6, 1e-4]:
                try:
                    try:
                        rbf = RBFInterpolator(
                            coords, z, 
                            kernel=kernel,
                            epsilon=epsilon,
                            weights=weights,
                            smoothing=regularization
                        )
                    except TypeError:
                        try:
                            rbf = RBFInterpolator(
                                coords, z, 
                                kernel=kernel,
                                epsilon=epsilon,
                                smoothing=regularization
                            )
                        except TypeError:
                            rbf = RBFInterpolator(
                                coords, z, 
                                kernel=kernel,
                                epsilon=epsilon
                            )
                    
                    zi = rbf(xi)
                    iv_grid = np.array(zi).reshape(M.shape)
                    iv_grid = np.clip(iv_grid, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
                    
                    if regularization > 0:
                        logger.debug(f"RBF succeeded with regularization={regularization}")
                    
                    return iv_grid
                    
                except Exception as e:
                    if regularization == 0:
                        logger.debug(f"RBF failed without regularization, trying with regularization...")
                    elif regularization < 1e-4:
                        continue
                    else:
                        raise e
            
            return None
        except Exception as e:
            logger.warning(f"Python RBF interpolation failed: {e}")
            return None
    
    def _build_surface_spline_parallel(self, points: List[VolatilityPoint],
                                        moneyness_grid: np.ndarray,
                                        tenor_grid: np.ndarray) -> np.ndarray:
        unique_tenors = np.unique([p.time_to_maturity for p in points])
        
        def process_tenor(tenor):
            tenor_points = [p for p in points if abs(p.time_to_maturity - tenor) < 5/365]
            if len(tenor_points) < 4:
                return None, tenor
            
            tenor_points.sort(key=lambda p: p.moneyness)
            moneyness = np.array([p.moneyness for p in tenor_points])
            ivs = np.array([p.implied_volatility for p in tenor_points])
            weights = np.array([np.sqrt(p.volume + 1) for p in tenor_points])
            
            try:
                from scipy.interpolate import CubicSpline
                sorted_indices = np.argsort(moneyness)
                moneyness_sorted = moneyness[sorted_indices]
                ivs_sorted = ivs[sorted_indices]
                weights_sorted = weights[sorted_indices]
                
                unique_money, unique_idx = np.unique(moneyness_sorted, return_index=True)
                if len(unique_money) < 4:
                    return None, tenor
                
                unique_ivs = ivs_sorted[unique_idx]
                
                cs = CubicSpline(unique_money, unique_ivs, bc_type='natural')
                interpolated = cs(moneyness_grid)
                interpolated = np.clip(interpolated, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
                
                return interpolated, tenor
            except Exception as e:
                logger.warning(f"Spline failed for tenor {tenor}: {e}")
                return None, tenor
        
        smile_curves = {}
        
        with ThreadPoolExecutor(max_workers=min(self.num_threads, len(unique_tenors))) as executor:
            futures = [executor.submit(process_tenor, t) for t in unique_tenors]
            for future in as_completed(futures):
                curve, tenor = future.result()
                if curve is not None:
                    smile_curves[tenor] = curve
        
        if len(smile_curves) < 2:
            return None
        
        iv_grid = np.zeros((len(tenor_grid), len(moneyness_grid)))
        available_tenors = sorted(smile_curves.keys())
        
        for i, target_tenor in enumerate(tenor_grid):
            if target_tenor in smile_curves:
                iv_grid[i, :] = smile_curves[target_tenor]
                continue
            
            lower = [t for t in available_tenors if t <= target_tenor]
            upper = [t for t in available_tenors if t >= target_tenor]
            
            if not lower and upper:
                iv_grid[i, :] = smile_curves[upper[0]]
            elif lower and not upper:
                iv_grid[i, :] = smile_curves[lower[-1]]
            else:
                t1, t2 = lower[-1], upper[0]
                w = (target_tenor - t1) / (t2 - t1) if t1 != t2 else 0
                iv_grid[i, :] = (1 - w) * smile_curves[t1] + w * smile_curves[t2]
        
        return iv_grid
    
    def _create_default_surface(self, timestamp: datetime, underlying_price: float,
                                 points: List[VolatilityPoint],
                                 moneyness_grid: np.ndarray,
                                 tenor_grid: np.ndarray) -> np.ndarray:
        M, T = np.meshgrid(moneyness_grid, tenor_grid)
        atm_vol = 0.2
        if points:
            atm_vol = np.median([p.implied_volatility for p in points])
        
        smile = 0.08 * (M - 1.0) ** 2
        term = 0.03 * np.exp(-T * 4)
        skew = -0.05 * (M - 1.0)
        
        iv_grid = atm_vol + smile + skew + term
        iv_grid = np.clip(iv_grid, Config.VOLATILITY_MIN, Config.VOLATILITY_MAX)
        
        return iv_grid
    
    def build_surface(self, ticks: List[OptionTick], timestamp: datetime = None) -> VolatilitySurface:
        start_time = time.perf_counter()
        
        if timestamp is None:
            timestamp = datetime.now()
        
        underlying_price = ticks[0].underlying_price if ticks else 4.0
        moneyness_grid = Config.MONEYNESS_RANGE
        tenor_grid = Config.TENORS
        
        iv_points = self._extract_iv_points(ticks)
        iv_points = self._filter_outliers(iv_points)
        
        iv_grid = None
        use_rbf = Config.SURFACE_BUILDER.lower() == "rbf"
        
        if use_rbf and len(iv_points) >= 10:
            if self.use_cpp:
                iv_grid = self._build_surface_rbf_cpp(iv_points, moneyness_grid, tenor_grid)
            else:
                iv_grid = self._build_surface_rbf_python(iv_points, moneyness_grid, tenor_grid)
            
            if iv_grid is None:
                iv_grid = self._build_surface_spline_parallel(iv_points, moneyness_grid, tenor_grid)
        elif len(iv_points) >= 5:
            iv_grid = self._build_surface_spline_parallel(iv_points, moneyness_grid, tenor_grid)
        else:
            iv_grid = None
        
        if iv_grid is None:
            iv_grid = self._create_default_surface(timestamp, underlying_price, iv_points, moneyness_grid, tenor_grid)
        
        build_time_ms = (time.perf_counter() - start_time) * 1000
        self._build_count += 1
        self._total_build_time_ms += build_time_ms
        
        surface = VolatilitySurface(
            timestamp=timestamp,
            underlying_price=underlying_price,
            moneyness_grid=moneyness_grid,
            tenor_grid=tenor_grid,
            iv_grid=iv_grid,
            raw_points=iv_points,
            build_time_ms=build_time_ms
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
    
    def stats(self) -> Dict:
        avg_build_time = self._total_build_time_ms / self._build_count if self._build_count > 0 else 0
        
        return {
            'use_cpp_extension': self.use_cpp,
            'num_threads': self.num_threads,
            'build_count': self._build_count,
            'avg_build_time_ms': avg_build_time,
            'total_build_time_ms': self._total_build_time_ms,
            'cache_stats': self.cache_manager.stats(),
            'history_length': len(self.surface_history)
        }
    
    def clear_cache(self) -> None:
        self.cache_manager.clear()


class OptimizedOptionPricer:
    def __init__(self, use_cpp: bool = True):
        self.use_cpp = use_cpp and HAS_CPP_EXTENSION
        self.vol_builder = OptimizedVolatilitySurfaceBuilder(use_cpp=use_cpp)
        
        if self.use_cpp:
            self.fdm_config = pk.FDMConfig()
            self.fdm_config.spot_min = Config.FDM_SPOT_MIN
            self.fdm_config.spot_max = Config.FDM_SPOT_MAX
            self.fdm_config.spot_points = 100
            self.fdm_config.time_points = 200
            self.fdm_config.scheme = 1
    
    def price_option(self, S: float, K: float, T: float, r: float, q: float,
                     option_type: str, surface: VolatilitySurface = None,
                     use_fdm: bool = False) -> Dict:
        moneyness = K / S
        
        if surface is not None:
            sigma = self.vol_builder.get_iv_at_point(surface, moneyness, T)
        else:
            sigma = 0.2
        
        if self.use_cpp and use_fdm:
            fdm_solver = pk.FDMBlackScholes(self.fdm_config)
            price_grid, delta_grid, gamma_grid = fdm_solver.solve(
                1.0, K/S, T, r, q, sigma, ord(option_type[0].upper())
            )
            price = fdm_solver.get_price_at_spot(price_grid.tolist(), 1.0, S)
            
            S_idx = np.argmin(np.abs(np.linspace(Config.FDM_SPOT_MIN, Config.FDM_SPOT_MAX, 101) - 1.0))
            delta = delta_grid[S_idx] if S_idx < len(delta_grid) else 0.0
            gamma = gamma_grid[S_idx] if S_idx < len(gamma_grid) else 0.0
            
            params = pk.OptionParams()
            params.S = S
            params.K = K
            params.T = T
            params.r = r
            params.q = q
            params.sigma = sigma
            params.option_type = ord(option_type[0].upper())
            greeks = pk.black_scholes(params)
            
            method = 'FDM (C++)'
            
            return {
                'price': float(price),
                'delta': float(delta),
                'gamma': float(gamma),
                'theta': float(greeks.theta),
                'vega': float(greeks.vega),
                'implied_volatility': float(sigma),
                'moneyness': moneyness,
                'pricing_method': method
            }
        
        elif self.use_cpp:
            params = pk.OptionParams()
            params.S = S
            params.K = K
            params.T = T
            params.r = r
            params.q = q
            params.sigma = sigma
            params.option_type = ord(option_type[0].upper())
            
            greeks = pk.black_scholes(params)
            
            return {
                'price': float(greeks.price),
                'delta': float(greeks.delta),
                'gamma': float(greeks.gamma),
                'theta': float(greeks.theta),
                'vega': float(greeks.vega),
                'implied_volatility': float(sigma),
                'moneyness': moneyness,
                'pricing_method': 'Analytical (C++)'
            }
        
        else:
            from fdm_solver import black_scholes_analytical, BlackScholesFDM, FDMConfig
            
            if use_fdm:
                fdm_config = FDMConfig(spot_points=100, time_points=200)
                fdm = BlackScholesFDM(fdm_config)
                result = fdm.price(1.0, K/S, T, r, q, sigma, option_type)
                price_norm, delta, gamma, theta = fdm.get_price_at_spot(result, 1.0)
                price = price_norm * S
                
                _, _, _, _, vega = black_scholes_analytical(S, K, T, r, q, sigma, option_type)
                method = 'FDM (Python)'
            else:
                price, delta, gamma, theta, vega = black_scholes_analytical(S, K, T, r, q, sigma, option_type)
                method = 'Analytical (Python)'
            
            return {
                'price': float(price),
                'delta': float(delta),
                'gamma': float(gamma),
                'theta': float(theta),
                'vega': float(vega),
                'implied_volatility': float(sigma),
                'moneyness': moneyness,
                'pricing_method': method
            }
