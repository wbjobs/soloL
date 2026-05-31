use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post, put},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;
use tokio::sync::RwLock;

use crate::kademlia::{KademliaDht, NodeContact, NodeId};
use crate::storage::{ConfigStore, ConfigRecord, Snapshot};
use crate::sync::{ConfigEntry, SyncProtocol};
use crate::tunnel::{CandidateType, TunnelManager, TunnelStatus, TunnelCreateRequest, IceCandidate};
use crate::network::DualStackConfig;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Internal server error: {0}")]
    Internal(String),
    #[error("Conflict: {0}")]
    Conflict(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
        };

        let body = serde_json::json!({
            "error": self.to_string(),
            "code": status.as_u16(),
            "timestamp": Utc::now().to_rfc3339(),
        });

        (status, Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Clone)]
pub struct AppState {
    pub tunnel_manager: Arc<RwLock<TunnelManager>>,
    pub config_store: Arc<ConfigStore>,
    pub dht: Arc<RwLock<KademliaDht>>,
    pub sync_protocol: Arc<SyncProtocol>,
    pub node_id: String,
}

#[derive(Debug, Deserialize)]
pub struct TunnelCreateRequestDto {
    pub peer_addr: Option<String>,
    pub listen_port: u16,
    pub stream_id: Option<u16>,
    pub ipv6_only: Option<bool>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TunnelResponse {
    pub tunnel_id: String,
    pub peer_addr: Option<String>,
    pub local_addr: String,
    pub state: String,
    pub created_at: String,
    pub nat_type: Option<String>,
    pub description: Option<String>,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

impl From<&TunnelStatus> for TunnelResponse {
    fn from(status: &TunnelStatus) -> Self {
        let local_addr = status.local_candidates
            .iter()
            .find(|c| c.candidate_type == CandidateType::Host)
            .map(|c| format!("{}:{}", c.ip, c.port))
            .unwrap_or_else(|| "unknown".to_string());

        let peer_addr = status.remote_candidates
            .first()
            .map(|c| format!("{}:{}", c.ip, c.port));

        Self {
            tunnel_id: status.tunnel_id.to_string(),
            peer_addr,
            local_addr,
            state: format!("{:?}", status.state),
            created_at: status.created_at.to_rfc3339(),
            nat_type: Some(format!("{}", status.nat_type)),
            description: None,
            bytes_sent: status.bytes_sent,
            bytes_received: status.bytes_received,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ConfigRequest {
    pub value: Value,
    pub version: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ConfigResponse {
    pub key: String,
    pub value: Value,
    pub version: u64,
    pub timestamp: String,
    pub checksum: String,
}

impl From<&ConfigRecord> for ConfigResponse {
    fn from(record: &ConfigRecord) -> Self {
        let value = serde_json::from_slice(&record.value).unwrap_or(Value::Null);
        Self {
            key: record.key.clone(),
            value,
            version: record.version,
            timestamp: record.timestamp.to_rfc3339(),
            checksum: record.checksum.clone(),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SyncRequest {
    pub peer_node_id: Option<String>,
    pub key_prefix: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SyncResponse {
    pub entries_applied: usize,
    pub conflicts_resolved: usize,
    pub sync_duration_ms: i64,
    pub root_hash: String,
    pub entries_synced: usize,
}

#[derive(Debug, Deserialize)]
pub struct SnapshotRequest {
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct SnapshotResponse {
    pub name: String,
    pub created_at: String,
    pub entry_count: usize,
    pub version: u64,
}

impl From<&Snapshot> for SnapshotResponse {
    fn from(snap: &Snapshot) -> Self {
        Self {
            name: snap.name.clone(),
            created_at: snap.created_at.to_rfc3339(),
            entry_count: snap.entry_count,
            version: snap.version,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SystemStatus {
    pub node_id: String,
    pub tunnel_count: usize,
    pub config_count: usize,
    pub dht_nodes: usize,
    pub current_version: u64,
    pub ipv6_enabled: bool,
    pub dual_stack: bool,
    pub started_at: String,
}

#[derive(Debug, Deserialize)]
pub struct DhtBootstrapRequest {
    pub bootstrap_nodes: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct DhtStoreRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct NatDetectRequest {
    pub stun_server: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NatDetectResponse {
    pub nat_type: String,
    pub public_addr: Option<String>,
    pub local_addr: String,
}

#[derive(Debug, Deserialize)]
pub struct CandidateExchangeRequest {
    pub candidates: Vec<IceCandidateDto>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IceCandidateDto {
    pub candidate_type: String,
    pub ip: String,
    pub port: u16,
    pub protocol: String,
    pub priority: u32,
    pub foundation: String,
    pub component_id: u16,
}

impl From<&IceCandidate> for IceCandidateDto {
    fn from(c: &IceCandidate) -> Self {
        Self {
            candidate_type: format!("{}", c.candidate_type).to_lowercase(),
            ip: c.ip.to_string(),
            port: c.port,
            protocol: c.protocol.clone(),
            priority: c.priority,
            foundation: c.foundation.clone(),
            component_id: c.component_id,
        }
    }
}

impl TryFrom<&IceCandidateDto> for IceCandidate {
    type Error = ApiError;

    fn try_from(dto: &IceCandidateDto) -> Result<Self, Self::Error> {
        let candidate_type = match dto.candidate_type.as_str() {
            "host" => CandidateType::Host,
            "srflx" => CandidateType::Srflx,
            "relay" => CandidateType::Relay,
            other => return Err(ApiError::BadRequest(format!("invalid candidate type: {}", other))),
        };

        let ip = dto.ip.parse().map_err(|e| ApiError::BadRequest(format!("invalid ip: {}", e)))?;

        Ok(IceCandidate {
            candidate_type,
            ip,
            port: dto.port,
            protocol: dto.protocol.clone(),
            priority: dto.priority,
            foundation: dto.foundation.clone(),
            component_id: dto.component_id,
            related_address: None,
            related_port: None,
        })
    }
}

#[derive(Debug, Serialize)]
pub struct DiffResponse {
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub deleted: Vec<String>,
    pub local_root: String,
}

pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/status", get(get_system_status))
        .nest("/tunnels", tunnel_routes())
        .nest("/config", config_routes())
        .nest("/dht", dht_routes())
        .nest("/sync", sync_routes())
        .nest("/snapshots", snapshot_routes())
        .with_state(state)
}

fn tunnel_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_tunnels))
        .route("/", post(create_tunnel))
        .route("/:id", get(get_tunnel))
        .route("/:id", delete(close_tunnel))
        .route("/:id/detect-nat", post(detect_nat))
        .route("/:id/candidates", post(exchange_candidates))
        .route("/:id/candidates", get(get_candidates))
        .route("/:id/heartbeat", post(send_heartbeat))
}

fn config_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_config))
        .route("/batch", post(batch_write))
        .route("/compact", post(compact))
        .route("/:key", get(get_config))
        .route("/:key", put(put_config))
        .route("/:key", delete(delete_config))
        .route("/:key/versions", get(get_config_versions))
}

fn dht_routes() -> Router<AppState> {
    Router::new()
        .route("/bootstrap", post(bootstrap_dht))
        .route("/nodes", get(dht_nodes))
        .route("/store", post(dht_store))
        .route("/peers", get(dht_peers))
        .route("/refresh", post(dht_refresh))
        .route("/find/:key", get(dht_find))
}

fn sync_routes() -> Router<AppState> {
    Router::new()
        .route("/", post(start_sync))
        .route("/status", get(sync_status))
        .route("/diff", get(compute_diff))
        .route("/root", get(get_root_hash))
        .route("/force", post(force_sync))
}

fn snapshot_routes() -> Router<AppState> {
    Router::new()
        .route("/", get(list_snapshots))
        .route("/", post(create_snapshot))
        .route("/:name", delete(delete_snapshot))
        .route("/:name/restore", post(restore_snapshot))
}

async fn health_check() -> impl IntoResponse {
    let body = serde_json::json!({
        "status": "ok",
        "timestamp": Utc::now().to_rfc3339(),
    });
    (StatusCode::OK, Json(body))
}

async fn get_system_status(State(state): State<AppState>) -> ApiResult<Json<SystemStatus>> {
    let tunnel_manager = state.tunnel_manager.read().await;
    let dht = state.dht.read().await;

    let tunnel_count = tunnel_manager.list_tunnels_str().await.len();
    let config_count = state.config_store.list(None)
        .map_err(|e| ApiError::Internal(e.to_string()))?.len();
    let dht_nodes = dht.get_routing_table().all_nodes().len();
    let current_version = state.config_store.get_current_version();

    Ok(Json(SystemStatus {
        node_id: state.node_id.clone(),
        tunnel_count,
        config_count,
        dht_nodes,
        current_version,
        ipv6_enabled: true,
        dual_stack: true,
        started_at: Utc::now().to_rfc3339(),
    }))
}

async fn list_tunnels(State(state): State<AppState>) -> ApiResult<Json<Vec<TunnelResponse>>> {
    let manager = state.tunnel_manager.read().await;
    let tunnel_ids = manager.list_tunnels_str().await;

    let mut tunnels = Vec::new();
    for id in tunnel_ids {
        if let Ok(status) = manager.get_tunnel_status_str(&id).await {
            tunnels.push(TunnelResponse::from(&status));
        }
    }

    Ok(Json(tunnels))
}

async fn create_tunnel(
    State(state): State<AppState>,
    Json(req): Json<TunnelCreateRequestDto>,
) -> ApiResult<Json<TunnelResponse>> {
    let manager = state.tunnel_manager.read().await;

    let remote_addr = match req.peer_addr {
        Some(addr) => addr.parse::<SocketAddr>()
            .map_err(|e| ApiError::BadRequest(format!("invalid peer_addr: {}", e)))?,
        None => {
            let ip = if req.ipv6_only.unwrap_or(false) {
                "[::1]".parse().unwrap()
            } else {
                "127.0.0.1".parse().unwrap()
            };
            SocketAddr::new(ip, 0)
        }
    };

    let request = TunnelCreateRequest {
        remote_addr,
        stream_id: req.stream_id,
        ipv6_only: req.ipv6_only.unwrap_or(false),
        stun_servers: vec![
            "stun.l.google.com:19302".parse().unwrap(),
            "stun1.l.google.com:19302".parse().unwrap(),
        ],
    };

    let tunnel_id = manager.create_tunnel(request)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let status = manager.get_tunnel_status(tunnel_id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(TunnelResponse::from(&status)))
}

async fn get_tunnel(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<TunnelResponse>> {
    let manager = state.tunnel_manager.read().await;
    let status = manager.get_tunnel_status_str(&id)
        .await
        .map_err(|e| ApiError::NotFound(format!("Tunnel {} not found: {}", id, e)))?;

    Ok(Json(TunnelResponse::from(&status)))
}

async fn close_tunnel(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<impl IntoResponse> {
    let manager = state.tunnel_manager.read().await;
    manager.close_tunnel_str(&id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::NO_CONTENT, ""))
}

async fn detect_nat(
    State(state): State<AppState>,
    Path(_id): Path<String>,
    Json(req): Json<NatDetectRequest>,
) -> ApiResult<Json<NatDetectResponse>> {
    let manager = state.tunnel_manager.read().await;

    let nat_type = manager.detect_nat_type_with_servers(req.stun_server.as_deref())
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(NatDetectResponse {
        nat_type: format!("{}", nat_type),
        public_addr: None,
        local_addr: format!("{}", nat_type),
    }))
}

async fn exchange_candidates(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<CandidateExchangeRequest>,
) -> ApiResult<Json<Vec<IceCandidateDto>>> {
    let manager = state.tunnel_manager.read().await;

    let remote_candidates: Result<Vec<IceCandidate>, _> = req.candidates
        .iter()
        .map(IceCandidate::try_from)
        .collect();
    let remote_candidates = remote_candidates?;

    let local_candidates = manager.exchange_candidates_str(&id, remote_candidates)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let response: Vec<IceCandidateDto> = local_candidates
        .iter()
        .map(IceCandidateDto::from)
        .collect();

    Ok(Json(response))
}

async fn get_candidates(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<Vec<IceCandidateDto>>> {
    let manager = state.tunnel_manager.read().await;

    let local_candidates = manager.get_local_candidates(&id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let response: Vec<IceCandidateDto> = local_candidates
        .iter()
        .map(IceCandidateDto::from)
        .collect();

    Ok(Json(response))
}

async fn send_heartbeat(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<impl IntoResponse> {
    let manager = state.tunnel_manager.read().await;
    manager.send_heartbeat_str(&id)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))))
}

async fn list_config(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult<Json<Vec<ConfigResponse>>> {
    let prefix = params.get("prefix").map(|s| s.as_str());
    let records = state.config_store.list(prefix)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let responses: Vec<ConfigResponse> = records.iter().map(ConfigResponse::from).collect();
    Ok(Json(responses))
}

async fn get_config(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<Json<ConfigResponse>> {
    let record = state.config_store.get(&key)
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound(format!("Config key '{}' not found", key)))?;

    Ok(Json(ConfigResponse::from(&record)))
}

async fn put_config(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(req): Json<ConfigRequest>,
) -> ApiResult<Json<ConfigResponse>> {
    let value_bytes = serde_json::to_vec(&req.value)
        .map_err(|e| ApiError::BadRequest(format!("Invalid JSON: {}", e)))?;

    let record = state.config_store.put(&key, &value_bytes)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(ConfigResponse::from(&record)))
}

async fn delete_config(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<impl IntoResponse> {
    state.config_store.delete(&key)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::NO_CONTENT, ""))
}

async fn get_config_versions(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<Json<Vec<crate::storage::VersionEntry>>> {
    let versions = state.config_store.get_version_history(&key)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(versions))
}

#[derive(Debug, Deserialize)]
struct BatchOp {
    key: String,
    value: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct BatchRequest {
    operations: Vec<BatchOp>,
}

async fn batch_write(
    State(state): State<AppState>,
    Json(req): Json<BatchRequest>,
) -> ApiResult<Json<Vec<ConfigResponse>>> {
    let ops: Vec<(String, Option<Vec<u8>>)> = req.operations
        .iter()
        .map(|op| {
            let value = op.value.as_ref().map(|v| {
                serde_json::to_vec(v).unwrap_or_default()
            });
            (op.key.clone(), value)
        })
        .collect();

    let records = state.config_store.batch_write(ops)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let responses: Vec<ConfigResponse> = records.iter().map(ConfigResponse::from).collect();
    Ok(Json(responses))
}

async fn compact(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    state.config_store.compact()
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))))
}

async fn bootstrap_dht(
    State(state): State<AppState>,
    Json(req): Json<DhtBootstrapRequest>,
) -> ApiResult<impl IntoResponse> {
    let mut dht = state.dht.write().await;

    let bootstrap_nodes: Vec<NodeContact> = req.bootstrap_nodes
        .iter()
        .filter_map(|s| {
            let parts: Vec<&str> = s.split('@').collect();
            if parts.len() == 2 {
                if let (Ok(node_id), Ok(addr)) = (NodeId::from_hex(parts[0]), parts[1].parse::<SocketAddr>()) {
                    Some(NodeContact::new(node_id, addr))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect();

    dht.bootstrap(bootstrap_nodes).await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))))
}

async fn dht_nodes(State(state): State<AppState>) -> ApiResult<Json<Vec<String>>> {
    let dht = state.dht.read().await;
    let nodes = dht.get_routing_table().all_nodes();
    let addrs: Vec<String> = nodes.iter().map(|n| format!("{}@{}", n.node_id, n.ip_addr)).collect();
    Ok(Json(addrs))
}

async fn dht_store(
    State(state): State<AppState>,
    Json(req): Json<DhtStoreRequest>,
) -> ApiResult<impl IntoResponse> {
    let mut dht = state.dht.write().await;
    let key = NodeId::from_sha256(req.key.as_bytes());
    dht.store(key, req.value.into_bytes()).await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))))
}

async fn dht_find(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<Json<Value>> {
    let dht = state.dht.read().await;
    let node_id = NodeId::from_sha256(key.as_bytes());
    let result = dht.find_value(node_id).await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({
        "found": result.is_some(),
        "value": result.map(|v| String::from_utf8_lossy(&v.value).to_string()),
    })))
}

