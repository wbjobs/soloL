use std::collections::HashMap;
use std::fmt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::str::FromStr;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use sha2::{Digest, Sha256};
use thiserror::Error;
use tokio::sync::RwLock;
use uuid::Uuid;

const KEY_SPACE_BITS: usize = 256;

#[derive(Error, Debug)]
pub enum KadError {
    #[error("node not found")]
    NodeNotFound,
    #[error("bucket full")]
    BucketFull,
    #[error("bootstrap failed: {0}")]
    BootstrapFailed(String),
    #[error("lookup failed: {0}")]
    LookupFailed(String),
    #[error("store failed: {0}")]
    StoreFailed(String),
    #[error("rpc error: {0}")]
    RpcError(String),
    #[error("timeout")]
    Timeout,
    #[error("invalid node id: {0}")]
    InvalidNodeId(String),
}

#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId([u8; 32]);

impl NodeId {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        NodeId(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn random() -> Self {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let mut bytes = [0u8; 32];
        rng.fill(&mut bytes[..]);
        NodeId(bytes)
    }

    pub fn from_sha256(input: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(input);
        let result = hasher.finalize();
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&result);
        NodeId(bytes)
    }

    pub fn xor_distance(&self, other: &NodeId) -> NodeId {
        let mut result = [0u8; 32];
        for i in 0..32 {
            result[i] = self.0[i] ^ other.0[i];
        }
        NodeId(result)
    }

    pub fn bucket_index(&self, other: &NodeId) -> usize {
        let dist = self.xor_distance(other);
        for i in 0..32 {
            let byte = dist.0[i];
            if byte != 0 {
                return i * 8 + (7 - byte.leading_zeros() as usize);
            }
        }
        0
    }

    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }

    pub fn from_hex(s: &str) -> Result<Self, KadError> {
        let bytes = hex::decode(s).map_err(|e| KadError::InvalidNodeId(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(KadError::InvalidNodeId(format!(
                "expected 32 bytes, got {}",
                bytes.len()
            )));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(NodeId(arr))
    }
}

impl fmt::Debug for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({})", hex::encode(self.0))
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}

impl FromStr for NodeId {
    type Err = KadError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bytes = hex::decode(s).map_err(|e| KadError::InvalidNodeId(e.to_string()))?;
        if bytes.len() != 32 {
            return Err(KadError::InvalidNodeId(format!(
                "expected 32 bytes, got {}",
                bytes.len()
            )));
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&bytes);
        Ok(NodeId(arr))
    }
}

impl Serialize for NodeId {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&hex::encode(self.0))
    }
}

impl<'de> Deserialize<'de> for NodeId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        NodeId::from_str(&s).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeContact {
    pub node_id: NodeId,
    pub ip_addr: SocketAddr,
    pub last_seen: DateTime<Utc>,
}

impl NodeContact {
    pub fn new(node_id: NodeId, ip_addr: SocketAddr) -> Self {
        NodeContact {
            node_id,
            ip_addr,
            last_seen: Utc::now(),
        }
    }

    pub fn is_ipv4(&self) -> bool {
        self.ip_addr.is_ipv4()
    }

    pub fn is_ipv6(&self) -> bool {
        self.ip_addr.is_ipv6()
    }

    pub fn is_dual_stack(&self) -> bool {
        match self.ip_addr.ip() {
            IpAddr::V6(v6) => v6.to_ipv4_mapped().is_some(),
            IpAddr::V4(_) => false,
        }
    }

    pub fn touch(&mut self) {
        self.last_seen = Utc::now();
    }
}

impl PartialEq for NodeContact {
    fn eq(&self, other: &Self) -> bool {
        self.node_id == other.node_id
    }
}

impl Eq for NodeContact {}

impl std::hash::Hash for NodeContact {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.node_id.hash(state);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KBucket {
    pub nodes: Vec<NodeContact>,
    pub max_size: usize,
}

impl KBucket {
    pub fn new(max_size: usize) -> Self {
        KBucket {
            nodes: Vec::with_capacity(max_size),
            max_size,
        }
    }

    pub fn is_full(&self) -> bool {
        self.nodes.len() >= self.max_size
    }

    pub fn contains(&self, node_id: &NodeId) -> bool {
        self.nodes.iter().any(|n| &n.node_id == node_id)
    }

    pub fn find(&self, node_id: &NodeId) -> Option<&NodeContact> {
        self.nodes.iter().find(|n| &n.node_id == node_id)
    }

    pub fn find_mut(&mut self, node_id: &NodeId) -> Option<&mut NodeContact> {
        self.nodes.iter_mut().find(|n| &n.node_id == node_id)
    }

