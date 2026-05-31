from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ChunkUploadRequest(BaseModel):
    file_id: str
    chunk_index: int
    chunk_hash: str
    total_chunks: int


class ChunkUploadResponse(BaseModel):
    file_id: str
    chunk_index: int
    verified: bool


class UploadCompleteRequest(BaseModel):
    file_id: str
    file_name: str
    total_chunks: int
    total_size: int
    chunk_hashes: list[str]


class UploadCompleteResponse(BaseModel):
    file_id: str
    torrent_url: str
    magnet_uri: str
    info_hash: str


class FileInfo(BaseModel):
    file_id: str
    file_name: str
    total_size: int
    total_chunks: int
    chunk_size: int
    seeders: int
    leechers: int
    created_at: str
    magnet_uri: str
    info_hash: Optional[str] = None
    hotness_score: Optional[float] = 0.0
    replicas_count: Optional[int] = 0
    download_count_last_minute: Optional[int] = 0


class FileListResponse(BaseModel):
    files: list[FileInfo]


class PeerInfo(BaseModel):
    peer_id: str
    ip: str
    port: int
    upload_speed: float = 0.0


class AnnounceResponse(BaseModel):
    interval: int
    peers: list[PeerInfo]


class ChunkStatus(BaseModel):
    index: int
    verified: bool


class StatsResponse(BaseModel):
    download_speed: float
    upload_speed: float
    peers_connected: int
    progress: float
    chunks_status: list[ChunkStatus]


class PeerHealthInfo(BaseModel):
    peer_id: str
    ip: str
    port: int
    upload_speed: float = 0.0
    fail_count: int = 0
    last_seen: str = ""
    last_ping: str = ""
    alive: bool = True


class PeerHealthResponse(BaseModel):
    info_hash: str
    total_peers: int
    alive_peers: int
    dead_peers: int
    peers: list[PeerHealthInfo]


class EdgeNode(BaseModel):
    id: str
    name: str
    region: str
    city: str
    lat: float
    lng: float
    capacity: int
    used_slots: int = 0
    status: str = "online"
    containers: list[str] = []


class SeederContainer(BaseModel):
    container_id: str
    node_id: str
    file_id: str
    info_hash: str
    file_name: str
    port: int
    status: str
    created_at: str
    upload_speed: float = 0.0
    download_count: int = 0


class HotnessInfo(BaseModel):
    file_id: str
    file_name: str
    info_hash: str
    download_count_last_minute: int
    download_count_window: int
    hotness_score: float
    threshold: int
    is_hot: bool
    replicas: int
    max_replicas: int
    trending_up: bool


class HotnessResponse(BaseModel):
    hot_files: list[HotnessInfo]
    total_active_files: int
    total_replicas: int
    threshold: int
    auto_replication_enabled: bool


class EdgeNodeActivity(BaseModel):
    node_id: str
    name: str
    city: str
    region: str
    lat: float
    lng: float
    activity_score: float
    container_count: int
    total_upload: float
    avg_upload_speed: float
    status: str


class HeatmapPoint(BaseModel):
    lat: float
    lng: float
    value: float
    city: str
    node_id: str
    activity_score: float
    container_count: int


class HeatmapResponse(BaseModel):
    points: list[HeatmapPoint]
    nodes: list[EdgeNodeActivity]
    timestamp: str


class ReplicaCreateRequest(BaseModel):
    file_id: str
    target_node_ids: Optional[list[str]] = None
    count: Optional[int] = None


class ReplicaRemoveRequest(BaseModel):
    container_id: str
