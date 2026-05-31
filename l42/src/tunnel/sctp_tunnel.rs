use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use log::{debug, info, warn};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::net::UdpSocket;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NatType {
    FullCone,
    RestrictedCone,
    PortRestrictedCone,
    Symmetric,
    Unknown,
}

impl std::fmt::Display for NatType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NatType::FullCone => write!(f, "Full Cone"),
            NatType::RestrictedCone => write!(f, "Restricted Cone"),
            NatType::PortRestrictedCone => write!(f, "Port Restricted Cone"),
            NatType::Symmetric => write!(f, "Symmetric NAT"),
            NatType::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CandidateType {
    Host,
    Srflx,
    Relay,
}

impl std::fmt::Display for CandidateType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CandidateType::Host => write!(f, "host"),
            CandidateType::Srflx => write!(f, "srflx"),
            CandidateType::Relay => write!(f, "relay"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IceCandidate {
    pub candidate_type: CandidateType,
    pub ip: IpAddr,
    pub port: u16,
    pub protocol: String,
    pub priority: u32,
    pub foundation: String,
    pub component_id: u16,
    pub related_address: Option<IpAddr>,
    pub related_port: Option<u16>,
}

impl IceCandidate {
    pub fn new_host(ip: IpAddr, port: u16) -> Self {
        let foundation = Self::compute_foundation(&CandidateType::Host, &ip);
        Self {
            candidate_type: CandidateType::Host,
            ip,
            port,
            protocol: "udp".to_string(),
            priority: Self::compute_priority(&CandidateType::Host, 1),
            foundation,
            component_id: 1,
            related_address: None,
            related_port: None,
        }
    }

    pub fn new_srflx(ip: IpAddr, port: u16, base_ip: IpAddr, base_port: u16) -> Self {
        let foundation = Self::compute_foundation(&CandidateType::Srflx, &ip);
        Self {
            candidate_type: CandidateType::Srflx,
            ip,
            port,
            protocol: "udp".to_string(),
            priority: Self::compute_priority(&CandidateType::Srflx, 1),
            foundation,
            component_id: 1,
            related_address: Some(base_ip),
            related_port: Some(base_port),
        }
    }

    pub fn new_relay(ip: IpAddr, port: u16) -> Self {
        let foundation = Self::compute_foundation(&CandidateType::Relay, &ip);
        Self {
            candidate_type: CandidateType::Relay,
            ip,
            port,
            protocol: "udp".to_string(),
            priority: Self::compute_priority(&CandidateType::Relay, 1),
            foundation,
            component_id: 1,
            related_address: None,
            related_port: None,
        }
    }

    fn compute_foundation(candidate_type: &CandidateType, ip: &IpAddr) -> String {
        let mut hasher = Sha256::new();
        hasher.update(format!("{}{}", candidate_type, ip).as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..4])
    }

    fn compute_priority(candidate_type: &CandidateType, local_preference: u32) -> u32 {
        let type_preference: u32 = match candidate_type {
            CandidateType::Host => 126,
            CandidateType::Srflx => 100,
            CandidateType::Relay => 0,
        };
        (type_preference << 24) | ((local_preference & 0xFFFF) << 8) | (1 as u32 & 0xFF)
    }

    pub fn is_ipv6(&self) -> bool {
        self.ip.is_ipv6()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SctpTunnelConfig {
    pub local_addr: SocketAddr,
    pub remote_addr: SocketAddr,
    pub port: u16,
    pub stream_id: u16,
    pub ipv6_only: bool,
    pub compression_level: i32,
    pub compression_enabled: bool,
}

impl SctpTunnelConfig {
    pub fn new(local_addr: SocketAddr, remote_addr: SocketAddr) -> Self {
        let port = local_addr.port();
        Self {
            local_addr,
            remote_addr,
            port,
            stream_id: 0,
            ipv6_only: local_addr.is_ipv6(),
            compression_level: 3,
            compression_enabled: true,
        }
    }

    pub fn with_stream_id(mut self, stream_id: u16) -> Self {
        self.stream_id = stream_id;
        self
    }

    pub fn with_ipv6_only(mut self, ipv6_only: bool) -> Self {
        self.ipv6_only = ipv6_only;
        self
    }

    pub fn with_compression(mut self, enabled: bool, level: i32) -> Self {
        self.compression_enabled = enabled;
        self.compression_level = level.max(1).min(22);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SctpAssociationState {
    Closed,
    CookieWait,
    CookieEchoed,
    Established,
    ShutdownPending,
    ShutdownSent,
    ShutdownReceived,
    ShutdownAckSent,
}

impl std::fmt::Display for SctpAssociationState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SctpAssociationState::Closed => write!(f, "CLOSED"),
            SctpAssociationState::CookieWait => write!(f, "COOKIE_WAIT"),
            SctpAssociationState::CookieEchoed => write!(f, "COOKIE_ECHOED"),
            SctpAssociationState::Established => write!(f, "ESTABLISHED"),
            SctpAssociationState::ShutdownPending => write!(f, "SHUTDOWN_PENDING"),
            SctpAssociationState::ShutdownSent => write!(f, "SHUTDOWN_SENT"),
            SctpAssociationState::ShutdownReceived => write!(f, "SHUTDOWN_RECEIVED"),
            SctpAssociationState::ShutdownAckSent => write!(f, "SHUTDOWN_ACK_SENT"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SctpStream {
    pub stream_id: u16,
    pub seq_num: u32,
    pub buffer_size: usize,
}

impl SctpStream {
    pub fn new(stream_id: u16) -> Self {
        Self {
            stream_id,
            seq_num: 0,
            buffer_size: 65536,
        }
    }

    pub fn next_seq(&mut self) -> u32 {
        let seq = self.seq_num;
        self.seq_num = self.seq_num.wrapping_add(1);
        seq
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SctpAssociation {
    pub association_id: Uuid,
    pub state: SctpAssociationState,
    pub local_addr: SocketAddr,
    pub remote_addr: SocketAddr,
    pub streams: HashMap<u16, SctpStream>,
    pub heartbeat_interval: std::time::Duration,
    pub last_heartbeat: DateTime<Utc>,
    pub init_tag: u32,
    pub remote_tag: u32,
}

impl SctpAssociation {
    pub fn new(local_addr: SocketAddr, remote_addr: SocketAddr) -> Self {
        let association_id = Uuid::new_v4();
        let mut streams = HashMap::new();
        streams.insert(0, SctpStream::new(0));
        let mut rng = rand::thread_rng();
        Self {
            association_id,
            state: SctpAssociationState::Closed,
            local_addr,
            remote_addr,
            streams,
            heartbeat_interval: std::time::Duration::from_secs(3),
            last_heartbeat: Utc::now(),
            init_tag: rng.gen(),
            remote_tag: 0,
        }
    }

    pub fn is_established(&self) -> bool {
        self.state == SctpAssociationState::Established
    }

    pub fn get_or_create_stream(&mut self, stream_id: u16) -> &mut SctpStream {
        self.streams
            .entry(stream_id)
            .or_insert_with(|| SctpStream::new(stream_id))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TunnelState {
    Initializing,
    GatheringCandidates,
    ExchangingCandidates,
    Connecting,
    Connected,
    Reconnecting,
    Disconnecting,
    Disconnected,
    Failed,
}

impl std::fmt::Display for TunnelState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TunnelState::Initializing => write!(f, "INITIALIZING"),
            TunnelState::GatheringCandidates => write!(f, "GATHERING_CANDIDATES"),
            TunnelState::ExchangingCandidates => write!(f, "EXCHANGING_CANDIDATES"),
            TunnelState::Connecting => write!(f, "CONNECTING"),
            TunnelState::Connected => write!(f, "CONNECTED"),
            TunnelState::Reconnecting => write!(f, "RECONNECTING"),
            TunnelState::Disconnecting => write!(f, "DISCONNECTING"),
            TunnelState::Disconnected => write!(f, "DISCONNECTED"),
            TunnelState::Failed => write!(f, "FAILED"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelStatus {
    pub tunnel_id: Uuid,
    pub state: TunnelState,
    pub nat_type: NatType,
    pub local_candidates: Vec<IceCandidate>,
    pub remote_candidates: Vec<IceCandidate>,
    pub association_state: SctpAssociationState,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub bytes_sent_uncompressed: u64,
    pub bytes_received_uncompressed: u64,
    pub compression_enabled: bool,
    pub compression_level: i32,
    pub consecutive_heartbeat_failures: u32,
    pub created_at: DateTime<Utc>,
    pub connected_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Error)]
pub enum TunnelError {
    #[error("tunnel not found: {0}")]
    NotFound(Uuid),
    #[error("association error: {0}")]
    AssociationError(String),
    #[error("ICE negotiation failed: {0}")]
    IceNegotiationFailed(String),
    #[error("NAT detection failed: {0}")]
    NatDetectionFailed(String),
    #[error("connection error: {0}")]
    ConnectionError(String),
    #[error("timeout: {0}")]
    Timeout(String),
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

struct TunnelInner {
    id: Uuid,
    config: SctpTunnelConfig,
    state: TunnelState,
    nat_type: NatType,
    association: SctpAssociation,
    local_candidates: Vec<IceCandidate>,
    remote_candidates: Vec<IceCandidate>,
    bytes_sent: u64,
    bytes_received: u64,
    bytes_sent_uncompressed: u64,
    bytes_received_uncompressed: u64,
    consecutive_heartbeat_failures: u32,
    created_at: DateTime<Utc>,
    connected_at: Option<DateTime<Utc>>,
    udp_socket: Option<Arc<UdpSocket>>,
}

pub struct Tunnel {
    inner: Arc<Mutex<TunnelInner>>,
}

impl Tunnel {
    fn new(config: SctpTunnelConfig) -> Self {
        let id = Uuid::new_v4();
        let association = SctpAssociation::new(config.local_addr, config.remote_addr);
        let inner = TunnelInner {
            id,
            config,
            state: TunnelState::Initializing,
            nat_type: NatType::Unknown,
            association,
            local_candidates: Vec::new(),
            remote_candidates: Vec::new(),
            bytes_sent: 0,
            bytes_received: 0,
            bytes_sent_uncompressed: 0,
            bytes_received_uncompressed: 0,
            consecutive_heartbeat_failures: 0,
            created_at: Utc::now(),
            connected_at: None,
            udp_socket: None,
        };
        Self {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    pub async fn id(&self) -> Uuid {
        self.inner.lock().await.id
    }

    pub async fn state(&self) -> TunnelState {
        self.inner.lock().await.state
    }

    pub async fn status(&self) -> TunnelStatus {
        let inner = self.inner.lock().await;
        TunnelStatus {
            tunnel_id: inner.id,
            state: inner.state,
            nat_type: inner.nat_type,
            local_candidates: inner.local_candidates.clone(),
            remote_candidates: inner.remote_candidates.clone(),
            association_state: inner.association.state,
            bytes_sent: inner.bytes_sent,
            bytes_received: inner.bytes_received,
            bytes_sent_uncompressed: inner.bytes_sent_uncompressed,
            bytes_received_uncompressed: inner.bytes_received_uncompressed,
            compression_enabled: inner.config.compression_enabled,
            compression_level: inner.config.compression_level,
            consecutive_heartbeat_failures: inner.consecutive_heartbeat_failures,
            created_at: inner.created_at,
            connected_at: inner.connected_at,
        }
    }

    pub async fn set_state(&self, state: TunnelState) {
        let mut inner = self.inner.lock().await;
        if state == TunnelState::Connected && inner.connected_at.is_none() {
            inner.connected_at = Some(Utc::now());
        }
        info!("Tunnel {} state: {} -> {}", inner.id, inner.state, state);
        inner.state = state;
    }

    pub async fn add_remote_candidates(&self, candidates: Vec<IceCandidate>) {
        let mut inner = self.inner.lock().await;
        inner.remote_candidates.extend(candidates);
    }

    pub async fn send(&self, data: &[u8], stream_id: u16) -> Result<(), TunnelError> {
        let mut inner = self.inner.lock().await;
        if inner.state != TunnelState::Connected {
            return Err(TunnelError::ConnectionError(
                "tunnel not connected".to_string(),
            ));
        }
        if let Some(ref socket) = inner.udp_socket {
            let addr = inner.config.remote_addr;
            let payload = if inner.config.compression_enabled && data.len() > 64 {
                match zstd::encode_all(data, inner.config.compression_level) {
                    Ok(compressed) if compressed.len() < data.len() => {
                        let mut frame = Vec::with_capacity(compressed.len() + 5);
                        frame.push(0x01);
                        frame.extend_from_slice(&(data.len() as u32).to_be_bytes());
                        frame.extend_from_slice(&compressed);
                        inner.bytes_sent_uncompressed += data.len() as u64;
                        frame
                    }
                    _ => {
                        let mut frame = Vec::with_capacity(data.len() + 1);
                        frame.push(0x00);
                        frame.extend_from_slice(data);
                        inner.bytes_sent_uncompressed += data.len() as u64;
                        frame
                    }
                }
            } else {
                let mut frame = Vec::with_capacity(data.len() + 1);
                frame.push(0x00);
                frame.extend_from_slice(data);
                inner.bytes_sent_uncompressed += data.len() as u64;
                frame
            };

            socket.send_to(&payload, addr).await?;
            inner.bytes_sent += payload.len() as u64;
            if let Some(stream) = inner.association.streams.get_mut(&stream_id) {
                stream.next_seq();
            }
            Ok(())
        } else {
            Err(TunnelError::ConnectionError("no socket available".to_string()))
        }
    }

    pub async fn recv(&self, buf: &mut [u8]) -> Result<usize, TunnelError> {
        let mut inner = self.inner.lock().await;
        if inner.state != TunnelState::Connected {
            return Err(TunnelError::ConnectionError(
                "tunnel not connected".to_string(),
            ));
        }
        if let Some(ref socket) = inner.udp_socket {
            let mut tmp_buf = vec![0u8; 65536];
            let (n, _) = socket.recv_from(&mut tmp_buf).await?;
            inner.bytes_received += n as u64;

            if n == 0 {
                return Ok(0);
            }

            let flag = tmp_buf[0];
            if flag == 0x01 && n >= 5 {
                let orig_len = u32::from_be_bytes([tmp_buf[1], tmp_buf[2], tmp_buf[3], tmp_buf[4]]) as usize;
                let compressed = &tmp_buf[5..n];
                match zstd::decode_all(compressed) {
                    Ok(decompressed) => {
                        let copy_len = decompressed.len().min(buf.len());
                        buf[..copy_len].copy_from_slice(&decompressed[..copy_len]);
                        inner.bytes_received_uncompressed += decompressed.len() as u64;
                        Ok(copy_len)
                    }
                    Err(e) => {
                        warn!("Decompression failed: {}", e);
                        Err(TunnelError::AssociationError(format!("decompression failed: {}", e)))
                    }
                }
            } else {
                let data_len = n - 1;
                let copy_len = data_len.min(buf.len());
                buf[..copy_len].copy_from_slice(&tmp_buf[1..=copy_len]);
                inner.bytes_received_uncompressed += data_len as u64;
                Ok(copy_len)
            }
        } else {
            Err(TunnelError::ConnectionError("no socket available".to_string()))
        }
    }
}

#[async_trait]
trait NatDetector: Send + Sync {
    async fn detect(&self, stun_servers: &[SocketAddr]) -> Result<NatType, TunnelError>;
    async fn get_external_addr(&self, stun_server: SocketAddr) -> Result<SocketAddr, TunnelError>;
}

struct StunNatDetector {
    socket: Arc<UdpSocket>,
}

impl StunNatDetector {
    async fn new(bind_addr: &str) -> Result<Self, TunnelError> {
        let socket = UdpSocket::bind(bind_addr).await?;
        Ok(Self {
            socket: Arc::new(socket),
        })
    }
}

#[async_trait]
impl NatDetector for StunNatDetector {
    async fn detect(&self, stun_servers: &[SocketAddr]) -> Result<NatType, TunnelError> {
        if stun_servers.is_empty() {
            return Err(TunnelError::NatDetectionFailed(
                "no STUN servers provided".to_string(),
            ));
        }
        let primary = stun_servers[0];
        let local_addr = self.socket.local_addr()?;
        let external_addr = self.get_external_addr(primary).await?;

        if local_addr.ip() == external_addr.ip() {
            info!("No NAT detected (local == external)");
            return Ok(NatType::FullCone);
        }

        if stun_servers.len() < 2 {
            warn!("Only one STUN server provided; NAT type detection may be incomplete");
            return Ok(NatType::Unknown);
        }

        let secondary = stun_servers[1];
        let external_addr_2 = self.get_external_addr(secondary).await?;

        if external_addr.ip() != external_addr_2.ip() || external_addr.port() != external_addr_2.port() {
            info!("Symmetric NAT detected (different mappings for different destinations)");
            return Ok(NatType::Symmetric);
        }

        let test_result = self.test_restricted_cone(primary).await;
        match test_result {
            Ok(true) => {
                let port_test = self.test_port_restricted(primary).await;
                match port_test {
                    Ok(true) => {
                        info!("Port Restricted Cone NAT detected");
                        Ok(NatType::PortRestrictedCone)
                    }
                    _ => {
                        info!("Restricted Cone NAT detected");
                        Ok(NatType::RestrictedCone)
                    }
                }
            }
            _ => {
                info!("Full Cone NAT detected");
                Ok(NatType::FullCone)
            }
        }
    }

    async fn get_external_addr(&self, stun_server: SocketAddr) -> Result<SocketAddr, TunnelError> {
        let binding_request = self.build_stun_binding_request();
        self.socket.send_to(&binding_request, stun_server).await?;

        let mut buf = [0u8; 576];
        let timeout = tokio::time::Duration::from_secs(5);
        let result = tokio::time::timeout(timeout, self.socket.recv_from(&mut buf)).await;

        match result {
            Ok(Ok((n, _from))) => {
                let mapped_addr = self.parse_stun_response(&buf[..n])?;
                Ok(mapped_addr)
            }
            Ok(Err(e)) => Err(TunnelError::NatDetectionFailed(format!(
                "recv error: {}",
                e
            ))),
            Err(_) => Err(TunnelError::Timeout(
                "STUN request timed out".to_string(),
            )),
        }
    }
}

impl StunNatDetector {
    fn build_stun_binding_request(&self) -> Vec<u8> {
        let mut msg = vec![0u8; 20];
        msg[0] = 0x00;
        msg[1] = 0x01;
        msg[2] = 0x00;
        msg[3] = 0x00;
        let cookie: [u8; 4] = 0x2112A442u32.to_be_bytes();
        msg[4..8].copy_from_slice(&cookie);
        let mut rng = rand::thread_rng();
        for byte in &mut msg[8..20] {
            *byte = rng.gen();
        }
        msg
    }

    fn parse_stun_response(&self, data: &[u8]) -> Result<SocketAddr, TunnelError> {
        if data.len() < 20 {
            return Err(TunnelError::NatDetectionFailed(
                "STUN response too short".to_string(),
            ));
        }
        let msg_type = u16::from_be_bytes([data[0], data[1]]);
        if msg_type != 0x0101 {
            return Err(TunnelError::NatDetectionFailed(format!(
                "unexpected STUN message type: 0x{:04x}",
                msg_type
            )));
        }
        let msg_len = u16::from_be_bytes([data[2], data[3]]) as usize;
        if data.len() < 20 + msg_len {
            return Err(TunnelError::NatDetectionFailed(
                "STUN response truncated".to_string(),
            ));
        }
        let mut offset = 20;
        while offset + 4 <= 20 + msg_len {
            let attr_type = u16::from_be_bytes([data[offset], data[offset + 1]]);
            let attr_len = u16::from_be_bytes([data[offset + 2], data[offset + 3]]) as usize;
            if attr_type == 0x0020 || attr_type == 0x0001 {
                return self.parse_xor_mapped_address(&data[offset + 4..offset + 4 + attr_len], &data[4..8]);
            }
            let padded = (attr_len + 3) & !3;
            offset += 4 + padded;
        }
        Err(TunnelError::NatDetectionFailed(
            "no MAPPED-ADDRESS or XOR-MAPPED-ADDRESS attribute found".to_string(),
        ))
    }

    fn parse_xor_mapped_address(
        &self,
        attr_data: &[u8],
        transaction_id: &[u8],
    ) -> Result<SocketAddr, TunnelError> {
        if attr_data.len() < 4 {
            return Err(TunnelError::NatDetectionFailed(
                "address attribute too short".to_string(),
            ));
        }
        let family = attr_data[1];
        let xor_port = u16::from_be_bytes([attr_data[2], attr_data[3]]);
        let port = xor_port ^ 0x2112;
        match family {
            0x01 => {
                if attr_data.len() < 8 {
                    return Err(TunnelError::NatDetectionFailed(
                        "IPv4 address too short".to_string(),
                    ));
                }
                let xor_ip = u32::from_be_bytes([
                    attr_data[4],
                    attr_data[5],
                    attr_data[6],
                    attr_data[7],
                ]);
                let ip = xor_ip ^ 0x2112A442u32;
                let ip_bytes = ip.to_be_bytes();
                Ok(SocketAddr::new(
                    IpAddr::from(ip_bytes),
                    port,
                ))
            }
            0x02 => {
                if attr_data.len() < 20 {
                    return Err(TunnelError::NatDetectionFailed(
                        "IPv6 address too short".to_string(),
                    ));
                }
                let cookie = 0x2112A442u32.to_be_bytes();
                let mut xor_ip = [0u8; 16];
                xor_ip.copy_from_slice(&attr_data[4..20]);
                for i in 0..4 {
                    xor_ip[i] ^= cookie[i];
                }
                for i in 0..12 {
                    xor_ip[4 + i] ^= transaction_id[i];
                }
                Ok(SocketAddr::new(
                    IpAddr::from(xor_ip),
                    port,
                ))
            }
            _ => Err(TunnelError::NatDetectionFailed(format!(
                "unknown address family: {}",
                family
            ))),
        }
    }

    async fn test_restricted_cone(&self, _stun_server: SocketAddr) -> Result<bool, TunnelError> {
        Ok(true)
    }

    async fn test_port_restricted(&self, _stun_server: SocketAddr) -> Result<bool, TunnelError> {
        Ok(true)
    }
}

#[async_trait]
trait CandidateGatherer: Send + Sync {
    async fn gather_host_candidates(&self, port: u16, ipv6_only: bool) -> Result<Vec<IceCandidate>, TunnelError>;
    async fn gather_srflx_candidates(
        &self,
        stun_servers: &[SocketAddr],
        local_socket: &UdpSocket,
    ) -> Result<Vec<IceCandidate>, TunnelError>;
}

struct DefaultCandidateGatherer;

impl DefaultCandidateGatherer {
    fn new() -> Self {
        Self
    }
}

#[async_trait]
impl CandidateGatherer for DefaultCandidateGatherer {
    async fn gather_host_candidates(&self, port: u16, ipv6_only: bool) -> Result<Vec<IceCandidate>, TunnelError> {
        let mut candidates = Vec::new();
        let addrs = list_local_addresses()?;
        for ip in addrs {
            if ipv6_only && !ip.is_ipv6() {
                continue;
            }
            candidates.push(IceCandidate::new_host(ip, port));
        }
        debug!("Gathered {} host candidates", candidates.len());
        Ok(candidates)
    }

    async fn gather_srflx_candidates(
        &self,
        stun_servers: &[SocketAddr],
        local_socket: &UdpSocket,
    ) -> Result<Vec<IceCandidate>, TunnelError> {
        let local_addr = local_socket.local_addr()?;
        let base_ip = local_addr.ip();
        let base_port = local_addr.port();

        let mut candidates = Vec::new();
        let mut seen_external: std::collections::HashSet<SocketAddr> = std::collections::HashSet::new();

        for server in stun_servers {
            let binding_request = build_stun_binding_request();
            match local_socket.send_to(&binding_request, *server).await {
                Ok(_) => {}
                Err(e) => {
                    warn!("Failed to send STUN binding to {}: {}", server, e);
                    continue;
                }
            }

            let mut buf = [0u8; 576];
            let timeout = tokio::time::Duration::from_secs(3);
            let result = tokio::time::timeout(timeout, local_socket.recv_from(&mut buf)).await;

            match result {
                Ok(Ok((n, _from))) => {
                    match parse_stun_xor_mapped_address(&buf[..n]) {
                        Ok(ext_addr) => {
                            if seen_external.insert(ext_addr) {
                                info!(
                                    "Discovered srflx candidate: {} (base={}:{})",
                                    ext_addr, base_ip, base_port
                                );
                                candidates.push(IceCandidate::new_srflx(
                                    ext_addr.ip(),
                                    ext_addr.port(),
                                    base_ip,
                                    base_port,
                                ));
                            } else {
                                debug!("Duplicate srflx address {}, skipping", ext_addr);
                            }
                        }
                        Err(e) => {
                            warn!("Failed to parse STUN response from {}: {}", server, e);
                        }
                    }
                }
                Ok(Err(e)) => {
                    warn!("recv error from STUN server {}: {}", server, e);
                }
                Err(_) => {
                    debug!("STUN binding to {} timed out", server);
                }
            }
        }

        if candidates.is_empty() {
            warn!("No srflx candidates gathered from {} STUN servers", stun_servers.len());
        }

        debug!("Gathered {} srflx candidates (deduplicated)", candidates.len());
        Ok(candidates)
    }
}

fn build_stun_binding_request() -> Vec<u8> {
    let mut msg = vec![0u8; 20];
    msg[0] = 0x00;
    msg[1] = 0x01;
    msg[2] = 0x00;
    msg[3] = 0x00;
    let cookie: [u8; 4] = 0x2112A442u32.to_be_bytes();
    msg[4..8].copy_from_slice(&cookie);
    let mut rng = rand::thread_rng();
    for byte in &mut msg[8..20] {
        *byte = rng.gen();
    }
    msg
}

fn parse_stun_xor_mapped_address(data: &[u8]) -> Result<SocketAddr, TunnelError> {
    if data.len() < 20 {
        return Err(TunnelError::NatDetectionFailed(
            "STUN response too short".to_string(),
        ));
    }
    let msg_type = u16::from_be_bytes([data[0], data[1]]);
    if msg_type != 0x0101 {
        return Err(TunnelError::NatDetectionFailed(format!(
            "unexpected STUN message type: 0x{:04x}",
            msg_type
        )));
    }
    let msg_len = u16::from_be_bytes([data[2], data[3]]) as usize;
    if data.len() < 20 + msg_len {
        return Err(TunnelError::NatDetectionFailed(
            "STUN response truncated".to_string(),
        ));
    }
    let mut offset = 20;
    while offset + 4 <= 20 + msg_len {
        let attr_type = u16::from_be_bytes([data[offset], data[offset + 1]]);
        let attr_len = u16::from_be_bytes([data[offset + 2], data[offset + 3]]) as usize;
        if attr_type == 0x0020 || attr_type == 0x0001 {
            let attr_data = &data[offset + 4..offset + 4 + attr_len];
            if attr_data.len() < 4 {
                return Err(TunnelError::NatDetectionFailed(
                    "address attribute too short".to_string(),
                ));
            }
            let family = attr_data[1];
            let xor_port = u16::from_be_bytes([attr_data[2], attr_data[3]]);
            let port = xor_port ^ 0x2112;
            match family {
                0x01 => {
                    if attr_data.len() < 8 {
                        return Err(TunnelError::NatDetectionFailed(
                            "IPv4 address too short".to_string(),
                        ));
                    }
                    let xor_ip = u32::from_be_bytes([
                        attr_data[4], attr_data[5], attr_data[6], attr_data[7],
                    ]);
                    let ip = xor_ip ^ 0x2112A442u32;
                    return Ok(SocketAddr::new(IpAddr::from(ip.to_be_bytes()), port));
                }
                0x02 => {
                    if attr_data.len() < 20 {
                        return Err(TunnelError::NatDetectionFailed(
                            "IPv6 address too short".to_string(),
                        ));
                    }
                    let cookie = 0x2112A442u32.to_be_bytes();
                    let transaction_id = &data[8..20];
                    let mut xor_ip = [0u8; 16];
                    xor_ip.copy_from_slice(&attr_data[4..20]);
                    for i in 0..4 {
                        xor_ip[i] ^= cookie[i];
                    }
                    for i in 0..12 {
                        xor_ip[4 + i] ^= transaction_id[i];
                    }
                    return Ok(SocketAddr::new(IpAddr::from(xor_ip), port));
                }
                _ => {
                    return Err(TunnelError::NatDetectionFailed(format!(
                        "unknown address family: {}",
                        family
                    )));
                }
            }
        }
        let padded = (attr_len + 3) & !3;
        offset += 4 + padded;
    }
    Err(TunnelError::NatDetectionFailed(
        "no MAPPED-ADDRESS or XOR-MAPPED-ADDRESS attribute found".to_string(),
    ))
}

fn list_local_addresses() -> Result<Vec<IpAddr>, TunnelError> {
    let mut addrs = Vec::new();
    #[cfg(windows)]
    {
        let output = std::process::Command::new("ipconfig")
            .output()
            .map_err(TunnelError::Io)?;
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let line = line.trim();
            if line.starts_with("IPv4 Address") || line.starts_with("IPv6 Address") {
                if let Some(addr_str) = line.split(':').nth(1) {
                    let addr_str = addr_str.trim();
                    if let Ok(ip) = addr_str.parse::<IpAddr>() {
                        addrs.push(ip);
                    }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        let output = std::process::Command::new("hostname")
            .arg("-I")
            .output()
            .map_err(TunnelError::Io)?;
        let text = String::from_utf8_lossy(&output.stdout);
        for part in text.split_whitespace() {
            if let Ok(ip) = part.parse::<IpAddr>() {
                addrs.push(ip);
            }
        }
    }
    if addrs.is_empty() {
        addrs.push("127.0.0.1".parse().unwrap());
        addrs.push("::1".parse().unwrap());
    }
    Ok(addrs)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelCreateRequest {
    pub remote_addr: SocketAddr,
    pub stream_id: Option<u16>,
    pub ipv6_only: bool,
    pub stun_servers: Vec<SocketAddr>,
    pub compression_enabled: Option<bool>,
    pub compression_level: Option<i32>,
}

pub struct TunnelManager {
    tunnels: Arc<RwLock<HashMap<Uuid, Arc<Tunnel>>>>,
    stun_servers: Vec<SocketAddr>,
    nat_type: Arc<RwLock<NatType>>,
    candidate_gatherer: Arc<dyn CandidateGatherer>,
    health_check_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    health_check_running: Arc<std::sync::atomic::AtomicBool>,
    health_check_interval: std::time::Duration,
    max_heartbeat_failures: u32,
}

impl Clone for TunnelManager {
    fn clone(&self) -> Self {
        Self {
            tunnels: self.tunnels.clone(),
            stun_servers: self.stun_servers.clone(),
            nat_type: self.nat_type.clone(),
            candidate_gatherer: self.candidate_gatherer.clone(),
            health_check_task: self.health_check_task.clone(),
            health_check_running: self.health_check_running.clone(),
            health_check_interval: self.health_check_interval,
            max_heartbeat_failures: self.max_heartbeat_failures,
        }
    }
}

impl TunnelManager {
    pub fn new(stun_servers: Vec<SocketAddr>) -> Self {
        Self {
            tunnels: Arc::new(RwLock::new(HashMap::new())),
            stun_servers,
            nat_type: Arc::new(RwLock::new(NatType::Unknown)),
            candidate_gatherer: Arc::new(DefaultCandidateGatherer::new()),
            health_check_task: Arc::new(Mutex::new(None)),
            health_check_running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            health_check_interval: std::time::Duration::from_secs(3),
            max_heartbeat_failures: 3,
        }
    }

    pub fn with_health_check_config(
        mut self,
        interval: std::time::Duration,
        max_failures: u32,
    ) -> Self {
        self.health_check_interval = interval;
        self.max_heartbeat_failures = max_failures;
        self
    }

    pub async fn start_health_check(self: Arc<Self>) {
        if self.health_check_running.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }

        self.health_check_running.store(true, std::sync::atomic::Ordering::SeqCst);
        let manager = Arc::clone(&self);
        let interval = self.health_check_interval;
        let max_failures = self.max_heartbeat_failures;

        let handle = tokio::spawn(async move {
            info!("Health check task started (interval={:?}, max_failures={})", interval, max_failures);
            while manager.health_check_running.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::time::sleep(interval).await;
                manager.perform_health_check_cycle(max_failures).await;
            }
            info!("Health check task stopped");
        });

        *self.health_check_task.lock().await = Some(handle);
    }

    pub async fn stop_health_check(&self) {
        self.health_check_running.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(handle) = self.health_check_task.lock().await.take() {
            handle.abort();
        }
    }

    async fn perform_health_check_cycle(&self, max_failures: u32) {
        let tunnel_ids: Vec<Uuid> = self.list_tunnels().await;

        for tunnel_id in tunnel_ids {
            let manager = Arc::new(self.clone());
            tokio::spawn(async move {
                let status = match manager.get_tunnel_status(tunnel_id).await {
                    Ok(s) => s,
                    Err(_) => return,
                };

                if status.state != TunnelState::Connected {
                    return;
                }

                match manager.check_heartbeat(tunnel_id).await {
                    Ok(true) => {
                        debug!("Tunnel {} heartbeat OK", tunnel_id);
                    }
                    Ok(false) => {
                        warn!("Tunnel {} heartbeat failed", tunnel_id);
                        if let Ok(true) = manager.needs_rebuild(tunnel_id).await {
                            warn!(
                                "Tunnel {} heartbeat failed {} times, initiating rebuild",
                                tunnel_id, max_failures
                            );
                            match manager.rebuild_tunnel(tunnel_id).await {
                                Ok(new_id) => {
                                    info!("Tunnel {} rebuilt successfully as {}", tunnel_id, new_id);
                                }
                                Err(e) => {
                                    error!("Failed to rebuild tunnel {}: {}", tunnel_id, e);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Heartbeat check error for tunnel {}: {}", tunnel_id, e);
                    }
                }
            });
        }
    }

    pub async fn create_tunnel(&self, request: TunnelCreateRequest) -> Result<Uuid, TunnelError> {
        let bind_addr = if request.ipv6_only {
            SocketAddr::new(IpAddr::from([0u16; 8]), 0)
        } else {
            SocketAddr::new(IpAddr::from([0u8; 4]), 0)
        };

        let socket = UdpSocket::bind(bind_addr).await?;
        let local_addr = socket.local_addr()?;

        let stream_id = request.stream_id.unwrap_or(0);
        let mut config = SctpTunnelConfig::new(local_addr, request.remote_addr)
            .with_stream_id(stream_id)
            .with_ipv6_only(request.ipv6_only);

        if let Some(enabled) = request.compression_enabled {
            config = config.with_compression(enabled, request.compression_level.unwrap_or(3));
        }

        let tunnel = Tunnel::new(config);
        tunnel.set_state(TunnelState::GatheringCandidates).await;

        {
            let mut inner = tunnel.inner.lock().await;
            inner.udp_socket = Some(Arc::new(socket));

            let host_candidates = self
                .candidate_gatherer
                .gather_host_candidates(local_addr.port(), request.ipv6_only)
                .await?;
            inner.local_candidates.extend(host_candidates);

            let srflx_candidates = {
                let socket_ref = inner.udp_socket.as_ref().unwrap();
                self.candidate_gatherer
                    .gather_srflx_candidates(&request.stun_servers, socket_ref)
                    .await?
            };
            inner.local_candidates.extend(srflx_candidates);

            inner.association.get_or_create_stream(stream_id);
        }

        tunnel.set_state(TunnelState::ExchangingCandidates).await;

        let id = tunnel.id().await;
        self.tunnels.write().await.insert(id, Arc::new(tunnel));

        info!("Created tunnel {} -> {}", id, request.remote_addr);
        Ok(id)
    }

    pub async fn close_tunnel(&self, tunnel_id: Uuid) -> Result<(), TunnelError> {
        let mut tunnels = self.tunnels.write().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);

        tunnel.set_state(TunnelState::Disconnecting).await;

        {
            let mut inner = tunnel.inner.lock().await;
            inner.association.state = SctpAssociationState::ShutdownPending;
        }

        self.initiate_sctp_shutdown(&tunnel).await?;
        tunnel.set_state(TunnelState::Disconnected).await;

        self.tunnels.write().await.remove(&tunnel_id);
        info!("Closed tunnel {}", tunnel_id);
        Ok(())
    }

    async fn initiate_sctp_shutdown(&self, tunnel: &Tunnel) -> Result<(), TunnelError> {
        let inner = tunnel.inner.lock().await;
        let socket = inner
            .udp_socket
            .clone()
            .ok_or_else(|| TunnelError::AssociationError("no socket".to_string()))?;
        let remote = inner.config.remote_addr;

        let shutdown_chunk = self.build_sctp_shutdown_chunk(&inner.association);
        drop(inner);

        socket.send_to(&shutdown_chunk, remote).await?;
        Ok(())
    }

    fn build_sctp_shutdown_chunk(&self, association: &SctpAssociation) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.push(0x07);
        chunk.push(0x00);
        let vtag = association.remote_tag.to_be_bytes();
        chunk.extend_from_slice(&vtag);
        let payload = association.init_tag.to_be_bytes();
        let len = (4 + payload.len()) as u16;
        chunk.extend_from_slice(&len.to_be_bytes());
        chunk.extend_from_slice(&payload);
        chunk
    }

    pub async fn detect_nat_type(&self) -> Result<NatType, TunnelError> {
        self.detect_nat_type_with_servers(None).await
    }

    pub async fn detect_nat_type_with_servers(&self, stun_server: Option<&str>) -> Result<NatType, TunnelError> {
        let bind_addr = "[::]:0".to_string();
        let detector = StunNatDetector::new(&bind_addr).await?;

        let servers = if let Some(server) = stun_server {
            if let Ok(addr) = server.parse::<SocketAddr>() {
                vec![addr]
            } else {
                self.stun_servers.clone()
            }
        } else {
            self.stun_servers.clone()
        };

        let nat_type = detector.detect(&servers).await?;
        *self.nat_type.write().await = nat_type;
        info!("Detected NAT type: {}", nat_type);
        Ok(nat_type)
    }

    pub async fn exchange_candidates(
        &self,
        tunnel_id: Uuid,
        remote_candidates: Vec<IceCandidate>,
    ) -> Result<Vec<IceCandidate>, TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);

        tunnel.add_remote_candidates(remote_candidates).await;

        let local_candidates = {
            let inner = tunnel.inner.lock().await;
            inner.local_candidates.clone()
        };

        let best_pair = self.select_best_candidate_pair(&tunnel).await;
        match best_pair {
            Some((local, remote)) => {
                info!(
                    "Selected candidate pair: {}:{} -> {}:{}",
                    local.ip, local.port, remote.ip, remote.port
                );
                tunnel.set_state(TunnelState::Connecting).await;
                self.establish_sctp_association(&tunnel, &local, &remote)
                    .await?;
                tunnel.set_state(TunnelState::Connected).await;
            }
            None => {
                tunnel.set_state(TunnelState::Failed).await;
                return Err(TunnelError::IceNegotiationFailed(
                    "no valid candidate pair found".to_string(),
                ));
            }
        }

        Ok(local_candidates)
    }

    async fn select_best_candidate_pair(
        &self,
        tunnel: &Tunnel,
    ) -> Option<(IceCandidate, IceCandidate)> {
        let inner = tunnel.inner.lock().await;
        let local = inner.local_candidates.iter().max_by_key(|c| c.priority)?;
        let remote = inner
            .remote_candidates
            .iter()
            .max_by_key(|c| c.priority)?;
        Some((local.clone(), remote.clone()))
    }

    async fn establish_sctp_association(
        &self,
        tunnel: &Tunnel,
        local: &IceCandidate,
        remote: &IceCandidate,
    ) -> Result<(), TunnelError> {
        let init_chunk;
        let socket;
        let remote_addr;
        {
            let mut inner = tunnel.inner.lock().await;
            inner.association.state = SctpAssociationState::CookieWait;
            inner.association.local_addr = SocketAddr::new(local.ip, local.port);
            inner.association.remote_addr = SocketAddr::new(remote.ip, remote.port);
            init_chunk = self.build_sctp_init_chunk(&inner.association);
            socket = inner
                .udp_socket
                .clone()
                .ok_or_else(|| TunnelError::AssociationError("no socket".to_string()))?;
            remote_addr = inner.association.remote_addr;
        }

        let max_retries = 5;
        let initial_timeout_ms: u64 = 200;
        let max_timeout_ms: u64 = 1600;
        let mut timeout_ms = initial_timeout_ms;

        for attempt in 0..=max_retries {
            if attempt > 0 {
                info!(
                    "SCTP INIT retransmission attempt {}/{} to {} (timeout={}ms)",
                    attempt, max_retries, remote_addr, timeout_ms
                );
            }

            socket.send_to(&init_chunk, remote_addr).await?;
            debug!("Sent SCTP INIT to {}", remote_addr);

            let timeout = tokio::time::Duration::from_millis(timeout_ms);
            let mut ack_buf = [0u8; 1500];

            match tokio::time::timeout(timeout, socket.recv_from(&mut ack_buf)).await {
                Ok(Ok((n, from))) => {
                    if from == remote_addr && n >= 4 {
                        let chunk_type = ack_buf[0];
                        if chunk_type == 0x02 {
                            info!("Received INIT-ACK from {}", from);
                            {
                                let mut inner = tunnel.inner.lock().await;
                                inner.association.state = SctpAssociationState::CookieEchoed;

                                if n >= 20 {
                                    let remote_tag_bytes = [ack_buf[4], ack_buf[5], ack_buf[6], ack_buf[7]];
                                    inner.association.remote_tag = u32::from_be_bytes(remote_tag_bytes);
                                }
                            }

                            let cookie_echo_chunk = {
                                let inner = tunnel.inner.lock().await;
                                self.build_sctp_cookie_echo(&inner.association, &ack_buf[..n])
                            };
                            socket.send_to(&cookie_echo_chunk, remote_addr).await?;
                            debug!("Sent COOKIE-ECHO to {}", remote_addr);

                            let cookie_timeout = tokio::time::Duration::from_secs(5);
                            let mut cookie_ack_buf = [0u8; 1500];
                            match tokio::time::timeout(cookie_timeout, socket.recv_from(&mut cookie_ack_buf)).await {
                                Ok(Ok((cn, _))) => {
                                    if cn >= 1 && cookie_ack_buf[0] == 0x0B {
                                        info!("Received COOKIE-ACK, association established");
                                    }
                                }
                                _ => {
                                    debug!("No COOKIE-ACK received, proceeding optimistically");
                                }
                            }

                            {
                                let mut inner = tunnel.inner.lock().await;
                                inner.association.state = SctpAssociationState::Established;
                                inner.association.last_heartbeat = Utc::now();
                            }
                            return Ok(());
                        } else if chunk_type == 0x0B {
                            info!("Received COOKIE-ACK directly, association established");
                            let mut inner = tunnel.inner.lock().await;
                            inner.association.state = SctpAssociationState::Established;
                            inner.association.last_heartbeat = Utc::now();
                            return Ok(());
                        } else if chunk_type == 0x09 {
                            warn!("Received ABORT from {}", from);
                            let mut inner = tunnel.inner.lock().await;
                            inner.association.state = SctpAssociationState::Closed;
                            return Err(TunnelError::AssociationError(
                                "remote aborted association".to_string(),
                            ));
                        }
                    }
                }
                Ok(Err(e)) => {
                    warn!("recv error during SCTP handshake: {}", e);
                }
                Err(_) => {
                    debug!("SCTP INIT attempt {} timed out after {}ms", attempt, timeout_ms);
                }
            }

            timeout_ms = (timeout_ms * 2).min(max_timeout_ms);

            if attempt == max_retries {
                let mut inner = tunnel.inner.lock().await;
                inner.association.state = SctpAssociationState::Closed;
                return Err(TunnelError::Timeout(format!(
                    "SCTP INIT-ACK not received after {} retries",
                    max_retries
                )));
            }
        }

        unreachable!()
    }

    fn build_sctp_cookie_echo(&self, association: &SctpAssociation, init_ack: &[u8]) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.push(0x0A);
        chunk.push(0x00);
        let vtag = association.remote_tag.to_be_bytes();
        chunk.extend_from_slice(&vtag);

        let cookie_start = 16.min(init_ack.len());
        let cookie_data = if init_ack.len() > cookie_start {
            &init_ack[cookie_start..]
        } else {
            &[]
        };

        let len = (4 + cookie_data.len()) as u16;
        chunk.extend_from_slice(&len.to_be_bytes());
        chunk.extend_from_slice(cookie_data);
        chunk
    }

    fn build_sctp_init_chunk(&self, association: &SctpAssociation) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.push(0x01);
        chunk.push(0x00);
        let vtag = association.init_tag.to_be_bytes();
        chunk.extend_from_slice(&vtag);
        let mut payload = Vec::new();
        payload.extend_from_slice(&association.init_tag.to_be_bytes());
        payload.extend_from_slice(&60000u32.to_be_bytes());
        payload.extend_from_slice(&65535u16.to_be_bytes());
        payload.extend_from_slice(&0u16.to_be_bytes());
        payload.extend_from_slice(&(association.streams.len() as u16).to_be_bytes());
        let len = (4 + payload.len()) as u16;
        chunk.extend_from_slice(&len.to_be_bytes());
        chunk.extend_from_slice(&payload);
        chunk
    }

    pub async fn send_heartbeat(&self, tunnel_id: Uuid) -> Result<(), TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);

        let inner = tunnel.inner.lock().await;
        if !inner.association.is_established() {
            return Err(TunnelError::AssociationError(
                "association not established".to_string(),
            ));
        }
        let socket = inner
            .udp_socket
            .clone()
            .ok_or_else(|| TunnelError::AssociationError("no socket".to_string()))?;
        let remote = inner.association.remote_addr;
        let hb_chunk = self.build_sctp_heartbeat_chunk(&inner.association);
        drop(inner);

        socket.send_to(&hb_chunk, remote).await?;

        let mut inner = tunnel.inner.lock().await;
        inner.association.last_heartbeat = Utc::now();
        inner.consecutive_heartbeat_failures = 0;
        debug!("Sent heartbeat for tunnel {}", tunnel_id);
        Ok(())
    }

    pub async fn check_heartbeat(&self, tunnel_id: Uuid) -> Result<bool, TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);

        let inner = tunnel.inner.lock().await;
        if !inner.association.is_established() {
            return Ok(false);
        }
        let socket = inner
            .udp_socket
            .clone()
            .ok_or_else(|| TunnelError::AssociationError("no socket".to_string()))?;
        let remote = inner.association.remote_addr;
        let hb_chunk = self.build_sctp_heartbeat_chunk(&inner.association);
        drop(inner);

        socket.send_to(&hb_chunk, remote).await?;

        let timeout = tokio::time::Duration::from_secs(3);
        let mut buf = [0u8; 1500];
        match tokio::time::timeout(timeout, socket.recv_from(&mut buf)).await {
            Ok(Ok((n, _))) => {
                if n >= 1 && buf[0] == 0x04 {
                    let mut inner = tunnel.inner.lock().await;
                    inner.association.last_heartbeat = Utc::now();
                    inner.consecutive_heartbeat_failures = 0;
                    debug!("Heartbeat ACK received for tunnel {}", tunnel_id);
                    Ok(true)
                } else {
                    let mut inner = tunnel.inner.lock().await;
                    inner.consecutive_heartbeat_failures += 1;
                    warn!(
                        "Heartbeat failed for tunnel {} (attempt {}/3): unexpected response",
                        tunnel_id, inner.consecutive_heartbeat_failures
                    );
                    Ok(false)
                }
            }
            _ => {
                let mut inner = tunnel.inner.lock().await;
                inner.consecutive_heartbeat_failures += 1;
                warn!(
                    "Heartbeat timeout for tunnel {} (attempt {}/3)",
                    tunnel_id, inner.consecutive_heartbeat_failures
                );
                Ok(false)
            }
        }
    }

    pub async fn needs_rebuild(&self, tunnel_id: Uuid) -> Result<bool, TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);

        let inner = tunnel.inner.lock().await;
        Ok(inner.consecutive_heartbeat_failures >= 3)
    }

    pub async fn rebuild_tunnel(&self, tunnel_id: Uuid) -> Result<Uuid, TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);

        let old_inner = tunnel.inner.lock().await;
        let old_config = old_inner.config.clone();
        drop(old_inner);

        tunnel.set_state(TunnelState::Reconnecting).await;
        warn!("Rebuilding tunnel {} to {}", tunnel_id, old_config.remote_addr);

        let bind_addr = if old_config.ipv6_only {
            SocketAddr::new(IpAddr::from([0u16; 8]), 0)
        } else {
            SocketAddr::new(IpAddr::from([0u8; 4]), 0)
        };

        let socket = UdpSocket::bind(bind_addr).await?;
        let local_addr = socket.local_addr()?;

        let stream_id = old_config.stream_id;
        let mut config = SctpTunnelConfig::new(local_addr, old_config.remote_addr)
            .with_stream_id(stream_id)
            .with_ipv6_only(old_config.ipv6_only)
            .with_compression(old_config.compression_enabled, old_config.compression_level);

        let new_tunnel = Tunnel::new(config.clone());
        new_tunnel.set_state(TunnelState::GatheringCandidates).await;

        {
            let mut inner = new_tunnel.inner.lock().await;
            inner.udp_socket = Some(Arc::new(socket));
            inner.association.get_or_create_stream(stream_id);

            let host_candidates = self
                .candidate_gatherer
                .gather_host_candidates(local_addr.port(), old_config.ipv6_only)
                .await?;
            inner.local_candidates.extend(host_candidates);

            let srflx_candidates = {
                let socket_ref = inner.udp_socket.as_ref().unwrap();
                self.candidate_gatherer
                    .gather_srflx_candidates(&self.stun_servers, socket_ref)
                    .await?
            };
            inner.local_candidates.extend(srflx_candidates);
        }

        new_tunnel.set_state(TunnelState::ExchangingCandidates).await;
        new_tunnel.set_state(TunnelState::Connecting).await;

        match self.establish_sctp_association(&new_tunnel).await {
            Ok(_) => {
                new_tunnel.set_state(TunnelState::Connected).await;
                let new_id = new_tunnel.id().await;
                self.tunnels.write().await.insert(new_id, Arc::new(new_tunnel));
                self.tunnels.write().await.remove(&tunnel_id);
                info!("Tunnel {} rebuilt successfully as {}", tunnel_id, new_id);
                Ok(new_id)
            }
            Err(e) => {
                new_tunnel.set_state(TunnelState::Failed).await;
                warn!("Failed to rebuild tunnel {}: {}", tunnel_id, e);
                Err(e)
            }
        }
    }

    fn build_sctp_heartbeat_chunk(&self, association: &SctpAssociation) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.push(0x03);
        chunk.push(0x00);
        let vtag = association.remote_tag.to_be_bytes();
        chunk.extend_from_slice(&vtag);
        let now = Utc::now().timestamp_millis().to_be_bytes();
        let len = (4 + now.len()) as u16;
        chunk.extend_from_slice(&len.to_be_bytes());
        chunk.extend_from_slice(&now);
        chunk
    }

    pub async fn get_tunnel_status(&self, tunnel_id: Uuid) -> Result<TunnelStatus, TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?;
        Ok(tunnel.status().await)
    }

    pub async fn get_tunnel_status_str(&self, tunnel_id: &str) -> Result<TunnelStatus, TunnelError> {
        let id = Uuid::parse_str(tunnel_id)
            .map_err(|e| TunnelError::InvalidConfig(format!("invalid tunnel id: {}", e)))?;
        self.get_tunnel_status(id).await
    }

    pub async fn list_tunnels(&self) -> Vec<Uuid> {
        self.tunnels.read().await.keys().copied().collect()
    }

    pub async fn list_tunnels_str(&self) -> Vec<String> {
        self.list_tunnels().await.iter().map(|id| id.to_string()).collect()
    }

    pub async fn close_tunnel_str(&self, tunnel_id: &str) -> Result<(), TunnelError> {
        let id = Uuid::parse_str(tunnel_id)
            .map_err(|e| TunnelError::InvalidConfig(format!("invalid tunnel id: {}", e)))?;
        self.close_tunnel(id).await
    }

    pub async fn send_heartbeat_str(&self, tunnel_id: &str) -> Result<(), TunnelError> {
        let id = Uuid::parse_str(tunnel_id)
            .map_err(|e| TunnelError::InvalidConfig(format!("invalid tunnel id: {}", e)))?;
        self.send_heartbeat(id).await
    }

    pub async fn get_local_candidates(&self, tunnel_id: &str) -> Result<Vec<IceCandidate>, TunnelError> {
        let id = Uuid::parse_str(tunnel_id)
            .map_err(|e| TunnelError::InvalidConfig(format!("invalid tunnel id: {}", e)))?;
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&id)
            .ok_or(TunnelError::NotFound(id))?;
        let inner = tunnel.inner.lock().await;
        Ok(inner.local_candidates.clone())
    }

    pub async fn exchange_candidates_str(
        &self,
        tunnel_id: &str,
        remote_candidates: Vec<IceCandidate>,
    ) -> Result<Vec<IceCandidate>, TunnelError> {
        let id = Uuid::parse_str(tunnel_id)
            .map_err(|e| TunnelError::InvalidConfig(format!("invalid tunnel id: {}", e)))?;
        self.exchange_candidates(id, remote_candidates).await
    }

    pub async fn send_data(
        &self,
        tunnel_id: Uuid,
        data: &[u8],
        stream_id: u16,
    ) -> Result<(), TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);
        tunnel.send(data, stream_id).await
    }

    pub async fn recv_data(&self, tunnel_id: Uuid, buf: &mut [u8]) -> Result<usize, TunnelError> {
        let tunnels = self.tunnels.read().await;
        let tunnel = tunnels
            .get(&tunnel_id)
            .ok_or(TunnelError::NotFound(tunnel_id))?
            .clone();
        drop(tunnels);
        tunnel.recv(buf).await
    }
}
