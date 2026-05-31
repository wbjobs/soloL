import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import Config
from market_data import MarketDataManager, OptionTick
from volatility_surface_optimized import (
    OptimizedVolatilitySurfaceBuilder,
    OptimizedOptionPricer,
    VolatilitySurface
)
from data_downsampler import TickDownsampler, DownsampleConfig
from l2_cache import IVCacheManager
from arbitrage_detector import (
    ArbitrageDetector,
    PutCallParityConfig,
    ButterflySpreadConfig
)
from greeks_heatmap import GreeksHeatmapCalculator, MonteCarloSimulator, GreeksGrid
from backtest_engine import (
    BacktestEngine,
    DeltaNeutralStrategy,
    StrategyConfig,
    run_delta_neutral_backtest
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

market_data_manager = MarketDataManager()
downsampler = TickDownsampler(
    DownsampleConfig(
        window_size_ms=Config.DOWNSAMPLE_WINDOW_MS,
        max_points_per_window=Config.DOWNSAMPLE_MAX_POINTS,
        min_ticks_for_downsample=Config.DOWNSAMPLE_MIN_TICKS
    )
)

vol_builder = OptimizedVolatilitySurfaceBuilder(
    use_cpp=Config.ENABLE_CPP_EXTENSION,
    num_threads=Config.NUM_THREADS
)

option_pricer = OptimizedOptionPricer(use_cpp=Config.ENABLE_CPP_EXTENSION)
cache_manager = IVCacheManager()
arbitrage_detector = ArbitrageDetector(
    parity_config=PutCallParityConfig(tolerance=0.02, transaction_cost=0.001),
    butterfly_config=ButterflySpreadConfig(tolerance=0.005)
)
greeks_calculator = GreeksHeatmapCalculator(
    use_cpp=Config.ENABLE_CPP_EXTENSION,
    num_threads=Config.NUM_THREADS
)
mc_simulator = MonteCarloSimulator(num_threads=Config.NUM_THREADS)

current_surface: Optional[VolatilitySurface] = None
current_greeks: Optional[GreeksGrid] = None
current_arbitrage_opportunities: List = []
active_connections: List[WebSocket] = []

processing_stats = {
    'total_ticks_received': 0,
    'total_ticks_processed': 0,
    'total_surfaces_built': 0,
    'avg_surface_build_time_ms': 0,
    'total_surface_build_time_ms': 0,
    'downsample_compression_ratio': 0,
    'last_processing_time_ms': 0
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await market_data_manager.start()
    market_data_manager.subscribe(on_tick_update)
    
    logger.info("=" * 60)
    logger.info("🚀 高性能期权定价系统启动")
    logger.info(f"   C++扩展: {'已启用' if Config.ENABLE_CPP_EXTENSION else '已禁用'}")
    logger.info(f"   数据降采样: {'已启用' if Config.ENABLE_DOWNSAMPLING else '已禁用'}")
    logger.info(f"   L2缓存: {'已启用' if Config.ENABLE_L2_CACHE else '已禁用'}")
    logger.info(f"   曲面构建: {Config.SURFACE_BUILDER.upper()}")
    logger.info(f"   线程数: {Config.NUM_THREADS}")
    logger.info("=" * 60)
    
    yield
    
    await market_data_manager.stop()
    logger.info("系统已关闭")


app = FastAPI(lifespan=lifespan, title="高性能期权定价与波动率曲面系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def on_tick_update(ticks: List[OptionTick]):
    global current_surface
    
    start_time = time.perf_counter()
    processing_stats['total_ticks_received'] += len(ticks)
    
    try:
        processed_ticks = ticks
        if Config.ENABLE_DOWNSAMPLING and len(ticks) >= Config.DOWNSAMPLE_MIN_TICKS:
            processed_ticks = downsampler.process(ticks)
            processing_stats['total_ticks_processed'] += len(processed_ticks)
            processing_stats['downsample_compression_ratio'] = downsampler.stats()['compression_ratio_percent']
        
        if not processed_ticks:
            return
        
        tick_hash = downsampler.get_tick_hash(processed_ticks)
        cached_surface = cache_manager.get_surface(tick_hash) if Config.ENABLE_L2_CACHE else None
        
        if cached_surface:
            current_surface = cached_surface
            logger.debug(f"⚡ 缓存命中，跳过曲面构建")
        else:
            surface_build_start = time.perf_counter()
            current_surface = vol_builder.build_surface(processed_ticks, processed_ticks[0].timestamp)
            surface_build_time = (time.perf_counter() - surface_build_start) * 1000
            
            processing_stats['total_surfaces_built'] += 1
            processing_stats['total_surface_build_time_ms'] += surface_build_time
            processing_stats['avg_surface_build_time_ms'] = (
                processing_stats['total_surface_build_time_ms'] / processing_stats['total_surfaces_built']
            )
            
            if Config.ENABLE_L2_CACHE:
                cache_manager.put_surface(tick_hash, current_surface.to_dict(), surface_build_time)
        
        S = processed_ticks[0].underlying_price
        r = Config.RISK_FREE_RATE
        q = Config.DIVIDEND_YIELD
        
        arbitrage_start = time.perf_counter()
        global current_arbitrage_opportunities
        current_arbitrage_opportunities = arbitrage_detector.detect_all(
            processed_ticks, S, r, q
        )
        arbitrage_time_ms = (time.perf_counter() - arbitrage_start) * 1000
        
        greeks_start = time.perf_counter()
        global current_greeks
        if current_surface:
            current_greeks = greeks_calculator.calculate_greeks_grid(
                current_surface, S, r, q
            )
        greeks_time_ms = (time.perf_counter() - greeks_start) * 1000
        
        processing_stats['last_processing_time_ms'] = (time.perf_counter() - start_time) * 1000
        
        data = {
            'type': 'tick_update',
            'data': {
                'timestamp': processed_ticks[0].timestamp.isoformat(),
                'underlying_price': processed_ticks[0].underlying_price,
                'underlying_symbol': Config.UNDERLYING_SYMBOL,
                'underlying_name': Config.UNDERLYING_NAME,
                'surface': current_surface.to_dict(),
                'ticks': [t.to_dict() for t in processed_ticks[:10]],
                'stats': {
                    'ticks_received': len(ticks),
                    'ticks_processed': len(processed_ticks),
                    'compression_ratio': processing_stats['downsample_compression_ratio'],
                    'build_time_ms': current_surface.build_time_ms if current_surface else 0,
                    'arbitrage_time_ms': arbitrage_time_ms,
                    'greeks_time_ms': greeks_time_ms,
                    'total_time_ms': processing_stats['last_processing_time_ms'],
                    'cache_hit': cached_surface is not None
                },
                'arbitrage': {
                    'opportunities': [opp.to_dict() for opp in current_arbitrage_opportunities],
                    'stats': arbitrage_detector.get_stats()
                },
                'greeks': current_greeks.to_dict() if current_greeks else None
            }
        }
        
        for connection in active_connections:
            try:
                await connection.send_text(json.dumps(data, default=str))
            except Exception as e:
                logger.warning(f"发送客户端失败: {e}")
                
    except Exception as e:
        logger.error(f"处理tick更新错误: {e}", exc_info=True)


@app.get("/")
async def root():
    return FileResponse(f"static/{Config.FRONTEND_PAGE}")


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "features": {
            "cpp_extension": Config.ENABLE_CPP_EXTENSION,
            "downsampling": Config.ENABLE_DOWNSAMPLING,
            "l2_cache": Config.ENABLE_L2_CACHE,
            "surface_builder": Config.SURFACE_BUILDER,
            "num_threads": Config.NUM_THREADS
        }
    }


@app.get("/api/stats")
async def get_performance_stats():
    return {
        "processing": processing_stats,
        "downsampler": downsampler.stats(),
        "cache": cache_manager.stats(),
        "surface_builder": vol_builder.stats()
    }


@app.get("/api/snapshot")
async def get_snapshot():
    snapshot = market_data_manager.get_current_snapshot()
    if current_surface:
        snapshot['surface'] = current_surface.to_dict()
        snapshot['stats'] = processing_stats
    if current_greeks:
        snapshot['greeks'] = current_greeks.to_dict()
    snapshot['arbitrage'] = {
        'opportunities': [opp.to_dict() for opp in current_arbitrage_opportunities],
        'stats': arbitrage_detector.get_stats()
    }
    return snapshot


@app.get("/api/surface/current")
async def get_current_surface():
    if current_surface is None:
        return {"error": "No surface available yet"}
    return current_surface.to_dict()


@app.get("/api/surface/history")
async def get_surface_history():
    return {"history": vol_builder.get_history()}


@app.get("/api/surface/at")
async def get_surface_at_index(index: int = Query(..., description="History index")):
    surface = vol_builder.get_surface_at_index(index)
    if surface is None:
        return {"error": f"Surface at index {index} not found"}
    return surface.to_dict()


@app.get("/api/option/price")
async def price_option(
    strike: float = Query(..., description="Strike price"),
    time_to_maturity: float = Query(..., description="Time to maturity in years"),
    option_type: str = Query("call", description="Option type: call or put"),
    use_fdm: bool = Query(False, description="Use FDM solver or analytical formula"),
    use_surface_iv: bool = Query(True, description="Use volatility surface IV")
):
    global current_surface
    
    if not market_data_manager.current_ticks:
        return {"error": "No market data available yet"}
    
    S = market_data_manager.current_ticks[0].underlying_price
    r = Config.RISK_FREE_RATE
    q = Config.DIVIDEND_YIELD
    
    surface = current_surface if use_surface_iv else None
    
    cache_key = None
    if Config.ENABLE_L2_CACHE and not use_fdm and use_surface_iv and surface:
        sigma = vol_builder.get_iv_at_point(surface, strike / S, time_to_maturity)
        cached = cache_manager.get_price(S, strike, time_to_maturity, r, q, sigma, option_type, 'analytical')
        if cached:
            return {
                'underlying_price': S,
                'strike': strike,
                'time_to_maturity': time_to_maturity,
                'option_type': option_type,
                'cached': True,
                **cached
            }
    
    calc_start = time.perf_counter()
    result = option_pricer.price_option(
        S=S,
        K=strike,
        T=time_to_maturity,
        r=r,
        q=q,
        option_type=option_type,
        surface=surface,
        use_fdm=use_fdm
    )
    calc_time_ms = (time.perf_counter() - calc_start) * 1000
    
    if Config.ENABLE_L2_CACHE and not use_fdm:
        cache_manager.put_price(
            S, strike, time_to_maturity, r, q, result['implied_volatility'],
            option_type, result['pricing_method'], result, calc_time_ms
        )
    
    return {
        'underlying_price': S,
        'strike': strike,
        'time_to_maturity': time_to_maturity,
        'option_type': option_type,
        'calc_time_ms': calc_time_ms,
        **result
    }


@app.get("/api/iv/calculate")
async def calculate_iv(
    strike: float = Query(...),
    time_to_maturity: float = Query(...),
    market_price: float = Query(...),
    option_type: str = Query("call")
):
    if not market_data_manager.current_ticks:
        return {"error": "No market data available yet"}
    
    S = market_data_manager.current_ticks[0].underlying_price
    r = Config.RISK_FREE_RATE
    q = Config.DIVIDEND_YIELD
    
    if Config.ENABLE_L2_CACHE:
        cached = cache_manager.get_iv(S, strike, time_to_maturity, r, q, market_price, option_type)
        if cached:
            return {
                'underlying_price': S,
                'strike': strike,
                'time_to_maturity': time_to_maturity,
                'market_price': market_price,
                'option_type': option_type,
                'implied_volatility': cached if cached > 0 else None,
                'cached': True
            }
    
    calc_start = time.perf_counter()
    if Config.ENABLE_CPP_EXTENSION:
        try:
            import pricing_kernel_cpp as pk
            iv = pk.calculate_implied_volatility(
                S, K=strike, T=time_to_maturity, r=r, q=q,
                market_price=market_price, option_type=ord(option_type[0].upper())
            )
        except ImportError:
            from fdm_solver import calculate_implied_volatility
            iv = calculate_implied_volatility(S, strike, time_to_maturity, r, q, market_price, option_type)
    else:
        from fdm_solver import calculate_implied_volatility
        iv = calculate_implied_volatility(S, strike, time_to_maturity, r, q, market_price, option_type)
    
    calc_time_ms = (time.perf_counter() - calc_start) * 1000
    
    if Config.ENABLE_L2_CACHE and iv > 0:
        cache_manager.put_iv(
            S, strike, time_to_maturity, r, q, market_price, option_type, iv, calc_time_ms
        )
    
    return {
        'underlying_price': S,
        'strike': strike,
        'time_to_maturity': time_to_maturity,
        'market_price': market_price,
        'option_type': option_type,
        'implied_volatility': iv if iv > 0 else None,
        'calc_time_ms': calc_time_ms
    }


@app.get("/api/underlying/history")
async def get_underlying_history():
    return {"history": market_data_manager.underlying_history}


@app.post("/api/cache/clear")
async def clear_cache():
    cache_manager.clear()
    vol_builder.clear_cache()
    return {"status": "success", "message": "Cache cleared"}


@app.get("/api/arbitrage/current")
async def get_current_arbitrage():
    return {
        'opportunities': [opp.to_dict() for opp in current_arbitrage_opportunities],
        'stats': arbitrage_detector.get_stats()
    }


@app.get("/api/arbitrage/history")
async def get_arbitrage_history(limit: int = Query(100, description="Number of history items")):
    history = [opp.to_dict() for opp in arbitrage_detector.detection_history[-limit:]]
    return {
        'history': history,
        'stats': arbitrage_detector.get_stats()
    }


@app.post("/api/arbitrage/check")
async def check_arbitrage_manual(call_price: float, put_price: float,
                                  strike: float, time_to_maturity: float):
    if not market_data_manager.current_ticks:
        return {"error": "No market data available"}
    
    S = market_data_manager.current_ticks[0].underlying_price
    r = Config.RISK_FREE_RATE
    q = Config.DIVIDEND_YIELD
    
    is_valid, parity_value, msg = arbitrage_detector.check_put_call_parity(
        S, strike, time_to_maturity, r, q, call_price, put_price
    )
    
    return {
        'valid': is_valid,
        'parity_value': float(parity_value),
        'message': msg,
        'parameters': {
            'underlying_price': S,
            'strike': strike,
            'time_to_maturity': time_to_maturity,
            'call_price': call_price,
            'put_price': put_price
        }
    }


@app.get("/api/greeks/current")
async def get_current_greeks():
    if current_greeks is None:
        return {"error": "No greeks data available yet"}
    return current_greeks.to_dict()


@app.get("/api/greeks/calculate")
async def calculate_greeks_point(strike: float, time_to_maturity: float,
                                 option_type: str = "call", volatility: float = None):
    if not market_data_manager.current_ticks:
        return {"error": "No market data available yet"}
    
    S = market_data_manager.current_ticks[0].underlying_price
    r = Config.RISK_FREE_RATE
    q = Config.DIVIDEND_YIELD
    
    if volatility is None and current_surface:
        sigma = vol_builder.get_iv_at_point(current_surface, strike / S, time_to_maturity)
    else:
        sigma = volatility or 0.2
    
    from fdm_solver import black_scholes_analytical
    price, delta, gamma, theta, vega = black_scholes_analytical(
        S, strike, time_to_maturity, r, q, sigma, option_type
    )
    
    return {
        'underlying_price': S,
        'strike': strike,
        'time_to_maturity': time_to_maturity,
        'option_type': option_type,
        'volatility': sigma,
        'price': float(price),
        'delta': float(delta),
        'gamma': float(gamma),
        'theta': float(theta),
        'vega': float(vega)
    }


@app.get("/api/montecarlo/simulate")
@app.post("/api/montecarlo/simulate")
async def run_monte_carlo(
    S0: float = 4.0,
    K: float = 4.0,
    T: float = 0.083,
    r: float = 0.025,
    q: float = 0.0,
    sigma: float = 0.2,
    option_type: str = "call",
    n_paths: int = 10000,
    n_steps: int = 252,
    calc_greeks: bool = True
):
    start_time = time.perf_counter()
    
    result = mc_simulator.price_european_option_mc(
        S0=S0, K=K, T=T, r=r, q=q, sigma=sigma,
        option_type=option_type,
        n_paths=n_paths, n_steps=n_steps
    )
    
    greeks = None
    if calc_greeks:
        greeks = mc_simulator.simulate_greeks_mc(
            S0=S0, K=K, T=T, r=r, q=q, sigma=sigma,
            option_type=option_type,
            n_paths=min(n_paths, 2000)
        )
    
    elapsed_ms = (time.perf_counter() - start_time) * 1000
    
    final_result = {
        'price': result['price'],
        'stdError': result['std_error'],
        'confidenceInterval': result['confidence_interval'],
        'nPaths': result['n_paths'],
        'nSteps': result['n_steps'],
        'paths': result.get('paths', [])
    }
    
    if greeks:
        final_result.update(greeks)
    
    return {
        'result': final_result,
        'calculation_time_ms': elapsed_ms,
        'parameters': {
            'S0': S0, 'K': K, 'T': T, 'r': r, 'q': q,
            'sigma': sigma, 'option_type': option_type,
            'n_paths': n_paths, 'n_steps': n_steps
        }
    }


@app.get("/api/backtest/run")
@app.post("/api/backtest/run")
async def run_backtest(
    request: Request,
    start_date: str = Query("2024-01-01", description="Start date YYYY-MM-DD"),
    end_date: str = Query("2024-12-31", description="End date YYYY-MM-DD"),
    initial_cash: float = 100000.0,
    strategy: str = Query("delta_neutral", description="Strategy type"),
    delta_target: float = 0.0,
    delta_tolerance: float = 0.1
):
    from datetime import datetime
    
    if request.method == "POST":
        try:
            body = await request.json()
            start_date = body.get('start_date', start_date)
            end_date = body.get('end_date', end_date)
            initial_cash = body.get('initial_cash', initial_cash)
            strategy = body.get('strategy', strategy)
            delta_target = body.get('delta_target', delta_target)
            delta_tolerance = body.get('delta_tolerance', delta_tolerance)
        except:
            pass
    
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    
    start_time = time.perf_counter()
    
    result = run_delta_neutral_backtest(start, end, initial_cash, delta_target, delta_tolerance)
    
    elapsed_ms = (time.perf_counter() - start_time) * 1000
    
    return {
        'result': result.to_dict(),
        'calculation_time_ms': elapsed_ms,
        'strategy_config': {
            'type': strategy,
            'initial_cash': initial_cash,
            'delta_target': delta_target,
            'delta_tolerance': delta_tolerance
        }
    }


@app.get("/api/backtest/strategies")
async def get_available_strategies():
    return {
        'strategies': [
            {
                'id': 'delta_neutral',
                'name': 'Delta中性对冲',
                'description': '保持组合Delta在目标范围内，自动对冲Delta敞口',
                'parameters': [
                    {'name': 'delta_target', 'type': 'float', 'default': 0.0, 'description': '目标Delta值'},
                    {'name': 'delta_tolerance', 'type': 'float', 'default': 0.1, 'description': 'Delta偏离容差'}
                ]
            },
            {
                'id': 'long_call',
                'name': '买入认购期权',
                'description': '简单买入认购期权策略',
                'parameters': []
            },
            {
                'id': 'covered_call',
                'name': '备兑认购期权',
                'description': '持有现货同时卖出认购期权',
                'parameters': []
            }
        ]
    }


@app.post("/api/backtest/custom")
async def run_custom_backtest(body: Dict):
    from datetime import datetime
    
    start_date = body.get('start_date', '2024-01-01')
    end_date = body.get('end_date', '2024-12-31')
    initial_cash = body.get('initial_cash', 100000.0)
    strategy_config = body.get('strategy_config', {})
    
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    
    start_time = time.perf_counter()
    
    config = StrategyConfig(
        initial_cash=initial_cash,
        delta_target=strategy_config.get('delta_target', 0.0),
        delta_tolerance=strategy_config.get('delta_tolerance', 0.1),
        use_delta_hedging=strategy_config.get('use_delta_hedging', True)
    )
    
    strategy = DeltaNeutralStrategy(config)
    engine = BacktestEngine(strategy)
    
    historical_data = engine.generate_historical_data(start, end)
    
    options_data = []
    for _, row in historical_data.iterrows():
        options_data.append(engine._generate_options(
            row['underlying_price'], row['volatility'], row['timestamp']
        ))
    
    result = engine.run_backtest(historical_data, options_data)
    
    elapsed_ms = (time.perf_counter() - start_time) * 1000
    
    return {
        'result': result.to_dict(),
        'calculation_time_ms': elapsed_ms,
        'strategy_config': config.__dict__
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    logger.info(f"新WebSocket连接。总数: {len(active_connections)}")
    
    try:
        if current_surface:
            snapshot = market_data_manager.get_current_snapshot()
            snapshot['surface'] = current_surface.to_dict()
            snapshot['stats'] = processing_stats
            await websocket.send_text(json.dumps({
                'type': 'initial_snapshot',
                'data': snapshot
            }, default=str))
        
        while True:
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                await handle_client_message(websocket, message)
            except json.JSONDecodeError:
                logger.warning(f"无效的JSON: {data}")
            
    except WebSocketDisconnect:
        logger.info("WebSocket断开连接")
    except Exception as e:
        logger.error(f"WebSocket错误: {e}")
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)
        logger.info(f"WebSocket移除。总数: {len(active_connections)}")


async def handle_client_message(websocket: WebSocket, message: Dict):
    msg_type = message.get('type')
    
    if msg_type == 'get_surface_history':
        history = vol_builder.get_history()
        await websocket.send_text(json.dumps({
            'type': 'surface_history',
            'data': {'history': history}
        }, default=str))
    
    elif msg_type == 'get_surface_at':
        index = message.get('index', 0)
        surface = vol_builder.get_surface_at_index(index)
        if surface:
            await websocket.send_text(json.dumps({
                'type': 'surface_at_index',
                'data': {
                    'index': index,
                    'surface': surface.to_dict()
                }
            }, default=str))
    
    elif msg_type == 'get_underlying_history':
        await websocket.send_text(json.dumps({
            'type': 'underlying_history',
            'data': {'history': market_data_manager.underlying_history}
        }, default=str))
    
    elif msg_type == 'get_stats':
        await websocket.send_text(json.dumps({
            'type': 'performance_stats',
            'data': {
                'processing': processing_stats,
                'downsampler': downsampler.stats(),
                'cache': cache_manager.stats(),
                'surface_builder': vol_builder.stats()
            }
        }, default=str))
    
    elif msg_type == 'price_option':
        params = message.get('params', {})
        result = await price_option(
            strike=params.get('strike', 4.0),
            time_to_maturity=params.get('time_to_maturity', 0.083),
            option_type=params.get('option_type', 'call'),
            use_fdm=params.get('use_fdm', False),
            use_surface_iv=params.get('use_surface_iv', True)
        )
        await websocket.send_text(json.dumps({
            'type': 'option_price',
            'data': result
        }, default=str))
    
    elif msg_type == 'get_arbitrage':
        await websocket.send_text(json.dumps({
            'type': 'arbitrage_data',
            'data': {
                'opportunities': [opp.to_dict() for opp in current_arbitrage_opportunities],
                'stats': arbitrage_detector.get_stats()
            }
        }, default=str))
    
    elif msg_type == 'get_greeks':
        if current_greeks:
            await websocket.send_text(json.dumps({
                'type': 'greeks_data',
                'data': current_greeks.to_dict()
            }, default=str))
    
    elif msg_type == 'run_montecarlo':
        params = message.get('params', {})
        result = await run_monte_carlo(
            S0=params.get('S0', 4.0),
            K=params.get('K', 4.0),
            T=params.get('T', 0.083),
            r=params.get('r', 0.025),
            q=params.get('q', 0.0),
            sigma=params.get('sigma', 0.2),
            option_type=params.get('option_type', 'call'),
            n_paths=params.get('n_paths', 5000),
            n_steps=params.get('n_steps', 252),
            calc_greeks=params.get('calc_greeks', True)
        )
        await websocket.send_text(json.dumps({
            'type': 'montecarlo_result',
            'data': result
        }, default=str))
    
    elif msg_type == 'run_backtest':
        params = message.get('params', {})
        result = await run_backtest(
            start_date=params.get('start_date', '2024-01-01'),
            end_date=params.get('end_date', '2024-12-31'),
            initial_cash=params.get('initial_cash', 100000.0),
            strategy=params.get('strategy', 'delta_neutral'),
            delta_target=params.get('delta_target', 0.0),
            delta_tolerance=params.get('delta_tolerance', 0.1)
        )
        await websocket.send_text(json.dumps({
            'type': 'backtest_result',
            'data': result
        }, default=str))


app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    logger.info(f"启动服务器在 {Config.SERVER_HOST}:{Config.SERVER_PORT}")
    uvicorn.run(
        "main_optimized:app",
        host=Config.SERVER_HOST,
        port=Config.SERVER_PORT,
        workers=1,
        loop="asyncio"
    )