    pub fn insert(&mut self, contact: NodeContact) -> Result<(), KadError> {
        if let Some(existing) = self.find_mut(&contact.node_id) {
            existing.ip_addr = contact.ip_addr;
            existing.touch();
            return Ok(());
        }

        if self.is_full() {
            return Err(KadError::BucketFull);
        }

        self.nodes.push(contact);
        Ok(())
    }

    pub fn remove(&mut self, node_id: &NodeId) {
        self.nodes.retain(|n| &n.node_id != node_id);
    }

    pub fn least_recently_seen(&self) -> Option<&NodeContact> {
        self.nodes.first()
    }

    pub fn replace_if_stale(&mut self, node_id: &NodeId, replacement: NodeContact) -> bool {
        if self.contains(node_id) {
            self.remove(node_id);
            let _ = self.insert(replacement);
            return true;
        }
        false
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RoutingTable {
    pub kbuckets: Vec<KBucket>,
    pub local_node_id: NodeId,
}

impl RoutingTable {
    pub fn new(local_node_id: NodeId, k_bucket_size: usize) -> Self {
        let kbuckets = (0..KEY_SPACE_BITS)
            .map(|_| KBucket::new(k_bucket_size))
            .collect();
        RoutingTable {
            kbuckets,
            local_node_id,
        }
    }

    pub fn bucket_index(&self, node_id: &NodeId) -> usize {
        self.local_node_id.bucket_index(node_id)
    }

    pub fn insert(&mut self, contact: NodeContact) -> Result<(), KadError> {
        if contact.node_id == self.local_node_id {
            return Ok(());
        }
        let idx = self.bucket_index(&contact.node_id);
        self.kbuckets[idx].insert(contact)
    }

    pub fn find(&self, node_id: &NodeId) -> Option<&NodeContact> {
        let idx = self.bucket_index(node_id);
        self.kbuckets[idx].find(node_id)
    }

    pub fn find_mut(&mut self, node_id: &NodeId) -> Option<&mut NodeContact> {
        let idx = self.bucket_index(node_id);
        self.kbuckets[idx].find_mut(node_id)
    }

    pub fn remove(&mut self, node_id: &NodeId) {
        let idx = self.bucket_index(node_id);
        self.kbuckets[idx].remove(node_id);
    }

    pub fn closest_nodes(&self, target: &NodeId, count: usize) -> Vec<NodeContact> {
        let mut all: Vec<NodeContact> = Vec::new();
        for bucket in &self.kbuckets {
            all.extend(bucket.nodes.iter().cloned());
        }
        all.sort_by(|a, b| {
            let dist_a = target.xor_distance(&a.node_id);
            let dist_b = target.xor_distance(&b.node_id);
            dist_a.0.cmp(&dist_b.0)
        });
        all.truncate(count);
        all
    }

    pub fn bucket_refresh_candidates(&self, older_than: DateTime<Utc>) -> Vec<NodeContact> {
        self.kbuckets
            .iter()
            .flat_map(|b| {
                b.nodes
                    .iter()
                    .filter(|n| n.last_seen < older_than)
                    .cloned()
            })
            .collect()
    }

    pub fn total_nodes(&self) -> usize {
        self.kbuckets.iter().map(|b| b.nodes.len()).sum()
    }

    pub fn all_nodes(&self) -> Vec<NodeContact> {
        self.kbuckets
            .iter()
            .flat_map(|b| b.nodes.iter().cloned())
            .collect()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct KadValue {
    pub key: NodeId,
    pub value: Vec<u8>,
    pub version: u64,
    pub timestamp: DateTime<Utc>,
}

impl KadValue {
    pub fn new(key: NodeId, value: Vec<u8>) -> Self {
        KadValue {
            key,
            value,
            version: 1,
            timestamp: Utc::now(),
        }
    }

    pub fn with_version(mut self, version: u64) -> Self {
        self.version = version;
        self
    }

    pub fn update(&mut self, new_value: Vec<u8>) {
        self.value = new_value;
        self.version += 1;
        self.timestamp = Utc::now();
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DhtConfig {
    pub k_bucket_size: usize,
    pub replication_factor: usize,
    pub concurrency_alpha: usize,
    pub refresh_interval_secs: u64,
    pub rpc_timeout_secs: u64,
}

impl Default for DhtConfig {
    fn default() -> Self {
        DhtConfig {
            k_bucket_size: 20,
            replication_factor: 3,
            concurrency_alpha: 3,
            refresh_interval_secs: 3600,
            rpc_timeout_secs: 5,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum RpcRequest {
    Ping {
        sender_id: NodeId,
        sender_addr: SocketAddr,
    },
    FindNode {
        sender_id: NodeId,
        sender_addr: SocketAddr,
        target: NodeId,
    },
    FindValue {
        sender_id: NodeId,
        sender_addr: SocketAddr,
        key: NodeId,
    },
    Store {
        sender_id: NodeId,
        sender_addr: SocketAddr,
        key: NodeId,
        value: Vec<u8>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub enum RpcResponse {
    Pong {
        responder_id: NodeId,
    },
    FindNodeResult {
        responder_id: NodeId,
        nodes: Vec<NodeContact>,
    },
    FindValueResult {
        responder_id: NodeId,
        value: Option<KadValue>,
        closest_nodes: Vec<NodeContact>,
    },
    StoreResult {
        responder_id: NodeId,
        stored: bool,
    },
}

#[async_trait]
pub trait KadRpc: Send + Sync {
    async fn send_ping(&self, target: &NodeContact) -> Result<bool, KadError>;
    async fn send_find_node(
        &self,
        target: &NodeContact,
        lookup: &NodeId,
    ) -> Result<Vec<NodeContact>, KadError>;
    async fn send_find_value(
        &self,
        target: &NodeContact,
        key: &NodeId,
    ) -> Result<FindValueResult, KadError>;
    async fn send_store(
        &self,
        target: &NodeContact,
        key: &NodeId,
        value: &[u8],
    ) -> Result<bool, KadError>;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum FindValueResult {
    Found(KadValue),
    ClosestNodes(Vec<NodeContact>),
}

struct LookupState {
    target: NodeId,
    queried: HashMap<NodeId, bool>,
    closest_nodes: Vec<NodeContact>,
    alpha: usize,
    k: usize,
}

impl LookupState {
    fn new(target: NodeId, alpha: usize, k: usize) -> Self {
        LookupState {
            target,
            queried: HashMap::new(),
            closest_nodes: Vec::new(),
            alpha,
            k,
        }
    }

    fn add_nodes(&mut self, nodes: Vec<NodeContact>) {
        for node in nodes {
            if !self.queried.contains_key(&node.node_id) {
                if !self.closest_nodes.iter().any(|n| n.node_id == node.node_id) {
                    self.closest_nodes.push(node);
                }
            }
        }
        self.closest_nodes.sort_by(|a, b| {
            let dist_a = self.target.xor_distance(&a.node_id);
            let dist_b = self.target.xor_distance(&b.node_id);
            dist_a.0.cmp(&dist_b.0)
        });
        self.closest_nodes.truncate(self.k);
    }

    fn mark_queried(&mut self, node_id: &NodeId) {
        self.queried.insert(node_id.clone(), true);
    }

    fn next_alpha_unqueried(&self) -> Vec<NodeContact> {
        self.closest_nodes
            .iter()
            .filter(|n| !self.queried.contains_key(&n.node_id))
            .take(self.alpha)
            .cloned()
            .collect()
    }

    fn is_complete(&self) -> bool {
        let unqueried_count = self
            .closest_nodes
            .iter()
            .filter(|n| !self.queried.contains_key(&n.node_id))
            .count();
        unqueried_count == 0
    }
}

pub trait RoutingTablePersistence: Send + Sync {
    fn save(&self, node_id_hex: &str, nodes: &[NodeContact]) -> Result<(), String>;
    fn load(&self, node_id_hex: &str) -> Result<Vec<NodeContact>, String>;
    fn save_bootstrap(&self, nodes: &[serde_json::Value]) -> Result<(), String>;
    fn load_bootstrap(&self) -> Result<Vec<serde_json::Value>, String>;
}

pub struct KademliaDht {
    config: DhtConfig,
    routing_table: RwLock<RoutingTable>,
    storage: RwLock<HashMap<NodeId, KadValue>>,
    local_node: NodeContact,
    bootstrap_nodes: RwLock<Vec<NodeContact>>,
    rpc: Option<Box<dyn KadRpc>>,
    instance_id: Uuid,
    persistence_store: Option<Arc<dyn RoutingTablePersistence>>,
}

impl KademliaDht {
    pub fn new(config: DhtConfig, local_addr: SocketAddr) -> Self {
        let local_id = NodeId::from_sha256(&Uuid::new_v4().as_bytes()[..]);
        let local_node = NodeContact::new(local_id.clone(), local_addr);
        let routing_table = RoutingTable::new(local_id.clone(), config.k_bucket_size);

        KademliaDht {
            config,
            routing_table: RwLock::new(routing_table),
            storage: RwLock::new(HashMap::new()),
            local_node,
            bootstrap_nodes: RwLock::new(Vec::new()),
            rpc: None,
            instance_id: Uuid::new_v4(),
            persistence_store: None,
        }
    }

    pub fn with_rpc(mut self, rpc: Box<dyn KadRpc>) -> Self {
        self.rpc = Some(rpc);
        self
    }

    pub fn with_persistence(mut self, store: Arc<dyn RoutingTablePersistence>) -> Self {
        self.persistence_store = Some(store);
        self
    }

    pub async fn load_routing_table_from_persistence(&self) -> Result<usize, KadError> {
        let store = self.persistence_store.as_ref()
            .ok_or_else(|| KadError::RpcError("no persistence store configured".to_string()))?;

        let node_id_hex = self.local_node.node_id.to_string();
        match store.load(&node_id_hex) {
            Ok(nodes) => {
                let mut rt = self.routing_table.write().await;
                let mut loaded = 0;
                for node in nodes {
                    if rt.insert(node).is_ok() {
                        loaded += 1;
                    }
                }
                log::info!("Loaded {} nodes into routing table from persistence", loaded);
                Ok(loaded)
            }
            Err(e) => {
                log::warn!("Failed to load routing table from persistence: {}", e);
                Err(KadError::RpcError(format!("persistence load failed: {}", e)))
            }
        }
    }

    pub fn local_node_id(&self) -> &NodeId {
        &self.local_node.node_id
    }

    pub fn local_node(&self) -> &NodeContact {
        &self.local_node
    }

    pub fn instance_id(&self) -> Uuid {
        self.instance_id
    }

    pub fn config(&self) -> &DhtConfig {
        &self.config
    }

    pub async fn bootstrap(&self, bootstrap_nodes: Vec<NodeContact>) -> Result<(), KadError> {
        if bootstrap_nodes.is_empty() {
            return Err(KadError::BootstrapFailed(
                "no bootstrap nodes provided".to_string(),
            ));
        }

        {
            let mut bn = self.bootstrap_nodes.write().await;
            *bn = bootstrap_nodes.clone();
        }

        for node in &bootstrap_nodes {
            let mut rt = self.routing_table.write().await;
            let _ = rt.insert(node.clone());
        }

        let self_id = self.local_node.node_id.clone();
        let closest = self.iterative_lookup(&self_id).await?;

        for node in &closest {
            let mut rt = self.routing_table.write().await;
            let _ = rt.insert(node.clone());
        }

        log::info!(
            "Bootstrap complete: {} nodes in routing table",
            self.routing_table.read().await.total_nodes()
        );

        let _ = self.persist_routing_table().await;

        Ok(())
    }

    pub async fn find_node(&self, target: &NodeId) -> Result<Vec<NodeContact>, KadError> {
        self.iterative_lookup(target).await
    }

    pub async fn find_value(&self, key: &NodeId) -> Option<KadValue> {
        {
            let storage = self.storage.read().await;
            if let Some(val) = storage.get(key) {
                return Some(val.clone());
            }
        }

        let rpc = self.rpc.as_ref()?;

        let rt = self.routing_table.read().await;
        let initial = rt.closest_nodes(key, self.config.concurrency_alpha);
        drop(rt);

        let mut state = LookupState::new(key.clone(), self.config.concurrency_alpha, self.config.k_bucket_size);
        state.add_nodes(initial);

        while !state.is_complete() {
            let batch = state.next_alpha_unqueried();
            if batch.is_empty() {
                break;
            }

            for node in &batch {
                state.mark_queried(&node.node_id);
            }

            let mut found_value: Option<KadValue> = None;

            for node in batch {
                match rpc.send_find_value(&node, key).await {
                    Ok(FindValueResult::Found(v)) => {
                        found_value = Some(v);
                        break;
                    }
                    Ok(FindValueResult::ClosestNodes(nodes)) => {
                        state.add_nodes(nodes);
                        let mut rt = self.routing_table.write().await;
                        let _ = rt.insert(node.clone());
                    }
                    Err(_) => {
                        let mut rt = self.routing_table.write().await;
                        rt.remove(&node.node_id);
                    }
                }
            }

            if let Some(v) = found_value {
                let mut storage = self.storage.write().await;
                storage.insert(key.clone(), v.clone());
                return Some(v);
            }
        }

        None
    }

    pub async fn store(&self, key: &NodeId, value: Vec<u8>) -> Result<(), KadError> {
        let kad_val = KadValue::new(key.clone(), value);

        {
            let mut storage = self.storage.write().await;
            storage.insert(key.clone(), kad_val.clone());
        }

        let targets = self.iterative_lookup(key).await?;

        let replication_targets: Vec<NodeContact> = targets
            .into_iter()
            .take(self.config.replication_factor)
            .collect();

        if replication_targets.is_empty() {
            log::warn!("Store: no replication targets found, value stored locally only");
            return Ok(());
        }

        if let Some(rpc) = &self.rpc {
            for target in &replication_targets {
                match rpc.send_store(target, key, &kad_val.value).await {
                    Ok(stored) => {
                        if stored {
                            log::debug!("Store: replicated to node {}", target.node_id);
                        }
                    }
                    Err(e) => {
                        log::warn!("Store: failed to replicate to node {}: {}", target.node_id, e);
                        let mut rt = self.routing_table.write().await;
                        rt.remove(&target.node_id);
                    }
                }
            }
        }

        log::info!(
            "Store: key {} replicated to {} nodes",
            key,
            replication_targets.len()
        );

        Ok(())
    }

    pub async fn ping(&self, node: &NodeContact) -> bool {
        if let Some(rpc) = &self.rpc {
            match rpc.send_ping(node).await {
                Ok(alive) => {
                    if alive {
                        let mut rt = self.routing_table.write().await;
                        let _ = rt.insert(node.clone());
                    }
                    alive
                }
                Err(_) => {
                    let mut rt = self.routing_table.write().await;
                    rt.remove(&node.node_id);
                    false
                }
            }
        } else {
            false
        }
    }

    pub async fn get_routing_table(&self) -> RoutingTable {
        self.routing_table.read().await.clone()
    }

    pub async fn persist_routing_table(&self) -> Result<(), KadError> {
        let store = self.persistence_store.as_ref();
        if store.is_none() {
            return Ok(());
        }
        let store = store.unwrap();
        let rt = self.routing_table.read().await;
        let nodes = rt.all_nodes();
        let node_id_hex = self.local_node.node_id.to_string();
        drop(rt);

        match store.save(&node_id_hex, &nodes) {
            Ok(_) => {
                log::debug!("Persisted routing table ({} nodes)", nodes.len());
                Ok(())
            }
            Err(e) => {
                log::warn!("Failed to persist routing table: {}", e);
                Err(KadError::RpcError(format!("persistence save failed: {}", e)))
            }
        }
    }

    pub async fn add_bootstrap_node(&self, node: NodeContact) -> Result<(), KadError> {
        let mut bn = self.bootstrap_nodes.write().await;
        if !bn.iter().any(|n| n.node_id == node.node_id) {
            bn.push(node.clone());
            drop(bn);
            self.persist_bootstrap_nodes().await?;
            log::info!("Added bootstrap node: {}", node.node_id);
        }
        Ok(())
    }

    pub async fn remove_bootstrap_node(&self, node_id: &NodeId) -> Result<bool, KadError> {
        let mut bn = self.bootstrap_nodes.write().await;
        let before = bn.len();
        bn.retain(|n| n.node_id != *node_id);
        let removed = before != bn.len();
        drop(bn);
        if removed {
            self.persist_bootstrap_nodes().await?;
            log::info!("Removed bootstrap node: {}", node_id);
        }
        Ok(removed)
    }

    pub async fn list_bootstrap_nodes(&self) -> Vec<NodeContact> {
        self.bootstrap_nodes.read().await.clone()
    }

    pub async fn persist_bootstrap_nodes(&self) -> Result<(), KadError> {
        let store = self.persistence_store.as_ref();
        if store.is_none() {
            return Ok(());
        }
        let bn = self.bootstrap_nodes.read().await;
        let json_nodes: Vec<serde_json::Value> = bn
            .iter()
            .map(|n| {
                serde_json::json!({
                    "node_id": n.node_id.to_string(),
                    "ip_addr": n.ip_addr.to_string(),
                    "last_seen": n.last_seen.to_rfc3339(),
                })
            })
            .collect();

        if let Some(store) = store {
            let result = store.save_bootstrap(&json_nodes);
            drop(bn);
            match result {
                Ok(_) => {
                    log::debug!("Persisted {} bootstrap nodes", json_nodes.len());
                    Ok(())
                }
                Err(e) => {
                    log::warn!("Failed to persist bootstrap nodes: {}", e);
                    Err(KadError::RpcError(format!("persistence save failed: {}", e)))
                }
            }
        } else {
            Ok(())
        }
    }

    pub async fn load_bootstrap_nodes_from_persistence(&self) -> Result<usize, KadError> {
        let store = self.persistence_store.as_ref()
            .ok_or_else(|| KadError::RpcError("no persistence store configured".to_string()))?;

        match store.load_bootstrap() {
            Ok(json_nodes) => {
                let mut nodes = Vec::new();
                for val in json_nodes {
                    if let (Some(node_id_hex), Some(ip_addr_str), Some(last_seen_str)) = (
                        val["node_id"].as_str(),
                        val["ip_addr"].as_str(),
                        val["last_seen"].as_str(),
                    ) {
                        if let (Ok(node_id), Ok(ip_addr), Ok(last_seen)) = (
                            NodeId::from_hex(node_id_hex),
                            ip_addr_str.parse::<SocketAddr>(),
                            DateTime::parse_from_rfc3339(last_seen_str),
                        ) {
                            nodes.push(NodeContact {
                                node_id,
                                ip_addr,
                                last_seen: last_seen.with_timezone(&Utc),
                            });
                        }
                    }
                }

                let mut bn = self.bootstrap_nodes.write().await;
                for node in nodes.clone() {
                    if !bn.iter().any(|n| n.node_id == node.node_id) {
                        bn.push(node);
                    }
                }
                log::info!("Loaded {} bootstrap nodes from persistence", nodes.len());
                Ok(nodes.len())
            }
            Err(e) => {
                log::warn!("Failed to load bootstrap nodes: {}", e);
                Err(KadError::RpcError(format!("persistence load failed: {}", e)))
            }
        }
    }

    pub async fn fast_bootstrap(&self, additional_nodes: Option<Vec<NodeContact>>) -> Result<(), KadError> {
        let mut nodes = self.list_bootstrap_nodes().await;

        if let Some(additional) = additional_nodes {
            for node in additional {
                if !nodes.iter().any(|n| n.node_id == node.node_id) {
                    nodes.push(node);
                }
            }
        }

        if nodes.is_empty() {
            return Err(KadError::RpcError(
                "no bootstrap nodes available, please provide bootstrap nodes".to_string(),
            ));
        }

        log::info!("Fast bootstrapping with {} nodes", nodes.len());
        self.bootstrap(nodes).await
    }

    pub async fn handle_rpc_request(
        &self,
        request: RpcRequest,
    ) -> Result<RpcResponse, KadError> {
        match request {
            RpcRequest::Ping {
                sender_id,
                sender_addr,
            } => {
                let contact = NodeContact::new(sender_id.clone(), sender_addr);
                let mut rt = self.routing_table.write().await;
                let _ = rt.insert(contact);
                Ok(RpcResponse::Pong {
                    responder_id: self.local_node.node_id.clone(),
                })
            }
            RpcRequest::FindNode {
                sender_id,
                sender_addr,
                target,
            } => {
                let contact = NodeContact::new(sender_id.clone(), sender_addr);
                {
                    let mut rt = self.routing_table.write().await;
                    let _ = rt.insert(contact);
                }
                let rt = self.routing_table.read().await;
                let nodes = rt.closest_nodes(&target, self.config.k_bucket_size);
                Ok(RpcResponse::FindNodeResult {
                    responder_id: self.local_node.node_id.clone(),
                    nodes,
                })
            }
            RpcRequest::FindValue {
                sender_id,
                sender_addr,
                key,
            } => {
                let contact = NodeContact::new(sender_id.clone(), sender_addr);
                {
                    let mut rt = self.routing_table.write().await;
                    let _ = rt.insert(contact);
                }
                let storage = self.storage.read().await;
                if let Some(val) = storage.get(&key) {
                    Ok(RpcResponse::FindValueResult {
                        responder_id: self.local_node.node_id.clone(),
                        value: Some(val.clone()),
                        closest_nodes: Vec::new(),
                    })
                } else {
                    let rt = self.routing_table.read().await;
                    let closest = rt.closest_nodes(&key, self.config.k_bucket_size);
                    Ok(RpcResponse::FindValueResult {
                        responder_id: self.local_node.node_id.clone(),
                        value: None,
                        closest_nodes: closest,
                    })
                }
            }
            RpcRequest::Store {
                sender_id,
                sender_addr,
                key,
                value,
            } => {
                let contact = NodeContact::new(sender_id.clone(), sender_addr);
                {
                    let mut rt = self.routing_table.write().await;
                    let _ = rt.insert(contact);
                }
                let kad_val = KadValue::new(key.clone(), value);
                let mut storage = self.storage.write().await;
                storage.insert(key, kad_val);
                Ok(RpcResponse::StoreResult {
                    responder_id: self.local_node.node_id.clone(),
                    stored: true,
                })
            }
        }
    }

    async fn iterative_lookup(&self, target: &NodeId) -> Result<Vec<NodeContact>, KadError> {
        let rpc = self
            .rpc
            .as_ref()
            .ok_or_else(|| KadError::LookupFailed("no RPC handler configured".to_string()))?;

        let rt = self.routing_table.read().await;
        let initial = rt.closest_nodes(target, self.config.concurrency_alpha);
        drop(rt);

        let mut state = LookupState::new(
            target.clone(),
            self.config.concurrency_alpha,
            self.config.k_bucket_size,
        );
        state.add_nodes(initial);

        let mut round_without_improvement = 0;

        while !state.is_complete() && round_without_improvement < 3 {
            let batch = state.next_alpha_unqueried();
            if batch.is_empty() {
                break;
            }

            let prev_closest = state.closest_nodes.clone();

            for node in &batch {
                state.mark_queried(&node.node_id);
            }

            for node in batch {
                match rpc.send_find_node(&node, target).await {
                    Ok(nodes) => {
                        state.add_nodes(nodes);
                        let mut rt = self.routing_table.write().await;
                        let _ = rt.insert(node.clone());
                    }
                    Err(_) => {
                        let mut rt = self.routing_table.write().await;
                        rt.remove(&node.node_id);
                    }
                }
            }

            if state.closest_nodes == prev_closest {
                round_without_improvement += 1;
            } else {
                round_without_improvement = 0;
            }
        }

        let remaining = state.next_alpha_unqueried();
        for node in remaining {
            state.mark_queried(&node.node_id);
            if let Ok(nodes) = rpc.send_find_node(&node, target).await {
                state.add_nodes(nodes);
                let mut rt = self.routing_table.write().await;
                let _ = rt.insert(node.clone());
            }
        }

        Ok(state.closest_nodes)
    }

    pub async fn refresh_buckets(&self) -> Result<(), KadError> {
        let rpc = self
            .rpc
            .as_ref()
            .ok_or_else(|| KadError::RpcError("no RPC handler configured".to_string()))?;

        let refresh_threshold = Utc::now() - chrono::Duration::seconds(self.config.refresh_interval_secs as i64);
        let candidates = {
            let rt = self.routing_table.read().await;
            rt.bucket_refresh_candidates(refresh_threshold)
        };

        log::info!("Refreshing {} stale bucket entries", candidates.len());

        for candidate in candidates {
            match rpc.send_ping(&candidate).await {
                Ok(true) => {
                    let mut rt = self.routing_table.write().await;
                    if let Some(node) = rt.find_mut(&candidate.node_id) {
                        node.touch();
                    }
                }
                Ok(false) | Err(_) => {
                    let mut rt = self.routing_table.write().await;
                    rt.remove(&candidate.node_id);
                }
            }
        }

        let self_id = self.local_node.node_id.clone();
        let rt = self.routing_table.read().await;
        for (bucket_idx, bucket) in rt.kbuckets.iter().enumerate() {
            if bucket.nodes.is_empty() {
                drop(rt);
                let random_id = Self::random_id_in_bucket(&self_id, bucket_idx);
                if let Ok(nodes) = self.iterative_lookup(&random_id).await {
                    let mut rt = self.routing_table.write().await;
                    for node in nodes {
                        let _ = rt.insert(node);
                    }
                }
                break;
            }
        }

        let _ = self.persist_routing_table().await;

        Ok(())
    }

    fn random_id_in_bucket(local_id: &NodeId, bucket_idx: usize) -> NodeId {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let mut id_bytes = [0u8; 32];

        let byte_idx = bucket_idx / 8;
        let bit_idx = 7 - (bucket_idx % 8);

        for i in 0..byte_idx {
            id_bytes[i] = local_id.as_bytes()[i];
        }

        id_bytes[byte_idx] = local_id.as_bytes()[byte_idx] ^ (1 << bit_idx);
        for i in (byte_idx + 1)..32 {
            id_bytes[i] = rng.gen();
        }

        NodeId::from_bytes(id_bytes)
    }

    pub async fn storage_size(&self) -> usize {
        self.storage.read().await.len()
    }

    pub async fn get_stored_keys(&self) -> Vec<NodeId> {
        self.storage.read().await.keys().cloned().collect()
    }

    pub async fn republish_values(&self) -> Result<(), KadError> {
        let keys_and_values: Vec<KadValue> = {
            let storage = self.storage.read().await;
            storage.values().cloned().collect()
        };

        for val in keys_and_values {
            self.store(&val.key, val.value.clone()).await?;
        }

        Ok(())
    }

    pub async fn expire_entries(&self, max_age: chrono::Duration) -> usize {
        let now = Utc::now();
        let mut storage = self.storage.write().await;
        let before = storage.len();
        storage.retain(|_, v| now - v.timestamp < max_age);
        before - storage.len()
    }
}

pub fn generate_key(data: &[u8]) -> NodeId {
    NodeId::from_sha256(data)
}

pub fn node_id_from_ip(addr: &SocketAddr) -> NodeId {
    let mut input = Vec::new();
    match addr.ip() {
        IpAddr::V4(v4) => {
            input.push(4u8);
            input.extend_from_slice(&v4.octets());
        }
        IpAddr::V6(v6) => {
            input.push(6u8);
            input.extend_from_slice(&v6.octets());
        }
    }
    input.extend_from_slice(&addr.port().to_be_bytes());
    NodeId::from_sha256(&input)
}

pub fn make_ipv4_contact(ip: Ipv4Addr, port: u16, node_id: Option<NodeId>) -> NodeContact {
    let addr = SocketAddr::new(IpAddr::V4(ip), port);
    let id = node_id.unwrap_or_else(|| node_id_from_ip(&addr));
    NodeContact::new(id, addr)
}

pub fn make_ipv6_contact(ip: Ipv6Addr, port: u16, node_id: Option<NodeId>) -> NodeContact {
    let addr = SocketAddr::new(IpAddr::V6(ip), port);
    let id = node_id.unwrap_or_else(|| node_id_from_ip(&addr));
    NodeContact::new(id, addr)
}

pub fn make_dual_stack_contact(ip: Ipv6Addr, port: u16, node_id: Option<NodeId>) -> NodeContact {
    let addr = SocketAddr::new(IpAddr::V6(ip), port);
    let id = node_id.unwrap_or_else(|| node_id_from_ip(&addr));
    NodeContact::new(id, addr)
}

pub struct RocksDbRoutingPersistence {
    store: Arc<crate::storage::ConfigStore>,
}

impl RocksDbRoutingPersistence {
    pub fn new(store: Arc<crate::storage::ConfigStore>) -> Self {
        Self { store }
    }
}

impl RoutingTablePersistence for RocksDbRoutingPersistence {
    fn save(&self, node_id_hex: &str, nodes: &[NodeContact]) -> Result<(), String> {
        let json_nodes: Vec<serde_json::Value> = nodes
            .iter()
            .map(|n| {
                serde_json::json!({
                    "node_id": n.node_id.to_string(),
                    "ip_addr": n.ip_addr.to_string(),
                    "last_seen": n.last_seen.to_rfc3339(),
                })
            })
            .collect();
        self.store
            .save_routing_table(node_id_hex, &json_nodes)
            .map_err(|e| e.to_string())
    }

    fn load(&self, node_id_hex: &str) -> Result<Vec<NodeContact>, String> {
        let json_nodes = self.store
            .load_routing_table(node_id_hex)
            .map_err(|e| e.to_string())?;

        let mut nodes = Vec::new();
        for val in json_nodes {
            let node_id_hex = val["node_id"]
                .as_str()
                .ok_or_else(|| "missing node_id".to_string())?;
            let ip_addr_str = val["ip_addr"]
                .as_str()
                .ok_or_else(|| "missing ip_addr".to_string())?;
            let last_seen_str = val["last_seen"]
                .as_str()
                .ok_or_else(|| "missing last_seen".to_string())?;

            let node_id = NodeId::from_hex(node_id_hex)
                .map_err(|e| e.to_string())?;
            let ip_addr: SocketAddr = ip_addr_str
                .parse()
                .map_err(|e: std::net::AddrParseError| e.to_string())?;
            let last_seen = DateTime::parse_from_rfc3339(last_seen_str)
                .map_err(|e| e.to_string())?
                .with_timezone(&Utc);

            nodes.push(NodeContact {
                node_id,
                ip_addr,
                last_seen,
            });
        }
        Ok(nodes)
    }

    fn save_bootstrap(&self, nodes: &[serde_json::Value]) -> Result<(), String> {
        self.store
            .save_bootstrap_nodes(nodes)
            .map_err(|e| e.to_string())
    }

    fn load_bootstrap(&self) -> Result<Vec<serde_json::Value>, String> {
        self.store
            .load_bootstrap_nodes()
            .map_err(|e| e.to_string())
    }
}
