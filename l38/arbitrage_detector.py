import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import logging
from enum import Enum


logger = logging.getLogger(__name__)


class ArbitrageType(Enum):
    PUT_CALL_PARITY = "put_call_parity"
    BUTTERFLY_SPREAD = "butterfly_spread"
    CALENDAR_SPREAD = "calendar_spread"
    BOX_SPREAD = "box_spread"
    IV_SMILE_MONOTONIC = "iv_smile_monotonic"


@dataclass
class ArbitrageOpportunity:
    type: ArbitrageType
    severity: float
    description: str
    strike: Optional[float]
    time_to_maturity: Optional[float]
    option_type: Optional[str]
    timestamp: datetime
    data: Dict = field(default_factory=dict)
    
    def to_dict(self) -> Dict:
        return {
            'type': self.type.value,
            'severity': float(self.severity),
            'description': self.description,
            'strike': float(self.strike) if self.strike is not None else None,
            'time_to_maturity': float(self.time_to_maturity) if self.time_to_maturity is not None else None,
            'option_type': self.option_type,
            'timestamp': self.timestamp.isoformat(),
            'data': self.data
        }


@dataclass
class PutCallParityConfig:
    tolerance: float = 0.02
    transaction_cost: float = 0.001
    min_price_threshold: float = 0.01


@dataclass
class ButterflySpreadConfig:
    tolerance: float = 0.005
    min_spread: float = 0.1


