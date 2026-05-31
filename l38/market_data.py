import asyncio
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from dataclasses import dataclass, field
import json
import logging

from config import Config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@dataclass
class OptionTick:
    timestamp: datetime
    symbol: str
    underlying_price: float
    strike: float
    maturity: datetime
    option_type: str
    bid_price: float
    ask_price: float
    last_price: float
    volume: int
    open_interest: int
    
    @property
    def mid_price(self) -> float:
        if self.bid_price > 0 and self.ask_price > 0:
            return (self.bid_price + self.ask_price) / 2
        return self.last_price
    
    @property
    def time_to_maturity(self) -> float:
        delta = self.maturity - self.timestamp
        return max(delta.days / 365.0, 1/365)
    
    @property
    def moneyness(self) -> float:
        return self.strike / self.underlying_price
    
    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp.isoformat(),
            'symbol': self.symbol,
            'underlying_price': self.underlying_price,
            'strike': self.strike,
            'maturity': self.maturity.isoformat(),
            'option_type': self.option_type,
            'bid_price': self.bid_price,
            'ask_price': self.ask_price,
            'last_price': self.last_price,
            'volume': self.volume,
            'open_interest': self.open_interest,
            'mid_price': self.mid_price,
            'time_to_maturity': self.time_to_maturity,
            'moneyness': self.moneyness
        }


class MockOptionDataGenerator:
    def __init__(self):
        self.base_price = 4.0
        self.volatility = 0.2
        self.strikes = np.array([3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6])
        self.option_types = ['call', 'put']
        self.price_history = [self.base_price]
        self.tick_count = 0
        
    def generate_maturities(self) -> List[datetime]:
        now = datetime.now()
        return [
            now + timedelta(days=7),
            now + timedelta(days=14),
            now + timedelta(days=30),
            now + timedelta(days=60),
            now + timedelta(days=90),
            now + timedelta(days=180),
        ]
    
    def _generate_smile_volatility(self, moneyness: float, tenor: float) -> float:
        atm_vol = 0.2 + 0.05 * np.sin(self.tick_count * 0.01)
        smile = 0.08 * (moneyness - 1.0) ** 2
        term = 0.03 * np.exp(-tenor * 4)
        skew = -0.05 * (moneyness - 1.0)
        vol = atm_vol + smile + skew + term
        return max(0.05, min(0.8, vol))
    
    def _black_scholes_price(self, S: float, K: float, T: float, r: float, sigma: float, option_type: str) -> float:
        from scipy.stats import norm
        if T <= 0:
            return max(0, S - K) if option_type == 'call' else max(0, K - S)
        
        d1 = (np.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * np.sqrt(T))
        d2 = d1 - sigma * np.sqrt(T)
        
        if option_type == 'call':
            return S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
        else:
            return K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    
    def generate_tick(self) -> List[OptionTick]:
        self.tick_count += 1
        
        dp = np.random.normal(0, 0.01) * self.base_price
        self.base_price = max(3.0, min(5.0, self.base_price + dp))
        self.price_history.append(self.base_price)
        
        underlying_price = self.base_price
        now = datetime.now()
        maturities = self.generate_maturities()
        r = Config.RISK_FREE_RATE
        
        ticks = []
        for maturity in maturities:
            T = max((maturity - now).days / 365.0, 1/365)
            for opt_type in self.option_types:
                for strike in self.strikes:
                    moneyness = strike / underlying_price
                    sigma = self._generate_smile_volatility(moneyness, T)
                    theoretical_price = self._black_scholes_price(
                        underlying_price, strike, T, r, sigma, opt_type
                    )
                    
                    spread = max(0.01, theoretical_price * 0.01)
                    bid = round(theoretical_price - spread/2 + np.random.normal(0, 0.005), 2)
                    ask = round(theoretical_price + spread/2 + np.random.normal(0, 0.005), 2)
                    last = round(theoretical_price + np.random.normal(0, 0.01), 2)
                    
                    symbol = f"{Config.UNDERLYING_SYMBOL}_{opt_type}_{strike}_{maturity.strftime('%Y%m%d')}"
                    
                    tick = OptionTick(
                        timestamp=now,
                        symbol=symbol,
                        underlying_price=underlying_price,
                        strike=strike,
                        maturity=maturity,
                        option_type=opt_type,
                        bid_price=max(0.01, bid),
                        ask_price=max(0.01, ask),
                        last_price=max(0.01, last),
                        volume=int(np.random.exponential(50)),
                        open_interest=int(np.random.exponential(1000))
                    )
                    ticks.append(tick)
        
        return ticks


class MarketDataManager:
    def __init__(self):
        self.mock_generator = MockOptionDataGenerator()
        self.current_ticks: List[OptionTick] = []
        self.tick_history: List[List[OptionTick]] = []
        self.underlying_history: List[Dict] = []
        self.callbacks: List[Callable] = []
        self._running = False
        
    def subscribe(self, callback: Callable[[List[OptionTick]], None]):
        self.callbacks.append(callback)
    
    def unsubscribe(self, callback: Callable):
        if callback in self.callbacks:
            self.callbacks.remove(callback)
    
    async def _mock_data_loop(self):
        logger.info("Starting mock data generator")
        while self._running:
            try:
                ticks = self.mock_generator.generate_tick()
                self.current_ticks = ticks
                self.tick_history.append(ticks)
                self.underlying_history.append({
                    'timestamp': ticks[0].timestamp.isoformat(),
                    'price': ticks[0].underlying_price
                })
                
                if len(self.tick_history) > Config.HISTORY_LENGTH:
                    self.tick_history = self.tick_history[-Config.HISTORY_LENGTH:]
                if len(self.underlying_history) > Config.HISTORY_LENGTH:
                    self.underlying_history = self.underlying_history[-Config.HISTORY_LENGTH:]
                
                for callback in self.callbacks:
                    asyncio.create_task(callback(ticks))
                
            except Exception as e:
                logger.error(f"Error in mock data loop: {e}")
            
            await asyncio.sleep(Config.MOCK_TICK_INTERVAL)
    
    async def start(self):
        if self._running:
            return
        
        self._running = True
        
        if Config.ENABLE_MOCK_DATA:
            asyncio.create_task(self._mock_data_loop())
        else:
            logger.warning("Real WebSocket data feed not implemented, using mock data")
            asyncio.create_task(self._mock_data_loop())
    
    async def stop(self):
        self._running = False
    
    def get_current_snapshot(self) -> Dict:
        if not self.current_ticks:
            return {'ticks': [], 'underlying_price': 0, 'timestamp': None}
        
        return {
            'timestamp': self.current_ticks[0].timestamp.isoformat(),
            'underlying_price': self.current_ticks[0].underlying_price,
            'underlying_symbol': Config.UNDERLYING_SYMBOL,
            'underlying_name': Config.UNDERLYING_NAME,
            'ticks': [t.to_dict() for t in self.current_ticks]
        }
    
    def get_history(self) -> Dict:
        return {
            'tick_history': [[t.to_dict() for t in ticks] for ticks in self.tick_history],
            'underlying_history': self.underlying_history
        }
