import sys
import time
import numpy as np

print("="*60)
print("🧪 直接测试新模块")
print("="*60)

print("\n1. 测试套利检测模块...")
try:
    from arbitrage_detector import ArbitrageDetector, PutCallParityConfig, ButterflySpreadConfig
    
    detector = ArbitrageDetector(
        parity_config=PutCallParityConfig(tolerance=0.02, transaction_cost=0.001),
        butterfly_config=ButterflySpreadConfig(tolerance=0.005)
    )
    
    S = 4.0
    K = 4.2
    T = 0.5
    r = 0.03
    q = 0.0
    call_price = 0.35
    put_price = 0.48
    
    valid, parity_val = detector.check_put_call_parity(S, K, T, r, q, call_price, put_price)
    print(f"  Put-Call Parity检测: 有效={valid}, 偏差={parity_val:.4f}")
    
    strikes = [4.0, 4.2, 4.4]
    put_prices = [0.30, 0.48, 0.70]
    valid2, butterfly_val = detector.check_butterfly_spread(strikes, put_prices, S, T, r, q)
    print(f"  蝶式价差检测: 有效={valid2}, 偏差={butterfly_val:.4f}")
    
    print("  ✅ 套利检测模块测试通过")
except Exception as e:
    print(f"  ❌ 错误: {e}")
    import traceback
    traceback.print_exc()

print("\n2. 测试希腊值热力图模块...")
try:
    from greeks_heatmap import GreeksHeatmapCalculator, MonteCarloSimulator, GreeksGrid
    from volatility_surface_optimized import VolatilitySurface
    
    greeks_calc = GreeksHeatmapCalculator(use_cpp=False, num_threads=2)
    
    moneyness = np.linspace(0.8, 1.2, 20)
    tenors = np.linspace(0.01, 1.0, 10)
    iv_grid = np.random.uniform(0.15, 0.25, size=(10, 20))
    
    surface = VolatilitySurface(
        strikes=[4.0, 4.2, 4.4],
        tenors=[0.083, 0.25, 0.5],
        iv_grid=iv_grid,
        underlying_price=4.0,
        timestamp=time.time()
    )
    
    start = time.time()
    greeks = greeks_calc.calculate_greeks_grid(surface, S=4.0, r=0.03, q=0.0)
    elapsed = (time.time() - start) * 1000
    
    print(f"  Delta网格: {len(greeks.delta_grid)}x{len(greeks.delta_grid[0])}")
    print(f"  Gamma网格: {len(greeks.gamma_grid)}x{len(greeks.gamma_grid[0])}")
    print(f"  Vega网格: {len(greeks.vega_grid)}x{len(greeks.vega_grid[0])}")
    print(f"  计算时间: {elapsed:.0f}ms")
    print("  ✅ 希腊值热力图模块测试通过")
except Exception as e:
    print(f"  ❌ 错误: {e}")
    import traceback
    traceback.print_exc()

print("\n3. 测试蒙特卡洛模拟模块...")
try:
    mc_sim = MonteCarloSimulator(num_threads=2)
    
    start = time.time()
    result = mc_sim.simulate(
        S0=4.0, K=4.2, T=0.5, r=0.03, q=0.0, sigma=0.2,
        option_type='call', n_paths=2000, n_steps=50,
        calc_greeks=True, return_paths=True
    )
    elapsed = (time.time() - start) * 1000
    
    print(f"  价格: {result['price']:.4f}")
    print(f"  标准误差: {result['stdError']:.6f}")
    print(f"  Delta: {result.get('delta', 'N/A')}")
    print(f"  Gamma: {result.get('gamma', 'N/A')}")
    print(f"  Vega: {result.get('vega', 'N/A')}")
    print(f"  路径数: {len(result.get('paths', []))}")
    print(f"  计算时间: {elapsed:.0f}ms")
    print("  ✅ 蒙特卡洛模拟模块测试通过")
except Exception as e:
    print(f"  ❌ 错误: {e}")
    import traceback
    traceback.print_exc()

print("\n4. 测试策略回测引擎...")
try:
    from backtest_engine import BacktestEngine, DeltaNeutralStrategy, run_delta_neutral_backtest
    
    start = time.time()
    result = run_delta_neutral_backtest(
        start_date="2024-01-01",
        end_date="2024-03-01",
        initial_cash=100000.0,
        delta_target=0.0,
        delta_tolerance=0.1
    )
    elapsed = (time.time() - start) * 1000
    
    print(f"  总收益率: {result['total_return']*100:.2f}%")
    print(f"  总盈亏: ¥{result['total_pnl']:.2f}")
    print(f"  夏普比率: {result['sharpe_ratio']:.3f}")
    print(f"  最大回撤: {result['max_drawdown']*100:.2f}%")
    print(f"  胜率: {result['win_rate']*100:.1f}%")
    print(f"  交易次数: {result['num_trades']}")
    print(f"  净值点数: {len(result['portfolio_values'])}")
    print(f"  计算时间: {elapsed:.0f}ms")
    print("  ✅ 策略回测引擎测试通过")
except Exception as e:
    print(f"  ❌ 错误: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("✅ 所有模块直接测试完成!")
print("="*60)
