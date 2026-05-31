use actix_cors::Cors;
use actix_web::{web, App, HttpServer};
use log::info;
use std::env;

use quantum_simulator::api::configure_routes;
use quantum_simulator::cache::CacheManager;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    env_logger::init();

    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let redis_url = env::var("REDIS_URL").ok();

    info!("Starting Quantum Circuit Simulator Service...");
    info!("Host: {}", host);
    info!("Port: {}", port);
    info!("Redis: {}", if redis_url.is_some() { "Enabled" } else { "Disabled" });

    let cache_manager = match redis_url {
        Some(url) => match CacheManager::new(&url) {
            Ok(cm) => {
                info!("Successfully connected to Redis");
                Some(cm)
            }
            Err(e) => {
                log::warn!("Failed to connect to Redis: {}", e);
                None
            }
        },
        None => None,
    };

    let bind_addr = format!("{}:{}", host, port);

    HttpServer::new(move || {
        let cors = Cors::permissive();

        App::new()
            .wrap(cors)
            .app_data(web::Data::new(cache_manager.clone()))
            .configure(configure_routes)
    })
    .bind(&bind_addr)?
    .run()
    .await?;

    Ok(())
}
