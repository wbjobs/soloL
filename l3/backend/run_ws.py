import asyncio
from app.ws_manager import start_ws_server

if __name__ == "__main__":
    asyncio.run(start_ws_server())