class ArbitrageDetector:
    def __init__(self,
                 parity_config: PutCallParityConfig = None,
                 butterfly_config: ButterflySpreadConfig = None):
        self.parity_config = parity_config or PutCallParityConfig()
        self.butterfly_config = butterfly_config or ButterflySpreadConfig()
        self.detection_history: List[ArbitrageOpportunity] = []
        self._pcp_violations = 0
        self._butterfly_violations = 0

    def check_put_call_parity(self,
                            S: float,
                            K: float,
                            T: float,
                            r: float,
                            q: float,
                            call_price: float,
                            put_price: float) -> Tuple[bool, float, str]:
        if T <= 0 or call_price <= 0 or put_price <= 0:
            return True, 0.0, "Invalid parameters"
        
        lhs = call_price + K * np.exp(-r * T)
        rhs = put_price + S * np.exp(-q * T)
        
        parity_value = lhs - rhs
        
        transaction_costs = self.parity_config.transaction_cost * (call_price + put_price + S + K * np.exp(-r * T))
        
        total_tolerance = self.parity_config.tolerance + transaction_costs
        
        if abs(parity_value) > total_tolerance:
            direction = "overpriced" if parity_value > 0 else "underpriced"
            return False, parity_value, f"Put-Call Parity violated: {direction} by {abs(parity_value):.4f}"
        
        return True, parity_value, "OK"

    def check_butterfly_spread(self,
                                 strikes: List[float],
                                 prices: List[float]) -> Tuple[bool, float, str]:
        if len(strikes) < 3:
            return True, 0.0, "Need at least 3 strikes"
        
        sorted_indices = np.argsort(strikes)
        K = [strikes[i] for i in sorted_indices]
        P = [prices[i] for i in sorted_indices]
        
        max_violation = 0.0
        
        for i in range(len(K) - 2):
            K1, K2, K3 = K[i], K[i+1], K[i+2]
            P1, P2, P3 = P[i], P[i+1], P[i+2]
            
            if K3 - K1 < 1e-6:
                continue
            
            weight1 = (K3 - K2) / (K3 - K1)
            weight2 = (K2 - K1) / (K3 - K1)
            butterfly_price = weight1 * P1 + weight2 * P3 - P2
            
            if butterfly_price < -self.butterfly_config.tolerance:
                max_violation = max(max_violation, abs(butterfly_price))
        
        if max_violation > 0:
            return False, max_violation, f"Butterfly spread violation: {max_violation:.4f}"
        
        return True, 0.0, "OK"

    def check_iv_smile_monotonicity(self,
                                    strikes: List[float],
                                    ivs: List[float],
                                    atm_strike: float) -> Tuple[bool, float, str]:
        if len(strikes) < 5:
            return True, 0.0, "Need at least 5 points"
        
        sorted_indices = np.argsort(strikes)
        K = np.array([strikes[i] for i in sorted_indices])
        IV = np.array([ivs[i] for i in sorted_indices])
        
        atm_idx = np.argmin(np.abs(K - atm_strike))
        
        if atm_idx < 2 or atm_idx > len(K) - 3:
            return True, 0.0, "ATM strike not central enough"
        
        left_ivs = IV[:atm_idx + 1]
        right_ivs = IV[atm_idx:]
        
        left_slopes = np.diff(left_ivs)
        right_slopes = np.diff(right_ivs)
        
        if np.any(left_slopes > self.butterfly_config.tolerance):
            return False, float(np.max(left_slopes)), "IV smile not monotonic decreasing on left side"
        
        if np.any(right_slopes < -self.butterfly_config.tolerance):
            return False, float(np.min(right_slopes)), "IV smile not monotonic increasing on right side"
        
        return True, 0.0, "OK"

    def detect_all(self, ticks: List, S: float, r: float, q: float) -> List[ArbitrageOpportunity]:
        opportunities = []
        
        if not ticks:
            return opportunities
        
        timestamp = ticks[0].timestamp if hasattr(ticks[0], 'timestamp') else datetime.now()
        
        call_ticks = {}
        put_ticks = {}
        
        for tick in ticks:
            if not hasattr(tick, 'mid_price') or tick.mid_price <= 0:
                continue
            
            key = (tick.strike, tick.time_to_maturity)
            if tick.option_type == 'call':
                call_ticks[key] = tick
            else:
                put_ticks[key] = tick
        
        for key in call_ticks:
            if key in put_ticks:
                call = call_ticks[key]
                put = put_ticks[key]
                
                is_valid, parity_value, msg = self.check_put_call_parity(
                    S=S,
                    K=call.strike,
                    T=call.time_to_maturity,
                    r=r,
                    q=q,
                    call_price=call.mid_price,
                    put_price=put.mid_price
                )
                
                if not is_valid:
                    severity = min(1.0, abs(parity_value) / max(call.mid_price, 0.01) * 10)
                    theoretical_diff = call.mid_price + call.strike * np.exp(-r * call.time_to_maturity) - (put.mid_price + S * np.exp(-q * call.time_to_maturity))
                    opportunity = ArbitrageOpportunity(
                        type=ArbitrageType.PUT_CALL_PARITY,
                        severity=severity,
                        description=msg,
                        strike=call.strike,
                        time_to_maturity=call.time_to_maturity,
                        option_type='both',
                        timestamp=timestamp,
                        data={
                            'call_price': call.mid_price,
                            'put_price': put.mid_price,
                            'parity_value': parity_value,
                            'deviation': abs(parity_value),
                            'theoretical_diff': theoretical_diff
                        }
                    )
                    opportunities.append(opportunity)
                    self._pcp_violations += 1
        
        unique_tenors = set(key[1] for key in call_ticks)
        
        for tenor in unique_tenors:
            call_strikes = []
            call_prices = []
            put_strikes = []
            put_prices = []
            
            for key in call_ticks:
                if key[1] == tenor:
                    call_strikes.append(key[0])
                    call_prices.append(call_ticks[key].mid_price)
            
            for key in put_ticks:
                if key[1] == tenor:
                    put_strikes.append(key[0])
                    put_prices.append(put_ticks[key].mid_price)
            
            if len(call_strikes) >= 3:
                is_valid, violation, msg = self.check_butterfly_spread(
                    strikes=call_strikes,
                    prices=call_prices
                )
                
                if not is_valid:
                    opportunity = ArbitrageOpportunity(
                        type=ArbitrageType.BUTTERFLY_SPREAD,
                        severity=0.8,
                        description=msg,
                        strike=None,
                        time_to_maturity=tenor,
                        option_type='call',
                        timestamp=timestamp,
                        data={
                            'strikes': call_strikes,
                            'violation': violation
                        }
                    )
                    opportunities.append(opportunity)
                    self._butterfly_violations += 1
            
            if len(put_strikes) >= 3:
                is_valid, violation, msg = self.check_butterfly_spread(
                    strikes=put_strikes,
                    prices=put_prices
                )
                
                if not is_valid:
                    opportunity = ArbitrageOpportunity(
                        type=ArbitrageType.BUTTERFLY_SPREAD,
                        severity=0.8,
                        description=msg,
                        strike=None,
                        time_to_maturity=tenor,
                        option_type='put',
                        timestamp=timestamp,
                        data={
                            'strikes': put_strikes,
                            'violation': violation
                        }
                    )
                    opportunities.append(opportunity)
                    self._butterfly_violations += 1
        
        if opportunities:
            self.detection_history.extend(opportunities)
            if len(self.detection_history) > 1000:
                self.detection_history = self.detection_history[-1000:]
        
        return opportunities

    def get_stats(self) -> Dict:
        return {
            'total_opportunities': len(self.detection_history),
            'pcp_violations': self._pcp_violations,
            'butterfly_violations': self._butterfly_violations,
            'recent_opportunities': [
                opp.to_dict() for opp in self.detection_history[-10:]
            ]
        }

    def clear_history(self) -> None:
        self.detection_history.clear()
        self._pcp_violations = 0
        self._butterfly_violations = 0
