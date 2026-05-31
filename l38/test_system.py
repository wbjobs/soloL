import sys
import time
import numpy as np
from datetime import datetime

sys.path.insert(0, '.')

from config import Config
from market_data import OptionTick, MarketDataManager
from data_downsampler import TickDownsampler, DownsampleConfig
from l2_cache import IVCacheManager
from volatility_surface_optimized import OptimizedVolatilitySurfaceBuilder, OptimizedOptionPricer


def generate_mock_ticks(num_ticks=5000, underlying_price=4.0):
    """生成模拟tick数据"""
    from datetime import timedelta
    
    strikes = np.linspace(3.2, 4.8, 20)
    tenor_days = [7, 14, 30, 60, 90, 180]
    option_types = ['call', 'put']
    now = datetime.now()
    
    ticks = []
    for i in range(num_ticks):
        strike = strikes[i % len(strikes)]
        days = tenor_days[(i // len(strikes)) % len(tenor_days)]
        tenor = days / 365
        option_type = option_types[i % 2]
        
        moneyness = strike / underlying_price
        atm_vol = 0.2
        vol_smile = 0.08 * (moneyness - 1.0) ** 2
        iv = atm_vol + vol_smile + np.random.normal(0, 0.01)
        
        d1 = (np.log(1/moneyness) + (0.025 + 0.5 * iv**2) * tenor) / (iv * np.sqrt(tenor))
        d2 = d1 - iv * np.sqrt(tenor)
        
        if option_type == 'call':
            price = underlying_price * np.exp(-0 * tenor) * 0.5 * (1 + np.sign(d1) * (1 - np.exp(-d1**2/2))) \
                    - strike * np.exp(-0.025 * tenor) * 0.5 * (1 + np.sign(d2) * (1 - np.exp(-d2**2/2)))
        else:
            price = strike * np.exp(-0.025 * tenor) * 0.5 * (1 + np.sign(-d2) * (1 - np.exp(-d2**2/2))) \
                    - underlying_price * np.exp(-0 * tenor) * 0.5 * (1 + np.sign(-d1) * (1 - np.exp(-d1**2/2)))
        
        price = max(price, 0.01) + np.random.normal(0, 0.005)
        
        tick = OptionTick(
            timestamp=now + timedelta(milliseconds=i),
            symbol=f"TEST{i}",
            underlying_price=underlying_price + np.random.normal(0, 0.005),
            strike=strike,
            maturity=now + timedelta(days=days),
            option_type=option_type,
            bid_price=max(0, price - 0.005),
            ask_price=price + 0.005,
            last_price=price,
            volume=np.random.randint(100, 10000),
            open_interest=np.random.randint(1000, 100000)
        )
        ticks.append(tick)
    
    return ticks


def test_iv_calculation_performance():
    """测试IV计算性能"""
    print("\n" + "="*60)
    print("TEST 1: IV计算性能测试")
    print("="*60)
    
    ticks = generate_mock_ticks(num_ticks=100)
    builder = OptimizedVolatilitySurfaceBuilder(use_cpp=Config.ENABLE_CPP_EXTENSION, num_threads=4)
    
    start = time.perf_counter()
    points = builder._extract_iv_points(ticks)
    elapsed = (time.perf_counter() - start) * 1000
    
    print(f"处理tick数: {len(ticks)}")
    print(f"有效IV点数: {len(points)}")
    print(f"计算时间: {elapsed:.2f} ms")
    print(f"平均每个IV: {elapsed/len(points):.2f} ms" if points else "无有效点")
    
    return points


def test_downsampling_performance():
    """测试数据降采样性能"""
    print("\n" + "="*60)
    print("TEST 2: 数据降采样性能测试")
    print("="*60)
    
    ticks = generate_mock_ticks(num_ticks=5000)
    downsampler = TickDownsampler(
        DownsampleConfig(
            window_size_ms=100,
            max_points_per_window=5,
            min_ticks_for_downsample=50
        )
    )
    
    print(f"原始tick数: {len(ticks)}")
    
    start = time.perf_counter()
    processed = downsampler.process(ticks)
    elapsed = (time.perf_counter() - start) * 1000
    
    stats = downsampler.stats()
    print(f"处理后tick数: {len(processed)}")
    print(f"压缩比: {stats['compression_ratio_percent']:.1f}%")
    print(f"处理时间: {elapsed:.2f} ms")
    print(f"处理速率: {len(ticks)/elapsed*1000:.0f} tick/s")
    
    return processed


def test_rbf_surface_build():
    """测试RBF曲面构建性能"""
    print("\n" + "="*60)
    print("TEST 3: RBF曲面构建性能测试")
    print("="*60)
    
    ticks = generate_mock_ticks(num_ticks=200)
    builder = OptimizedVolatilitySurfaceBuilder(use_cpp=Config.ENABLE_CPP_EXTENSION, num_threads=4)
    
    print(f"输入tick数: {len(ticks)}")
    print(f"使用方法: {Config.SURFACE_BUILDER.upper()}")
    print(f"C++扩展: {'已启用' if Config.ENABLE_CPP_EXTENSION else '已禁用(Python回退)'}")
    
    start = time.perf_counter()
    surface = builder.build_surface(ticks)
    elapsed = (time.perf_counter() - start) * 1000
    
    print(f"曲面构建时间: {elapsed:.2f} ms")
    print(f"曲面网格: {surface.iv_grid.shape[0]} x {surface.iv_grid.shape[1]} = {surface.iv_grid.size} 点")
    print(f"原始IV点数: {len(surface.raw_points)}")
    print(f"IV范围: [{surface.iv_grid.min():.4f}, {surface.iv_grid.max():.4f}]")
    
    return surface


def test_l2_cache():
    """测试L2缓存性能"""
    print("\n" + "="*60)
    print("TEST 4: L2缓存性能测试")
    print("="*60)
    
    cache = IVCacheManager()
    
    S = 4.0
    K = 4.0
    T = 0.083
    r = 0.025
    q = 0.0
    market_price = 0.1
    option_type = 'call'
    
    n_iterations = 1000
    
    start = time.perf_counter()
    for i in range(n_iterations):
        iv = cache.get_iv(S, K, T, r, q, market_price + i*0.0001, option_type)
        if iv is None:
            cache.put_iv(S, K, T, r, q, market_price + i*0.0001, option_type, 0.2 + i*0.001, 1.0)
    elapsed = (time.perf_counter() - start) * 1000
    
    stats = cache.stats()
    iv_stats = stats['iv_cache']
    print(f"缓存操作: {n_iterations} 次")
    print(f"总耗时: {elapsed:.2f} ms")
    print(f"平均操作: {elapsed/n_iterations*1e6:.2f} μs")
    print(f"IV缓存大小: {iv_stats['size']} 条目")
    print(f"命中率: {iv_stats['hit_rate']*100:.1f}%")


def test_option_pricing():
    """测试期权定价性能"""
    print("\n" + "="*60)
    print("TEST 5: 期权定价性能测试")
    print("="*60)
    
    pricer = OptimizedOptionPricer(use_cpp=Config.ENABLE_CPP_EXTENSION)
    
    S = 4.0
    K = 4.0
    T = 0.083
    r = 0.025
    q = 0.0
    sigma = 0.2
    
    n_iterations = 1000
    
    print(f"定价参数: S={S}, K={K}, T={T:.3f}, r={r}, q={q}, sigma={sigma}")
    
    start = time.perf_counter()
    for _ in range(n_iterations):
        result = pricer.price_option(S, K, T, r, q, 'call', use_fdm=False)
    elapsed = (time.perf_counter() - start) * 1000
    
    print(f"解析定价 {n_iterations} 次")
    print(f"总耗时: {elapsed:.2f} ms")
    print(f"平均每次: {elapsed/n_iterations*1e6:.2f} μs")
    print(f"定价结果: price={result['price']:.6f}, delta={result['delta']:.6f}")
    print(f"定价方法: {result['pricing_method']}")
    
    if not Config.ENABLE_CPP_EXTENSION:
        print("\nFDM定价测试:")
        start = time.perf_counter()
        result_fdm = pricer.price_option(S, K, T, r, q, 'call', use_fdm=True)
        elapsed_fdm = (time.perf_counter() - start) * 1000
        print(f"FDM定价 1 次: {elapsed_fdm:.2f} ms")
        print(f"FDM价格: {result_fdm['price']:.6f}")
        print(f"解析价格: {result['price']:.6f}")
        print(f"价格差异: {abs(result_fdm['price'] - result['price']):.6f}")


def test_full_pipeline():
    """测试完整数据处理流水线"""
    print("\n" + "="*60)
    print("TEST 6: 完整数据处理流水线测试")
    print("="*60)
    
    ticks = generate_mock_ticks(num_ticks=5000)
    downsampler = TickDownsampler(
        DownsampleConfig(
            window_size_ms=100,
            max_points_per_window=5,
            min_ticks_for_downsample=50
        )
    )
    cache = IVCacheManager()
    builder = OptimizedVolatilitySurfaceBuilder(use_cpp=Config.ENABLE_CPP_EXTENSION, num_threads=4)
    
    print(f"模拟开盘瞬间数据爆发: {len(ticks)} ticks")
    print(f"降采样: {'启用' if Config.ENABLE_DOWNSAMPLING else '禁用'}")
    print(f"L2缓存: {'启用' if Config.ENABLE_L2_CACHE else '禁用'}")
    print(f"C++内核: {'启用' if Config.ENABLE_CPP_EXTENSION else '禁用(Python回退)'}")
    
    total_start = time.perf_counter()
    
    step1_start = time.perf_counter()
    if Config.ENABLE_DOWNSAMPLING:
        processed_ticks = downsampler.process(ticks)
    else:
        processed_ticks = ticks
    step1_time = (time.perf_counter() - step1_start) * 1000
    
    step2_start = time.perf_counter()
    tick_hash = str(hash(tuple(t.strike for t in processed_ticks[:100])))
    cached = cache.get_surface(tick_hash) if Config.ENABLE_L2_CACHE else None
    step2_time = (time.perf_counter() - step2_start) * 1000
    
    step3_start = time.perf_counter()
    if cached:
        surface = cached
        cache_hit = True
    else:
        surface = builder.build_surface(processed_ticks)
        cache_hit = False
        if Config.ENABLE_L2_CACHE:
            cache.put_surface(tick_hash, surface.to_dict(), surface.build_time_ms)
    step3_time = (time.perf_counter() - step3_start) * 1000
    
    total_time = (time.perf_counter() - total_start) * 1000
    
    print(f"\n流水线耗时:")
    print(f"  1. 数据降采样: {step1_time:.2f} ms ({len(ticks)} → {len(processed_ticks)} ticks)")
    print(f"  2. 缓存查询: {step2_time:.2f} ms {'(命中)' if cache_hit else '(未命中)'}")
    print(f"  3. 曲面构建: {step3_time:.2f} ms")
    print(f"  总计: {total_time:.2f} ms")
    
    throughput = len(ticks) / (total_time / 1000)
    print(f"\n处理吞吐量: {throughput:.0f} tick/s")
    print(f"理论支持: {throughput * 0.2:.0f} tick/s (预留80%余量)")
    
    return surface


def main():
    print("╔" + "═"*58 + "╗")
    print("║" + " " * 15 + "高性能期权定价系统测试" + " " * 15 + "║")
    print("╚" + "═"*58 + "╝")
    
    print(f"\n系统配置:")
    print(f"  C++扩展: {'已启用' if Config.ENABLE_CPP_EXTENSION else '已禁用(Python回退)'}")
    print(f"  数据降采样: {'已启用' if Config.ENABLE_DOWNSAMPLING else '已禁用'}")
    print(f"  L2缓存: {'已启用' if Config.ENABLE_L2_CACHE else '已禁用'}")
    print(f"  曲面构建: {Config.SURFACE_BUILDER.upper()}")
    print(f"  线程数: {Config.NUM_THREADS}")
    
    try:
        test_iv_calculation_performance()
        test_downsampling_performance()
        test_rbf_surface_build()
        test_l2_cache()
        test_option_pricing()
        test_full_pipeline()
        
        print("\n" + "="*60)
        print("✅ 所有测试完成!")
        print("="*60)
        
    except Exception as e:
        print(f"\n❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