async fn dht_peers(State(state): State<AppState>) -> ApiResult<Json<Vec<String>>> {
    let dht = state.dht.read().await;
    let nodes = dht.get_routing_table().all_nodes();
    let peers: Vec<String> = nodes.iter().map(|n| n.ip_addr.to_string()).collect();
    Ok(Json(peers))
}

async fn dht_refresh(State(state): State<AppState>) -> ApiResult<impl IntoResponse> {
    let mut dht = state.dht.write().await;
    dht.refresh_buckets().await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))))
}

async fn start_sync(
    State(state): State<AppState>,
    Json(req): Json<SyncRequest>,
) -> ApiResult<Json<SyncResponse>> {
    let store = state.config_store.clone();
    let protocol = state.sync_protocol.clone();

    let local_entries = store.list(req.key_prefix.as_deref())
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let local_configs: Vec<ConfigEntry> = local_entries
        .iter()
        .map(|r| ConfigEntry {
            key: r.key.clone(),
            value: r.value.clone(),
            version: r.version,
            timestamp: r.timestamp,
        })
        .collect();

    let local_tree = protocol.build_tree_from_vec(local_configs.clone());
    let root_hash = local_tree.root_hash()
        .map(hex::encode)
        .unwrap_or_else(|| "0".repeat(64));

    Ok(Json(SyncResponse {
        entries_applied: 0,
        conflicts_resolved: 0,
        sync_duration_ms: 0,
        root_hash,
        entries_synced: local_configs.len(),
    }))
}

