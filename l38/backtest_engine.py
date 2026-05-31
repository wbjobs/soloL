import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Callable
from datetime import datetime, timedelta
from enum import Enum
import logging
from concurrent.futures import ThreadPoolExecutor


logger = logging.getLogger(__name__)


class SignalType(Enum):
    LONG_CALL = "long_call"
    SHORT_CALL = "short_call"
    LONG_PUT = "long_put"
    SHORT_PUT = "short_put"
    LONG_UNDERLYING = "long_underlying"
    SHORT_UNDERLYING = "short_underlying"
    HOLD = "hold"


@dataclass
class TradingSignal:
    timestamp: datetime
    signal_type: SignalType
    strike: Optional[float]
    time_to_maturity: Optional[float]
    option_type: Optional[str]
    quantity: int
    price: float
    underlying_price: float
    reason: str = ""
    
    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp.isoformat(),
            'signal_type': self.signal_type.value,
            'strike': float(self.strike) if self.strike is not None else None,
            'time_to_maturity': float(self.time_to_maturity) if self.time_to_maturity is not None else None,
            'option_type': self.option_type,
            'quantity': int(self.quantity),
            'price': float(self.price),
            'underlying_price': float(self.underlying_price),
            'reason': self.reason
        }


@dataclass
class Position:
    signal_type: SignalType
    quantity: int
    entry_price: float
    entry_time: datetime
    current_price: float = 0.0
    strike: Optional[float] = None
    time_to_maturity: Optional[float] = None
    option_type: Optional[str] = None
    
    def get_value(self) -> float:
        return self.quantity * self.current_price
    
    def get_pnl(self) -> float:
        return self.quantity * (self.current_price - self.entry_price)
    
    def get_delta(self, S: float, r: float, q: float, sigma: float) -> float:
        if self.option_type is None or self.strike is None or self.time_to_maturity is None:
            return self.quantity * (1.0 if 'LONG' in self.signal_type.name else -1.0)
        
        from fdm_solver import black_scholes_analytical
        _, delta, _, _, _ = black_scholes_analytical(
            S, self.strike, self.time_to_maturity, r, q, sigma, self.option_type
        )
        direction = 1 if 'LONG' in self.signal_type.name else -1
        return self.quantity * delta * direction


@dataclass
class BacktestResult:
    timestamps: List[datetime]
    portfolio_values: List[float]
    cash_values: List[float]
    positions_values: List[float]
    total_pnl: float
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    max_drawdown_duration: float
    win_rate: float
    num_trades: int
    signals: List[TradingSignal]
    positions_history: List[Dict] = field(default_factory=list)
    
    def to_dict(self) -> Dict:
        return {
            'timestamps': [ts.isoformat() for ts in self.timestamps],
            'portfolio_values': [float(v) for v in self.portfolio_values],
            'cash_values': [float(v) for v in self.cash_values],
            'positions_values': [float(v) for v in self.positions_values],
            'total_pnl': float(self.total_pnl),
            'total_return': float(self.total_return),
            'sharpe_ratio': float(self.sharpe_ratio),
            'max_drawdown': float(self.max_drawdown),
            'max_drawdown_duration': float(self.max_drawdown_duration),
            'win_rate': float(self.win_rate),
            'num_trades': int(self.num_trades),
            'signals': [s.to_dict() for s in self.signals]
        }


@dataclass
class StrategyConfig:
    initial_cash: float = 100000.0
    transaction_cost: float = 0.001
    rebalance_interval: str = "daily"
    delta_target: float = 0.0
    delta_tolerance: float = 0.1
    use_delta_hedging: bool = True
    option_contract_size: int = 10000
    max_position_size: float = 0.3


