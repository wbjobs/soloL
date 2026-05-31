from fastapi import APIRouter, Query

from app.models.schemas import AnnounceResponse, PeerHealthResponse
from app.services.services import tracker_service, hotness_service

router = APIRouter(tags=["tracker"])


@router.get("/tracker/announce", response_model=AnnounceResponse)
async def announce(
    info_hash: str = Query(...),
    peer_id: str = Query(...),
    ip: str = Query("127.0.0.1"),
    port: int = Query(...),
    event: str = Query(""),
    upload_speed: float = Query(0.0),
):
    from app.config import TRACKER_INTERVAL

    await hotness_service.record_download(info_hash)

    peers = await tracker_service.announce(
        info_hash, peer_id, ip, port, event, upload_speed
    )
    return AnnounceResponse(
        interval=TRACKER_INTERVAL,
        peers=peers,
    )


@router.get("/tracker/health/{info_hash}", response_model=PeerHealthResponse)
async def peer_health(info_hash: str):
    peer_list = await tracker_service.get_peer_health(info_hash)
    alive = [p for p in peer_list if p["alive"]]
    dead = [p for p in peer_list if not p["alive"]]
    return PeerHealthResponse(
        info_hash=info_hash,
        total_peers=len(peer_list),
        alive_peers=len(alive),
        dead_peers=len(dead),
        peers=peer_list,
    )
