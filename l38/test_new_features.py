import httpx
import json
import time

BASE_URL = "http://localhost:8080"

def test_arbitrage_api():
    print("\n" + "="*60)
    print("🧪 测试套利检测 API")
    print("="*60)
    
    try:
        r = httpx.get(f"{BASE_URL}/api/arbitrage/current", timeout=10.0)
        print(f"GET /api/arbitrage/current: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"  实时套利机会: {data.get('opportunities', [])[:2]}")
            print(f"  统计: {data.get('stats', {})}")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

    try:
        r = httpx.get(f"{BASE_URL}/api/arbitrage/history", timeout=10.0)
        print(f"GET /api/arbitrage/history: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"  历史套利历史: {len(data.get('history', []))} 条")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

def test_greeks_api():
    print("\n" + "="*60)
    print("🧪 测试希腊值 API")
    print("="*60)
    
    try:
        r = httpx.get(f"{BASE_URL}/api/greeks/current", timeout=10.0)
        print(f"GET /api/greeks/current: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            delta_grid = data.get('delta_grid', [])
            gamma_grid = data.get('gamma_grid', [])
            vega_grid = data.get('vega_grid', [])
            theta_grid = data.get('theta_grid', [])
            cols_d = len(delta_grid[0]) if delta_grid else 0
            cols_g = len(gamma_grid[0]) if gamma_grid else 0
            cols_v = len(vega_grid[0]) if vega_grid else 0
            cols_t = len(theta_grid[0]) if theta_grid else 0
            print(f"  Delta网格: {len(delta_grid)}x{cols_d}")
            print(f"  Gamma网格: {len(gamma_grid)}x{cols_g}")
            print(f"  Vega网格: {len(vega_grid)}x{cols_v}")
            print(f"  Theta网格: {len(theta_grid)}x{cols_t}")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

def test_montecarlo_api():
    print("\n" + "="*60)
    print("🧪 测试蒙特卡洛模拟 API")
    print("="*60)
    
    params = {
        "S0": 4.0,
        "K": 4.2,
        "T": 0.5,
        "r": 0.03,
        "sigma": 0.2,
        "option_type": "call",
        "n_paths": 2000,
        "n_steps": 50,
        "calc_greeks": True
    }
    
    try:
        print(f"POST /api/montecarlo/simulate with params={params}")
        start = time.time()
        r = httpx.post(f"{BASE_URL}/api/montecarlo/simulate", json=params, timeout=30.0)
        elapsed = time.time() - start
        print(f"  状态码: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            result = data.get('result', {})
            print(f"  计算时间: {data.get('calculation_time_ms', 0):.0f}ms")
            print(f"  期权价格: {result.get('price', 0):.4f}")
            print(f"  标准误差: {result.get('stdError', 0):.6f}")
            print(f"  95%置信区间: {result.get('confidenceInterval', [0, 0])}")
            print(f"  Delta: {result.get('delta', 0):.4f}")
            print(f"  Gamma: {result.get('gamma', 0):.4f}")
            print(f"  Vega: {result.get('vega', 0):.4f}")
            paths = result.get('paths', [])
            print(f"  路径数: {len(paths) if paths else 0} (仅显示<=1000条)")
            print(f"  实际耗时: {elapsed*1000:.0f}ms")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

def test_backtest_api():
    print("\n" + "="*60)
    print("🧪 测试策略回测 API")
    print("="*60)
    
    params = {
        "start_date": "2024-01-01",
        "end_date": "2024-02-01",
        "initial_cash": 100000.0,
        "strategy": "delta_neutral",
        "delta_target": 0.0,
        "delta_tolerance": 0.1
    }
    
    try:
        print(f"POST /api/backtest/run with params={params}")
        start = time.time()
        r = httpx.post(f"{BASE_URL}/api/backtest/run", json=params, timeout=30.0)
        elapsed = time.time() - start
        print(f"  状态码: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            result = data.get('result', {})
            print(f"  计算时间: {data.get('calculation_time_ms', 0):.0f}ms")
            print(f"  总收益率: {result.get('total_return', 0)*100:.2f}%")
            print(f"  总盈亏: ¥{result.get('total_pnl', 0):.2f}")
            print(f"  夏普比率: {result.get('sharpe_ratio', 0):.3f}")
            print(f"  最大回撤: {result.get('max_drawdown', 0)*100:.2f}%")
            print(f"  胜率: {result.get('win_rate', 0)*100:.1f}%")
            print(f"  交易次数: {result.get('num_trades', 0)}")
            print(f"  净值点数: {len(result.get('portfolio_values', []))}")
            print(f"  实际耗时: {elapsed*1000:.0f}ms")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

def test_backtest_strategies_api():
    print("\n" + "="*60)
    print("🧪 测试策略列表 API")
    print("="*60)
    
    try:
        r = httpx.get(f"{BASE_URL}/api/backtest/strategies", timeout=10.0)
        print(f"GET /api/backtest/strategies: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            print(f"  可用策略: {data.get('strategies', [])}")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

def test_snapshot_api():
    print("\n" + "="*60)
    print("🧪 测试快照 API (包含新功能)")
    print("="*60)
    
    try:
        r = httpx.get(f"{BASE_URL}/api/snapshot", timeout=10.0)
        print(f"GET /api/snapshot: {r.status_code}")
        if r.status_code == 200:
            data = r.json()
            keys = list(data.keys())
            print(f"  返回字段: {keys}")
            if 'greeks' in data:
                print(f"  ✅ 包含希腊值数据")
            if 'arbitrage' in data:
                print(f"  ✅ 包含套利检测数据")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

if __name__ == "__main__":
    print("🚀 开始测试所有新功能 API")
    print("等待服务启动...")
    time.sleep(2)
    
    test_snapshot_api()
    test_arbitrage_api()
    test_greeks_api()
    test_backtest_strategies_api()
    test_montecarlo_api()
    test_backtest_api()
    
    print("\n" + "="*60)
    print("✅ 所有测试完成!")
    print("="*60)
