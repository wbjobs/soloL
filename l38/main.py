import asyncio
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from config import Config
from market_data import MarketDataManager, OptionTick
from volatility_surface import VolatilitySurfaceBuilder, OptionPricer, VolatilitySurface
from fdm_solver import BlackScholesFDM, FDMConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

market_data_manager = MarketDataManager()
vol_builder = VolatilitySurfaceBuilder()
option_pricer = OptionPricer()
current_surface: Optional[VolatilitySurface] = None

active_connections: List[WebSocket] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await market_data_manager.start()
    market_data_manager.subscribe(on_tick_update)
    
    logger.info("Application started successfully")
    yield
    
    await market_data_manager.stop()
    logger.info("Application shutdown complete")


app = FastAPI(lifespan=lifespan, title="股票期权定价与波动率曲面系统")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def on_tick_update(ticks: List[OptionTick]):
    global current_surface
    
    try:
        current_surface = vol_builder.build_surface(ticks, ticks[0].timestamp)
        
        data = {
            'type': 'tick_update',
            'data': {
                'timestamp': ticks[0].timestamp.isoformat(),
                'underlying_price': ticks[0].underlying_price,
                'underlying_symbol': Config.UNDERLYING_SYMBOL,
                'underlying_name': Config.UNDERLYING_NAME,
                'surface': current_surface.to_dict(),
                'ticks': [t.to_dict() for t in ticks[:20]]
            }
        }
        
        for connection in active_connections:
            try:
                await connection.send_text(json.dumps(data, default=str))
            except Exception as e:
                logger.warning(f"Failed to send to client: {e}")
    except Exception as e:
        logger.error(f"Error processing tick update: {e}")


@app.get("/")
async def root():
    return FileResponse("static/index.html")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/api/snapshot")
async def get_snapshot():
    snapshot = market_data_manager.get_current_snapshot()
    if current_surface:
        snapshot['surface'] = current_surface.to_dict()
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
    
    return {
        'underlying_price': S,
        'strike': strike,
        'time_to_maturity': time_to_maturity,
        'option_type': option_type,
        **result
    }


@app.post("/api/option/fdm_price")
async def fdm_price_option(
    strike: float = Query(...),
    time_to_maturity: float = Query(...),
    option_type: str = Query("call"),
    sigma: float = Query(0.2, description="Volatility")
):
    if not market_data_manager.current_ticks:
        return {"error": "No market data available yet"}
    
    S = market_data_manager.current_ticks[0].underlying_price
    r = Config.RISK_FREE_RATE
    q = Config.DIVIDEND_YIELD
    
    fdm_config = FDMConfig(scheme='implicit', spot_points=100, time_points=200)
    fdm = BlackScholesFDM(fdm_config)
    
    result = fdm.price(1.0, strike/S, time_to_maturity, r, q, sigma, option_type)
    price, delta, gamma, theta = fdm.get_price_at_spot(result, S)
    
    return {
        'underlying_price': S,
        'strike': strike,
        'time_to_maturity': time_to_maturity,
        'option_type': option_type,
        'volatility': sigma,
        'price': price,
        'delta': delta,
        'gamma': gamma,
        'theta': theta,
        'fdm_config': {
            'spot_points': fdm_config.spot_points,
            'time_points': fdm_config.time_points,
            'scheme': fdm_config.scheme
        }
    }


@app.get("/api/iv/calculate")
async def calculate_iv(
    strike: float = Query(...),
    time_to_maturity: float = Query(...),
    market_price: float = Query(...),
    option_type: str = Query("call")
):
    from fdm_solver import calculate_implied_volatility
    
    if not market_data_manager.current_ticks:
        return {"error": "No market data available yet"}
    
    S = market_data_manager.current_ticks[0].underlying_price
    r = Config.RISK_FREE_RATE
    q = Config.DIVIDEND_YIELD
    
    iv = calculate_implied_volatility(S, strike, time_to_maturity, r, q, market_price, option_type)
    
    return {
        'underlying_price': S,
        'strike': strike,
        'time_to_maturity': time_to_maturity,
        'market_price': market_price,
        'option_type': option_type,
        'implied_volatility': iv if not np.isnan(iv) else None
    }


@app.get("/api/underlying/history")
async def get_underlying_history():
    return {"history": market_data_manager.underlying_history}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    logger.info(f"New WebSocket connection. Total: {len(active_connections)}")
    
    try:
        if current_surface:
            snapshot = market_data_manager.get_current_snapshot()
            snapshot['surface'] = current_surface.to_dict()
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
                logger.warning(f"Invalid JSON from client: {data}")
            
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        active_connections.remove(websocket)
        logger.info(f"WebSocket removed. Total: {len(active_connections)}")


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


app.mount("/static", StaticFiles(directory="static"), name="static")


if __name__ == "__main__":
    logger.info(f"Starting server on {Config.SERVER_HOST}:{Config.SERVER_PORT}")
    uvicorn.run(app, host=Config.SERVER_HOST, port=Config.SERVER_PORT)