class DeltaNeutralStrategy:
    def __init__(self, config: StrategyConfig = None):
        self.config = config or StrategyConfig()
        self.positions: List[Position] = []
        self.cash = self.config.initial_cash
        
    def calculate_portfolio_delta(self, S: float, r: float, q: float, sigma: float) -> float:
        total_delta = 0.0
        for pos in self.positions:
            total_delta += pos.get_delta(S, r, q, sigma)
        return total_delta
    
    def generate_signals(self,
                        timestamp: datetime,
                        underlying_price: float,
                        available_options: List[Dict],
                        S: float, r: float, q: float, sigma: float) -> List[TradingSignal]:
        signals = []
        
        portfolio_delta = self.calculate_portfolio_delta(S, r, q, sigma)
        delta_exposure = portfolio_delta * self.config.option_contract_size
        
        if underlying_price <= 0:
            underlying_price = max(underlying_price, 0.01)
        
        target_delta = self.config.delta_target * self.config.initial_cash / underlying_price
        delta_deviation = abs(delta_exposure - target_delta)
        delta_tolerance = self.config.delta_tolerance * self.config.initial_cash / underlying_price
        
        if delta_deviation > delta_tolerance and self.config.use_delta_hedging:
            required_hedge = target_delta - delta_exposure
            
            if not np.isfinite(required_hedge) or abs(required_hedge) > 1e10:
                return signals
            
            hedge_quantity = int(np.sign(required_hedge) * max(1, abs(required_hedge)))
            hedge_quantity = max(-100000, min(100000, hedge_quantity))
            
            if abs(hedge_quantity) > 0:
                signal_type = SignalType.LONG_UNDERLYING if hedge_quantity > 0 else SignalType.SHORT_UNDERLYING
                signals.append(TradingSignal(
                    timestamp=timestamp,
                    signal_type=signal_type,
                    strike=None,
                    time_to_maturity=None,
                    option_type=None,
                    quantity=abs(hedge_quantity),
                    price=underlying_price,
                    underlying_price=underlying_price,
                    reason=f"Delta hedge: portfolio_delta={delta_exposure:.2f}, target={target_delta:.2f}"
                ))
        
        if not self.positions and available_options:
            atm_option = None
            min_distance = float('inf')
            for opt in available_options:
                if opt['option_type'] == 'call' and opt['time_to_maturity'] > 7/365:
                    distance = abs(opt['strike'] - underlying_price)
                    if distance < min_distance:
                        min_distance = distance
                        atm_option = opt
            
            if atm_option:
                price = max(atm_option['mid_price'], 0.001)
                quantity = int(self.config.initial_cash * self.config.max_position_size / 
                               (price * self.config.option_contract_size))
                quantity = max(0, min(1000, quantity))
                if quantity > 0:
                    signals.append(TradingSignal(
                        timestamp=timestamp,
                        signal_type=SignalType.LONG_CALL,
                        strike=atm_option['strike'],
                        time_to_maturity=atm_option['time_to_maturity'],
                        option_type='call',
                        quantity=quantity,
                        price=atm_option['mid_price'],
                        underlying_price=underlying_price,
                        reason=f"Initial position: ATM call {atm_option['strike']}"
                    ))
        
        return signals
    
    def execute_signal(self, signal: TradingSignal) -> float:
        notional = signal.quantity * signal.price * self.config.option_contract_size
        transaction_fee = notional * self.config.transaction_cost
        
        if 'LONG' in signal.signal_type.name:
            self.cash -= (notional + transaction_fee)
            direction = 1
        else:
            self.cash += (notional - transaction_fee)
            direction = -1
        
        self.positions.append(Position(
            signal_type=signal.signal_type,
            quantity=signal.quantity * direction,
            entry_price=signal.price,
            entry_time=signal.timestamp,
            current_price=signal.price,
            strike=signal.strike,
            time_to_maturity=signal.time_to_maturity,
            option_type=signal.option_type
        ))
        
        return transaction_fee
    
    def update_positions(self, current_options: List[Dict], underlying_price: float) -> float:
        positions_value = 0.0
        
        for pos in self.positions:
            if pos.option_type is not None and pos.strike is not None:
                for opt in current_options:
                    if (opt['strike'] == pos.strike and 
                        opt['option_type'] == pos.option_type and
                        abs(opt['time_to_maturity'] - pos.time_to_maturity) < 1e-6):
                        pos.current_price = opt['mid_price']
                        break
            else:
                pos.current_price = underlying_price
            
            positions_value += pos.get_value()
        
        return positions_value


