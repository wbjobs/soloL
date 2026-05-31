import numpy as np
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
from collections import deque
import logging
import hashlib

from market_data import OptionTick

logger = logging.getLogger(__name__)


@dataclass
class DownsampleConfig:
    window_size_ms: int = 100
    max_points_per_window: int = 5
    enable_extrema_preservation: bool = True
    enable_volume_weighted: bool = True
    min_ticks_for_downsample: int = 50
    target_output_rate: int = 50


@dataclass
class WindowStats:
    window_start: datetime
    window_end: datetime
    tick_count: int
    min_price: float
    max_price: float
    avg_price: float
    vwap: float
    total_volume: int


class TickDownsampler:
    def __init__(self, config: DownsampleConfig = None):
        self.config = config or DownsampleConfig()
        self._tick_buffer: deque = deque()
        self._last_window_time: Optional[datetime] = None
        self._current_window_ticks: List[OptionTick] = []
        self._downsampled_count = 0
        self._original_count = 0
    
    def process(self, ticks: List[OptionTick]) -> List[OptionTick]:
        self._original_count += len(ticks)
        
        if len(ticks) < self.config.min_ticks_for_downsample:
            return ticks
        
        grouped = self._group_by_option(ticks)
        result = []
        
        for option_key, option_ticks in grouped.items():
            downsampled = self._downsample_option(option_ticks)
            result.extend(downsampled)
        
        self._downsampled_count += len(result)
        return result
    
    def _group_by_option(self, ticks: List[OptionTick]) -> Dict[str, List[OptionTick]]:
        groups: Dict[str, List[OptionTick]] = {}
        
        for tick in ticks:
            key = f"{tick.option_type}_{tick.strike}_{tick.maturity.isoformat()}"
            if key not in groups:
                groups[key] = []
            groups[key].append(tick)
        
        return groups
    
    def _downsample_option(self, ticks: List[OptionTick]) -> List[OptionTick]:
        if len(ticks) <= self.config.max_points_per_window:
            return ticks
        
        if self.config.enable_extrema_preservation:
            return self._extrema_preserving_downsample(ticks)
        else:
            return self._time_window_downsample(ticks)
    
    def _time_window_downsample(self, ticks: List[OptionTick]) -> List[OptionTick]:
        if not ticks:
            return []
        
        ticks_sorted = sorted(ticks, key=lambda t: t.timestamp)
        
        result = []
        window_start = ticks_sorted[0].timestamp
        window_ticks: List[OptionTick] = []
        
        for tick in ticks_sorted:
            delta = (tick.timestamp - window_start).total_seconds() * 1000
            
            if delta >= self.config.window_size_ms:
                if window_ticks:
                    representative = self._select_representative(window_ticks)
                    result.append(representative)
                window_start = tick.timestamp
                window_ticks = []
            
            window_ticks.append(tick)
        
        if window_ticks:
            representative = self._select_representative(window_ticks)
            result.append(representative)
        
        return result
    
    def _extrema_preserving_downsample(self, ticks: List[OptionTick]) -> List[OptionTick]:
        if len(ticks) <= self.config.max_points_per_window * 2:
            return ticks
        
        ticks_sorted = sorted(ticks, key=lambda t: t.timestamp)
        
        prices = np.array([t.mid_price for t in ticks_sorted])
        volumes = np.array([t.volume for t in ticks_sorted])
        
        result_indices = set()
        result_indices.add(0)
        result_indices.add(len(ticks_sorted) - 1)
        
        max_idx = int(np.argmax(prices))
        min_idx = int(np.argmin(prices))
        result_indices.add(max_idx)
        result_indices.add(min_idx)
        
        max_vol_idx = int(np.argmax(volumes))
        result_indices.add(max_vol_idx)
        
        step = max(1, len(ticks_sorted) // (self.config.max_points_per_window - 4))
        for i in range(step, len(ticks_sorted) - 1, step):
            result_indices.add(i)
        
        if len(result_indices) > self.config.max_points_per_window * 2:
            result_indices = self._filter_by_importance(
                result_indices, prices, volumes, self.config.max_points_per_window
            )
        
        result = [ticks_sorted[i] for i in sorted(result_indices)]
        return result
    
    def _filter_by_importance(self, indices: set, prices: np.ndarray, 
                              volumes: np.ndarray, max_points: int) -> set:
        idx_list = sorted(indices)
        if len(idx_list) <= max_points:
            return indices
        
        importances = []
        for i, idx in enumerate(idx_list[1:-1], 1):
            prev = idx_list[i-1]
            next_idx = idx_list[i+1]
            
            price_change = abs(prices[idx] - (prices[prev] + prices[next_idx]) / 2)
            volume_score = volumes[idx] if idx < len(volumes) else 0
            
            importance = price_change * (1 + volume_score * 0.001)
            importances.append((importance, idx))
        
        importances.sort(reverse=True)
        keep_indices = {idx_list[0], idx_list[-1]}
        
        for _, idx in importances[:max_points-2]:
            keep_indices.add(idx)
        
        return keep_indices
    
    def _select_representative(self, ticks: List[OptionTick]) -> OptionTick:
        if not ticks:
            raise ValueError("No ticks to select from")
        
        if len(ticks) == 1:
            return ticks[0]
        
        if self.config.enable_volume_weighted and any(t.volume > 0 for t in ticks):
            return self._vwap_representative(ticks)
        else:
            return self._mid_representative(ticks)
    
    def _vwap_representative(self, ticks: List[OptionTick]) -> OptionTick:
        total_volume = sum(t.volume for t in ticks)
        if total_volume == 0:
            return self._mid_representative(ticks)
        
        vwap_price = sum(t.mid_price * t.volume for t in ticks) / total_volume
        vwap_bid = sum(t.bid_price * t.volume for t in ticks) / total_volume
        vwap_ask = sum(t.ask_price * t.volume for t in ticks) / total_volume
        total_vol = total_volume
        total_oi = sum(t.open_interest for t in ticks)
        
        mid_tick = ticks[len(ticks) // 2]
        
        return OptionTick(
            timestamp=ticks[-1].timestamp,
            symbol=mid_tick.symbol,
            underlying_price=mid_tick.underlying_price,
            strike=mid_tick.strike,
            maturity=mid_tick.maturity,
            option_type=mid_tick.option_type,
            bid_price=vwap_bid,
            ask_price=vwap_ask,
            last_price=vwap_price,
            volume=total_vol,
            open_interest=total_oi
        )
    
    def _mid_representative(self, ticks: List[OptionTick]) -> OptionTick:
        prices = np.array([t.mid_price for t in ticks])
        mid_idx = len(ticks) // 2
        
        return OptionTick(
            timestamp=ticks[-1].timestamp,
            symbol=ticks[mid_idx].symbol,
            underlying_price=ticks[mid_idx].underlying_price,
            strike=ticks[mid_idx].strike,
            maturity=ticks[mid_idx].maturity,
            option_type=ticks[mid_idx].option_type,
            bid_price=np.mean([t.bid_price for t in ticks]),
            ask_price=np.mean([t.ask_price for t in ticks]),
            last_price=np.mean(prices),
            volume=sum(t.volume for t in ticks),
            open_interest=sum(t.open_interest for t in ticks)
        )
    
    def get_window_stats(self, ticks: List[OptionTick]) -> WindowStats:
        if not ticks:
            raise ValueError("No ticks for stats")
        
        prices = np.array([t.mid_price for t in ticks])
        volumes = np.array([t.volume for t in ticks])
        total_volume = volumes.sum()
        
        if total_volume > 0:
            vwap = (prices * volumes).sum() / total_volume
        else:
            vwap = prices.mean()
        
        return WindowStats(
            window_start=ticks[0].timestamp,
            window_end=ticks[-1].timestamp,
            tick_count=len(ticks),
            min_price=prices.min(),
            max_price=prices.max(),
            avg_price=prices.mean(),
            vwap=vwap,
            total_volume=total_volume
        )
    
    def get_tick_hash(self, ticks: List[OptionTick]) -> str:
        if not ticks:
            return "empty"
        
        key_data = []
        for tick in sorted(ticks, key=lambda t: t.symbol):
            key_data.append(
                f"{tick.symbol}:{tick.mid_price:.4f}:{tick.volume}"
            )
        
        raw_key = "|".join(key_data)
        return hashlib.md5(raw_key.encode()).hexdigest()
    
    def stats(self) -> Dict:
        compression_ratio = (
            (1 - self._downsampled_count / self._original_count) * 100
            if self._original_count > 0 else 0.0
        )
        
        return {
            'original_ticks': self._original_count,
            'downsampled_ticks': self._downsampled_count,
            'compression_ratio_percent': compression_ratio,
            'config': {
                'window_size_ms': self.config.window_size_ms,
                'max_points_per_window': self.config.max_points_per_window,
                'enable_extrema_preservation': self.config.enable_extrema_preservation,
                'enable_volume_weighted': self.config.enable_volume_weighted
            }
        }
    
    def reset(self) -> None:
        self._tick_buffer.clear()
        self._last_window_time = None
        self._current_window_ticks = []
        self._downsampled_count = 0
        self._original_count = 0
