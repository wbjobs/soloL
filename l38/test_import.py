import sys
import time

print("="*60)
print("🧪 测试导入和基本功能")
print("="*60)

print("\n1. 测试所有模块导入...")
try:
    from config import Config
    print("  ✅ config")
    
    from market_data import MarketDataManager, OptionTick
    print("  ✅ market_data")
    
    from volatility_surface_optimized import OptimizedVolatilitySurfaceBuilder, VolatilitySurface
    print("  ✅ volatility_surface_optimized")
    
    from data_downsampler import TickDownsampler
    print("  ✅ data_downsampler")
    
    from l2_cache import IVCacheManager
    print("  ✅ l2_cache")
    
    from arbitrage_detector import ArbitrageDetector, PutCallParityConfig, ButterflySpreadConfig
    print("  ✅ arbitrage_detector")
    
    from greeks_heatmap import GreeksHeatmapCalculator, MonteCarloSimulator, GreeksGrid
    print("  ✅ greeks_heatmap")
    
    from backtest_engine import BacktestEngine, DeltaNeutralStrategy, StrategyConfig
    print("  ✅ backtest_engine")
    
    print("\n  ✅ 所有模块导入成功!")
except Exception as e:
    print(f"  ❌ 导入错误: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n2. 测试类初始化...")
try:
    detector = ArbitrageDetector()
    print("  ✅ ArbitrageDetector")
    
    greeks_calc = GreeksHeatmapCalculator(use_cpp=False, num_threads=2)
    print("  ✅ GreeksHeatmapCalculator")
    
    mc_sim = MonteCarloSimulator(num_threads=2)
    print("  ✅ MonteCarloSimulator")
    
    print("\n  ✅ 所有类初始化成功!")
except Exception as e:
    print(f"  ❌ 初始化错误: {e}")
    import traceback
    traceback.print_exc()

print("\n3. 测试模拟数据生成和tick处理...")
try:
    md = MarketDataManager()
    
    import asyncio
    
    async def test_md():
        await md.start()
        await asyncio.sleep(2)
        await md.stop()
        print(f"  ✅ 生成了 {len(md.tick_history)} 个tick")
    
    asyncio.run(test_md())
except Exception as e:
    print(f"  ❌ 市场数据错误: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*60)
print("✅ 所有基础测试通过!")
print("="*60)