class BacktestEngine:
    def __init__(self, strategy: DeltaNeutralStrategy = None):
        self.strategy = strategy or DeltaNeutralStrategy()
    
    def generate_historical_data(self,
                                 start_date: datetime,
                                 end_date: datetime,
                                 S0: float = 4.0,
                                 mu: float = 0.05,
                                 sigma: float = 0.2,
                                 freq: str = 'D') -> List[Dict]:
        delta = end_date - start_date
        days = max(1, delta.days)
        n_steps = days + 1
        
        dt = 1 / 252
        drift = (mu - 0.5 * sigma**2) * dt
        vol = sigma * (dt ** 0.5)
        
        historical_data = []
        current_price = S0
        
        for i in range(n_steps):
            d = start_date + timedelta(days=i)
            ts = datetime(d.year, d.month, d.day)
            
            if i > 0:
                z = np.random.standard_normal()
                current_price = current_price * np.exp(drift + vol * z)
            
            historical_data.append({
                'timestamp': ts,
                'underlying_price': float(current_price),
                'volatility': float(sigma)
            })
        
        return historical_data
    
    def run_backtest(self,
                    historical_data: List[Dict],
                    options_data: List[List[Dict]] = None) -> BacktestResult:
        timestamps = []
        portfolio_values = []
        cash_values = []
        positions_values = []
        all_signals = []
        positions_history = []
        
        total_fees = 0.0
        num_trades = 0
        
        for idx, row in enumerate(historical_data):
            timestamp = row['timestamp']
            underlying_price = row['underlying_price']
            sigma = row['volatility']
            r = 0.025
            q = 0.0
            
            current_options = options_data[idx] if options_data and idx < len(options_data) else self._generate_options(
                underlying_price, sigma, timestamp
            )
            
            signals = self.strategy.generate_signals(
                timestamp, underlying_price, current_options, underlying_price, r, q, sigma
            )
            
            for signal in signals:
                fee = self.strategy.execute_signal(signal)
                total_fees += fee
                num_trades += 1
                all_signals.append(signal)
            
            positions_value = self.strategy.update_positions(current_options, underlying_price)
            portfolio_value = self.strategy.cash + positions_value
            
            timestamps.append(timestamp)
            portfolio_values.append(portfolio_value)
            cash_values.append(self.strategy.cash)
            positions_values.append(positions_value)
            
            positions_history.append({
                'timestamp': timestamp.isoformat(),
                'num_positions': len(self.strategy.positions),
                'portfolio_delta': self.strategy.calculate_portfolio_delta(underlying_price, r, q, sigma),
                'cash': self.strategy.cash,
                'positions_value': positions_value
            })
        
        initial_value = portfolio_values[0]
        final_value = portfolio_values[-1]
        total_pnl = final_value - initial_value
        total_return = (final_value - initial_value) / initial_value
        
        returns = np.diff(portfolio_values) / portfolio_values[:-1]
        if len(returns) > 1 and np.std(returns) > 0:
            sharpe_ratio = np.sqrt(252) * np.mean(returns) / np.std(returns)
        else:
            sharpe_ratio = 0.0
        
        peak = np.maximum.accumulate(portfolio_values)
        drawdown = (portfolio_values - peak) / peak
        max_drawdown = float(np.min(drawdown))
        
        max_dd_duration = 0
        current_dd = 0
        for dd in drawdown:
            if dd < 0:
                current_dd += 1
                max_dd_duration = max(max_dd_duration, current_dd)
            else:
                current_dd = 0
        
        winning_trades = [s for s in all_signals if 'LONG' in s.signal_type.value]
        win_rate = len(winning_trades) / max(1, num_trades) if num_trades > 0 else 0.0
        
        return BacktestResult(
            timestamps=timestamps,
            portfolio_values=portfolio_values,
            cash_values=cash_values,
            positions_values=positions_values,
            total_pnl=total_pnl,
            total_return=total_return,
            sharpe_ratio=sharpe_ratio,
            max_drawdown=max_drawdown,
            max_drawdown_duration=max_dd_duration,
            win_rate=win_rate,
            num_trades=num_trades,
            signals=all_signals,
            positions_history=positions_history
        )
    
    def _generate_options(self, underlying_price: float, sigma: float, timestamp: datetime) -> List[Dict]:
        from fdm_solver import black_scholes_analytical
        
        strikes = np.linspace(underlying_price * 0.8, underlying_price * 1.2, 9)
        tenors = [30/365, 60/365, 90/365, 180/365]
        options = []
        
        for strike in strikes:
            for tenor in tenors:
                for opt_type in ['call', 'put']:
                    price, _, _, _, _ = black_scholes_analytical(
                        underlying_price, strike, tenor, 0.025, 0.0, sigma, opt_type
                    )
                    bid_price = max(0.001, price - 0.005)
                    ask_price = price + 0.005
                    
                    options.append({
                        'strike': float(strike),
                        'time_to_maturity': float(tenor),
                        'option_type': opt_type,
                        'bid_price': float(bid_price),
                        'ask_price': float(ask_price),
                        'mid_price': float((bid_price + ask_price) / 2),
                        'maturity': (timestamp + timedelta(days=int(tenor * 365))).isoformat()
                    })
        
        return options


def run_delta_neutral_backtest(start_date: datetime,
                                end_date: datetime,
                                initial_cash: float = 100000.0,
                                delta_target: float = 0.0,
                                delta_tolerance: float = 0.1) -> BacktestResult:
    config = StrategyConfig(
        initial_cash=initial_cash,
        delta_target=delta_target,
        delta_tolerance=delta_tolerance,
        use_delta_hedging=True
    )
    strategy = DeltaNeutralStrategy(config)
    engine = BacktestEngine(strategy)
    
    historical_data = engine.generate_historical_data(start_date, end_date)
    
    options_data = []
    for row in historical_data:
        options_data.append(engine._generate_options(row['underlying_price'], row['volatility'], row['timestamp']))
    
    return engine.run_backtest(historical_data, options_data)
