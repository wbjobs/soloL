use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client, RedisResult};
use serde::Serialize;

use crate::error::QuantumError;
use crate::quantum::simulator::{MeasurementResult, SimulationResult};

#[derive(Clone)]
pub struct CacheManager {
    client: Client,
    default_ttl: Option<u64>,
    key_prefix: String,
}

impl CacheManager {
    pub fn new(redis_url: &str) -> Result<Self, QuantumError> {
        let client = Client::open(redis_url)?;
        Ok(CacheManager {
            client,
            default_ttl: Some(3600),
            key_prefix: "quantum:".to_string(),
        })
    }

    pub fn with_ttl(mut self, ttl_seconds: u64) -> Self {
        self.default_ttl = Some(ttl_seconds);
        self
    }

    pub fn with_prefix(mut self, prefix: &str) -> Self {
        self.key_prefix = prefix.to_string();
        self
    }

    fn build_key(&self, circuit_hash: &str, suffix: &str) -> String {
        format!("{}{}:{}", self.key_prefix, circuit_hash, suffix)
    }

    async fn get_connection(&self) -> Result<MultiplexedConnection, QuantumError> {
        self.client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| QuantumError::CacheError(e.to_string()))
    }

    pub async fn set_simulation_result(
        &self,
        circuit_hash: &str,
        result: &SimulationResult,
    ) -> Result<(), QuantumError> {
        let mut conn = self.get_connection().await?;
        let key = self.build_key(circuit_hash, "simulation");
        let serialized = serde_json::to_string(result)?;

        if let Some(ttl) = self.default_ttl {
            let _: () = conn.set_ex(&key, serialized, ttl).await?;
        } else {
            let _: () = conn.set(&key, serialized).await?;
        }

        Ok(())
    }

    pub async fn get_simulation_result(
        &self,
        circuit_hash: &str,
    ) -> Result<Option<SimulationResult>, QuantumError> {
        let mut conn = self.get_connection().await?;
        let key = self.build_key(circuit_hash, "simulation");

        let value: Option<String> = conn.get(&key).await?;

        match value {
            Some(serialized) => {
                let result: SimulationResult = serde_json::from_str(&serialized)?;
                Ok(Some(result))
            }
            None => Ok(None),
        }
    }

    pub async fn set_measurement_result(
        &self,
        circuit_hash: &str,
        shots: usize,
        result: &MeasurementResult,
    ) -> Result<(), QuantumError> {
        let mut conn = self.get_connection().await?;
        let key = self.build_key(circuit_hash, &format!("measurement:{}", shots));
        let serialized = serde_json::to_string(result)?;

        if let Some(ttl) = self.default_ttl {
            let _: () = conn.set_ex(&key, serialized, ttl).await?;
        } else {
            let _: () = conn.set(&key, serialized).await?;
        }

        Ok(())
    }

    pub async fn get_measurement_result(
        &self,
        circuit_hash: &str,
        shots: usize,
    ) -> Result<Option<MeasurementResult>, QuantumError> {
        let mut conn = self.get_connection().await?;
        let key = self.build_key(circuit_hash, &format!("measurement:{}", shots));

        let value: Option<String> = conn.get(&key).await?;

        match value {
            Some(serialized) => {
                let result: MeasurementResult = serde_json::from_str(&serialized)?;
                Ok(Some(result))
            }
            None => Ok(None),
        }
    }

    pub async fn set_compiled_circuit(
        &self,
        circuit_hash: &str,
        compiled: &crate::quantum::circuit::CompiledCircuit,
    ) -> Result<(), QuantumError> {
        let mut conn = self.get_connection().await?;
        let key = self.build_key(circuit_hash, "compiled");
        let serialized = serde_json::to_string(compiled)?;

        if let Some(ttl) = self.default_ttl {
            let _: () = conn.set_ex(&key, serialized, ttl).await?;
        } else {
            let _: () = conn.set(&key, serialized).await?;
        }

        Ok(())
    }

    pub async fn get_compiled_circuit(
        &self,
        circuit_hash: &str,
    ) -> Result<Option<crate::quantum::circuit::CompiledCircuit>, QuantumError> {
        let mut conn = self.get_connection().await?;
        let key = self.build_key(circuit_hash, "compiled");

        let value: Option<String> = conn.get(&key).await?;

        match value {
            Some(serialized) => {
                let result = serde_json::from_str(&serialized)?;
                Ok(Some(result))
            }
            None => Ok(None),
        }
    }

    pub async fn delete_circuit_data(&self, circuit_hash: &str) -> Result<(), QuantumError> {
        let mut conn = self.get_connection().await?;

        let keys = vec![
            self.build_key(circuit_hash, "simulation"),
            self.build_key(circuit_hash, "compiled"),
        ];

        let _: () = conn.del(keys).await?;

        Ok(())
    }

    pub async fn clear_all(&self) -> Result<(), QuantumError> {
        let mut conn = self.get_connection().await?;
        let pattern = format!("{}*", self.key_prefix);
        let keys: Vec<String> = redis::cmd("KEYS").arg(&pattern).query_async(&mut conn).await?;

        if !keys.is_empty() {
            let _: () = conn.del(keys).await?;
        }

        Ok(())
    }

    pub async fn ping(&self) -> Result<bool, QuantumError> {
        let mut conn = self.get_connection().await?;
        let result: RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
        Ok(result.is_ok() && result.unwrap() == "PONG")
    }

    pub async fn get_stats(&self) -> Result<CacheStats, QuantumError> {
        let mut conn = self.get_connection().await?;
        let pattern = format!("{}*", self.key_prefix);
        let keys: Vec<String> = redis::cmd("KEYS").arg(&pattern).query_async(&mut conn).await?;

        let mut stats = CacheStats::default();
        stats.total_keys = keys.len();

        for key in &keys {
            if key.ends_with(":simulation") {
                stats.simulation_keys += 1;
            } else if key.ends_with(":compiled") {
                stats.compiled_keys += 1;
            } else if key.contains(":measurement:") {
                stats.measurement_keys += 1;
            }
        }

        Ok(stats)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CacheStats {
    pub total_keys: usize,
    pub simulation_keys: usize,
    pub compiled_keys: usize,
    pub measurement_keys: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_key() {
        let cache = CacheManager::new("redis://127.0.0.1/").unwrap_or_else(|_| {
            CacheManager {
                client: Client::open("redis://127.0.0.1/").unwrap(),
                default_ttl: Some(3600),
                key_prefix: "quantum:".to_string(),
            }
        });

        let key = cache.build_key("abc123", "simulation");
        assert_eq!(key, "quantum:abc123:simulation");
    }

    #[test]
    fn test_with_prefix() {
        let cache = CacheManager::new("redis://127.0.0.1/").unwrap_or_else(|_| {
            CacheManager {
                client: Client::open("redis://127.0.0.1/").unwrap(),
                default_ttl: Some(3600),
                key_prefix: "quantum:".to_string(),
            }
        });

        let cache = cache.with_prefix("test:");
        let key = cache.build_key("abc123", "simulation");
        assert_eq!(key, "test:abc123:simulation");
    }

    #[test]
    fn test_with_ttl() {
        let cache = CacheManager::new("redis://127.0.0.1/").unwrap_or_else(|_| {
            CacheManager {
                client: Client::open("redis://127.0.0.1/").unwrap(),
                default_ttl: Some(3600),
                key_prefix: "quantum:".to_string(),
            }
        });

        let cache = cache.with_ttl(7200);
        assert_eq!(cache.default_ttl, Some(7200));
    }
}