async fn sync_status(State(_state): State<AppState>) -> ApiResult<Json<Value>> {
    Ok(Json(serde_json::json!({
        "status": "ready",
        "protocol": "merkle-tree",
        "consistency": "eventual",
    })))
}

async fn compute_diff(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult<Json<DiffResponse>> {
    let prefix = params.get("prefix").map(|s| s.as_str());
    let store = state.config_store.clone();
    let protocol = state.sync_protocol.clone();

    let local_entries = store.list(prefix)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let local_configs: Vec<ConfigEntry> = local_entries
        .iter()
        .map(|r| ConfigEntry {
            key: r.key.clone(),
            value: r.value.clone(),
            version: r.version,
            timestamp: r.timestamp,
        })
        .collect();

    let local_tree = protocol.build_tree_from_vec(local_configs.clone());
    let remote_tree = protocol.build_tree_from_vec(local_configs);

    let diff = protocol.compute_diff(&local_tree, &remote_tree);

    Ok(Json(DiffResponse {
        added: diff.added.iter().map(|e| e.key.clone()).collect(),
        updated: diff.updated.iter().map(|e| e.key.clone()).collect(),
        deleted: diff.deleted.iter().map(|e| e.key.clone()).collect(),
        local_root: local_tree.root_hash()
            .map(hex::encode)
            .unwrap_or_else(|| "0".repeat(64)),
    }))
}

async fn get_root_hash(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let store = state.config_store.clone();
    let protocol = state.sync_protocol.clone();

    let local_entries = store.list(None)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let local_configs: Vec<ConfigEntry> = local_entries
        .iter()
        .map(|r| ConfigEntry {
            key: r.key.clone(),
            value: r.value.clone(),
            version: r.version,
            timestamp: r.timestamp,
        })
        .collect();

    let tree = protocol.build_tree_from_vec(local_configs);
    let root_hash = tree.root_hash()
        .map(hex::encode)
        .unwrap_or_else(|| "0".repeat(64));

    Ok(Json(serde_json::json!({
        "root_hash": root_hash,
        "entry_count": tree.entry_count(),
    })))
}

async fn force_sync(
    State(state): State<AppState>,
    Json(req): Json<SyncRequest>,
) -> ApiResult<Json<SyncResponse>> {
    start_sync(State(state), Json(req)).await
}

async fn list_snapshots(State(state): State<AppState>) -> ApiResult<Json<Vec<SnapshotResponse>>> {
    let snapshots = state.config_store.list_snapshots()
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let responses: Vec<SnapshotResponse> = snapshots.iter().map(SnapshotResponse::from).collect();
    Ok(Json(responses))
}

async fn create_snapshot(
    State(state): State<AppState>,
    Json(req): Json<SnapshotRequest>,
) -> ApiResult<Json<SnapshotResponse>> {
    let snapshot = state.config_store.create_snapshot(&req.name)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(SnapshotResponse::from(&snapshot)))
}

async fn delete_snapshot(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> ApiResult<impl IntoResponse> {
    state.config_store.delete_snapshot(&name)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::NO_CONTENT, ""))
}

async fn restore_snapshot(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> ApiResult<impl IntoResponse> {
    state.config_store.restore_snapshot(&name)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((StatusCode::OK, Json(serde_json::json!({ "status": "ok" }))))
}
