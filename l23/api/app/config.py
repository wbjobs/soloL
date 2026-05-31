import os

STORAGE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "storage")
CHUNKS_PATH = os.path.join(STORAGE_PATH, "chunks")
TORRENTS_PATH = os.path.join(STORAGE_PATH, "torrents")
CHUNK_SIZE = 256 * 1024

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
TRACKER_INTERVAL = 30

TRACKER_ANNOUNCE_URL = os.getenv("TRACKER_ANNOUNCE_URL", "http://localhost:8000/tracker/announce")

HEALTH_CHECK_INTERVAL = 30
HEALTH_CHECK_MAX_FAILURES = 3
HEALTH_CHECK_PING_TIMEOUT = 5

PEER_SELECT_TOP_N = 5

HOTNESS_THRESHOLD = int(os.getenv("HOTNESS_THRESHOLD", "100"))
HOTNESS_WINDOW_SECONDS = int(os.getenv("HOTNESS_WINDOW_SECONDS", "60"))
HOTNESS_CHECK_INTERVAL = int(os.getenv("HOTNESS_CHECK_INTERVAL", "30"))

DOCKER_API_URL = os.getenv("DOCKER_API_URL", "unix:///var/run/docker.sock")
SEEDER_CONTAINER_IMAGE = os.getenv("SEEDER_CONTAINER_IMAGE", "ghcr.io/webtorrent/webtorrent-hybrid:latest")
SEEDER_CONTAINER_PREFIX = "p2p-seeder-"

MAX_EDGE_NODES = int(os.getenv("MAX_EDGE_NODES", "20"))
MAX_REPLICAS_PER_FILE = int(os.getenv("MAX_REPLICAS_PER_FILE", "5"))

EDGE_NODES = [
    {"id": "edge-bj", "name": "北京节点", "region": "north", "city": "北京", "lat": 39.9042, "lng": 116.4074, "capacity": 10},
    {"id": "edge-sh", "name": "上海节点", "region": "east", "city": "上海", "lat": 31.2304, "lng": 121.4737, "capacity": 10},
    {"id": "edge-gz", "name": "广州节点", "region": "south", "city": "广州", "lat": 23.1291, "lng": 113.2644, "capacity": 10},
    {"id": "edge-sz", "name": "深圳节点", "region": "south", "city": "深圳", "lat": 22.5431, "lng": 114.0579, "capacity": 10},
    {"id": "edge-hz", "name": "杭州节点", "region": "east", "city": "杭州", "lat": 30.2741, "lng": 120.1551, "capacity": 8},
    {"id": "edge-cd", "name": "成都节点", "region": "west", "city": "成都", "lat": 30.5728, "lng": 104.0668, "capacity": 8},
    {"id": "edge-wh", "name": "武汉节点", "region": "central", "city": "武汉", "lat": 30.5928, "lng": 114.3055, "capacity": 8},
    {"id": "edge-xa", "name": "西安节点", "region": "northwest", "city": "西安", "lat": 34.3416, "lng": 108.9398, "capacity": 6},
    {"id": "edge-hk", "name": "香港节点", "region": "southeast", "city": "香港", "lat": 22.3193, "lng": 114.1694, "capacity": 6},
    {"id": "edge-sg", "name": "新加坡节点", "region": "asia", "city": "新加坡", "lat": 1.3521, "lng": 103.8198, "capacity": 5},
    {"id": "edge-tokyo", "name": "东京节点", "region": "asia", "city": "东京", "lat": 35.6762, "lng": 139.6503, "capacity": 5},
    {"id": "edge-frankfurt", "name": "法兰克福节点", "region": "europe", "city": "法兰克福", "lat": 50.1109, "lng": 8.6821, "capacity": 5},
]

os.makedirs(CHUNKS_PATH, exist_ok=True)
os.makedirs(TORRENTS_PATH, exist_ok=True)
