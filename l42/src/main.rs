pub mod api;
pub mod kademlia;
pub mod network;
pub mod storage;
pub mod sync;
pub mod tunnel;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Server;
use clap::Parser;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing_subscriber::{fmt, EnvFilter};

use crate::api::{AppState, create_router};
use crate::kademlia::{DhtConfig, KademliaDht, NodeId, RocksDbRoutingPersistence};
use crate::network::{get_local_addresses, DualStackConfig};
use crate::storage::ConfigStore;
use crate::sync::SyncProtocol;
use crate::tunnel::TunnelManager;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[arg(short, long, default_value = "0.0.0.0:8080")]
    api_addr: String,

    #[arg(short, long, default_value = "data/rocksdb")]
    db_path: String,

    #[arg(long, default_value = "[::]:0")]
    dht_addr: String,

    #[arg(long, value_delimiter = ',')]
    stun_servers: Option<Vec<String>>,

    #[arg(long, value_delimiter = ',')]
    bootstrap_nodes: Option<Vec<String>>,

    #[arg(long, default_value = "false")]
    ipv6_only: bool,

    #[arg(long, default_value = "info")]
    log_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub node_id: String,
    pub api_addr: String,
    pub db_path: String,
    pub dht_addr: SocketAddr,
    pub stun_servers: Vec<SocketAddr>,
    pub bootstrap_nodes: Vec<String>,
    pub ipv6_only: bool,
    pub dual_stack_config: DualStackConfig,
    pub dht_config: DhtConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            node_id: NodeId::random().to_string(),
            api_addr: "0.0.0.0:8080".to_string(),
            db_path: "data/rocksdb".to_string(),
            dht_addr: "[::]:0".parse().unwrap(),
            stun_servers: vec![
                "stun.l.google.com:19302".parse().unwrap(),
                "stun1.l.google.com:19302".parse().unwrap(),
                "stun2.l.google.com:19302".parse().unwrap(),
            ],
            bootstrap_nodes: Vec::new(),
            ipv6_only: false,
            dual_stack_config: DualStackConfig::default(),
            dht_config: DhtConfig::default(),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&cli.log_level));
    fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(true)
        .init();

    tracing::info!("Starting SCTP P2P Tunnel...");

    let stun_servers = cli.stun_servers.unwrap_or_else(|| {
        vec![
            "stun.l.google.com:19302".to_string(),
            "stun1.l.google.com:19302".to_string(),
        ]
    });

    let stun_addrs: Vec<SocketAddr> = stun_servers
        .iter()
        .filter_map(|s| s.parse().ok())
        .collect();

    let config = AppConfig {
        ipv6_only: cli.ipv6_only,
        dual_stack_config: DualStackConfig {
            ipv6_only: cli.ipv6_only,
            ..Default::default()
        },
        ..Default::default()
    };

    tracing::info!("Node ID: {}", config.node_id);
    tracing::info!("API Address: {}", cli.api_addr);
    tracing::info!("DB Path: {}", cli.db_path);
    tracing::info!("IPv6 Only: {}", cli.ipv6_only);

    let local_addrs = get_local_addresses()?;
    tracing::info!("Local addresses: {:?}", local_addrs);

    tracing::info!("Initializing RocksDB store...");
    let config_store = Arc::new(ConfigStore::new(&cli.db_path)?);
    tracing::info!("RocksDB store initialized, current version: {}", config_store.get_current_version());

    tracing::info!("Initializing Tunnel Manager...");
    let tunnel_manager = Arc::new(RwLock::new(TunnelManager::new(stun_addrs.clone())));

    tracing::info!("Initializing Kademlia DHT...");
    let dht_addr: SocketAddr = cli.dht_addr.parse()?;
    let routing_persistence = RocksDbRoutingPersistence::new(config_store.clone());
    let kademlia_dht = Arc::new(RwLock::new(
        KademliaDht::new(config.dht_config.clone(), dht_addr)
            .with_persistence(Arc::new(routing_persistence))
    ));

    {
        let dht = kademlia_dht.read().await;
        match dht.load_routing_table_from_persistence().await {
            Ok(count) => tracing::info!("Loaded {} nodes from persisted routing table", count),
            Err(e) => tracing::warn!("Could not load persisted routing table: {}", e),
        }
        match dht.load_bootstrap_nodes_from_persistence().await {
            Ok(count) => tracing::info!("Loaded {} bootstrap nodes from persistence", count),
            Err(e) => tracing::warn!("Could not load persisted bootstrap nodes: {}", e),
        }
    }

    tracing::info!("Initializing Sync Protocol...");
    let sync_protocol = Arc::new(SyncProtocol::new());

    let app_state = AppState {
        tunnel_manager: tunnel_manager.clone(),
        config_store: config_store.clone(),
        dht: kademlia_dht.clone(),
        sync_protocol: sync_protocol.clone(),
        node_id: config.node_id.clone(),
    };

    if let Some(bootstrap) = cli.bootstrap_nodes {
        if !bootstrap.is_empty() {
            tracing::info!("Bootstrapping DHT with {} nodes...", bootstrap.len());
            let dht = kademlia_dht.read().await;
            let bootstrap_nodes: Vec<crate::kademlia::NodeContact> = bootstrap
                .iter()
                .filter_map(|s| {
                    let parts: Vec<&str> = s.split('@').collect();
                    if parts.len() == 2 {
                        if let (Ok(node_id), Ok(addr)) = (NodeId::from_hex(parts[0]), parts[1].parse::<SocketAddr>()) {
                            Some(crate::kademlia::NodeContact::new(node_id, addr))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                })
                .collect();

            for node in &bootstrap_nodes {
                if let Err(e) = dht.add_bootstrap_node(node.clone()).await {
                    tracing::warn!("Failed to add bootstrap node: {}", e);
                }
            }

            if let Err(e) = dht.fast_bootstrap(Some(bootstrap_nodes)).await {
                tracing::warn!("DHT fast bootstrap warning: {}", e);
            }
        } else {
            let dht = kademlia_dht.read().await;
            if let Err(e) = dht.fast_bootstrap(None).await {
                tracing::warn!("DHT fast bootstrap warning: {}", e);
            }
        }
    } else {
        let dht = kademlia_dht.read().await;
        if let Err(e) = dht.fast_bootstrap(None).await {
            tracing::debug!("No bootstrap nodes available: {}", e);
        }
    }

    let router = create_router(app_state);

    let api_addr: SocketAddr = cli.api_addr.parse()?;
    tracing::info!("Starting REST API server on {}", api_addr);

    let server = Server::bind(&api_addr)
        .serve(router.into_make_service_with_connect_info::<SocketAddr>());

    tracing::info!("SCTP P2P Tunnel started successfully!");
    tracing::info!("API available at: http://{}", api_addr);
    tracing::info!("Health check: http://{}/health", api_addr);

    let tm_for_health = tunnel_manager.clone();
    tokio::spawn(async move {
        let tm_guard = tm_for_health.read().await;
        let tm_arc = Arc::new(tm_guard.clone());
        tm_arc.start_health_check().await;
    });

    tokio::select! {
        result = server => {
            if let Err(e) = result {
                tracing::error!("Server error: {}", e);
            }
        }
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("Received shutdown signal, gracefully stopping...");
        }
    }

    tracing::info!("Shutting down...");
    Ok(())
}
