export interface FileInfo {
  file_id: string
  file_name: string
  total_size: number
  total_chunks: number
  chunk_size: number
  seeders: number
  leechers: number
  created_at: string
  magnet_uri: string
  info_hash?: string
  hotness_score?: number
  replicas_count?: number
  download_count_last_minute?: number
}

export interface FileListResponse {
  files: FileInfo[]
}

export interface ChunkUploadResponse {
  file_id: string
  chunk_index: number
  verified: boolean
}

export interface UploadCompleteResponse {
  file_id: string
  torrent_url: string
  magnet_uri: string
  info_hash: string
}

export interface PeerInfo {
  peer_id: string
  ip: string
  port: number
  upload_speed: number
}

export interface AnnounceResponse {
  interval: number
  peers: PeerInfo[]
}

export interface ChunkStatus {
  index: number
  verified: boolean
}

export interface StatsResponse {
  download_speed: number
  upload_speed: number
  peers_connected: number
  progress: number
  chunks_status: ChunkStatus[]
}

export interface SpeedRecord {
  timestamp: number
  download_speed: number
  upload_speed: number
  peers_connected: number
}

export interface UploadProgress {
  file_id: string
  file_name: string
  total_chunks: number
  uploaded_chunks: number
  verified_chunks: number
  total_size: number
  status: 'preparing' | 'uploading' | 'verifying' | 'completed' | 'error'
  chunk_hashes: string[]
  error?: string
}

export interface DownloadProgress {
  info_hash: string
  file_name: string
  progress: number
  download_speed: number
  upload_speed: number
  downloaded: number
  uploaded: number
  peers: number
  status: 'idle' | 'downloading' | 'seeding' | 'paused' | 'error'
  total_size: number
  chunks_status: ('pending' | 'downloading' | 'verified' | 'error')[]
  error?: string
  torrent?: any
}

export interface PeerHealthInfo {
  peer_id: string
  ip: string
  port: number
  upload_speed: number
  fail_count: number
  last_seen: string
  last_ping: string
  alive: boolean
}

export interface PeerHealthResponse {
  info_hash: string
  total_peers: number
  alive_peers: number
  dead_peers: number
  peers: PeerHealthInfo[]
}

export interface EdgeNode {
  id: string
  name: string
  region: string
  city: string
  lat: number
  lng: number
  capacity: number
  used_slots: number
  status: string
  containers: string[]
}

export interface SeederContainer {
  container_id: string
  node_id: string
  file_id: string
  info_hash: string
  file_name: string
  port: number
  status: string
  created_at: string
  upload_speed: number
  download_count: number
}

export interface HotnessInfo {
  file_id: string
  file_name: string
  info_hash: string
  download_count_last_minute: number
  download_count_window: number
  hotness_score: number
  threshold: number
  is_hot: boolean
  replicas: number
  max_replicas: number
  trending_up: boolean
}

export interface HotnessResponse {
  hot_files: HotnessInfo[]
  total_active_files: number
  total_replicas: number
  threshold: number
  auto_replication_enabled: boolean
}

export interface EdgeNodeActivity {
  node_id: string
  name: string
  city: string
  region: string
  lat: number
  lng: number
  activity_score: number
  container_count: number
  total_upload: number
  avg_upload_speed: number
  status: string
}

export interface HeatmapPoint {
  lat: number
  lng: number
  value: number
  city: string
  node_id: string
  activity_score: number
  container_count: number
}

export interface HeatmapResponse {
  points: HeatmapPoint[]
  nodes: EdgeNodeActivity[]
  timestamp: string
}

export interface ReplicaCreateRequest {
  file_id: string
  target_node_ids?: string[]
  count?: number
}

export interface ReplicaRemoveRequest {
  container_id: string
}

declare global {
  interface Window {
    L: any
    WebTorrent: typeof import('webtorrent').default
  }
}
