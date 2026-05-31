use chrono::{DateTime, Utc};
use log::info;
use rocksdb::{
    ColumnFamilyDescriptor, ColumnFamilyOptions, DB, Direction, IteratorMode, Options, WriteBatch,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const CF_CONFIG: &str = "config";
const CF_VERSIONS: &str = "versions";
const CF_METADATA: &str = "metadata";
const KEY_CURRENT_VERSION: &[u8] = b"__current_version__";

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Serialization error: {0}")]
    SerializationError(String),
    #[error("RocksDB error: {0}")]
    RocksdbError(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
}

impl From<rocksdb::Error> for StorageError {
    fn from(err: rocksdb::Error) -> Self {
        StorageError::RocksdbError(err.to_string())
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(err: serde_json::Error) -> Self {
        StorageError::SerializationError(err.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WriteOp {
    Create,
    Update,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigRecord {
    pub key: String,
    pub value: Vec<u8>,
    pub version: u64,
    pub timestamp: DateTime<Utc>,
    pub checksum: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub version: u64,
    pub key: String,
    pub operation: WriteOp,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub entry_count: usize,
    pub version: u64,
}

fn compute_checksum(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

pub struct ConfigStore {
    db: DB,
    path: String,
}

impl ConfigStore {
    pub fn new(path: &str) -> Result<Self, StorageError> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let cf_descriptors = vec![
            ColumnFamilyDescriptor::new("default", ColumnFamilyOptions::default()),
            ColumnFamilyDescriptor::new(CF_CONFIG, ColumnFamilyOptions::default()),
            ColumnFamilyDescriptor::new(CF_VERSIONS, ColumnFamilyOptions::default()),
            ColumnFamilyDescriptor::new(CF_METADATA, ColumnFamilyOptions::default()),
        ];

        let db = DB::open_cf_descriptors(&opts, path, cf_descriptors)?;

        let store = ConfigStore {
            db,
            path: path.to_string(),
        };

        if store.get_current_version() == 0 {
            store.set_current_version(0)?;
        }

        info!("ConfigStore opened at {}", path);
        Ok(store)
    }

    fn cf_config(&self) -> &ColumnFamily {
        self.db.cf_handle(CF_CONFIG).expect("config CF must exist")
    }

    fn cf_versions(&self) -> &ColumnFamily {
        self.db
            .cf_handle(CF_VERSIONS)
            .expect("versions CF must exist")
    }

    fn cf_metadata(&self) -> &ColumnFamily {
        self.db
            .cf_handle(CF_METADATA)
            .expect("metadata CF must exist")
    }

    pub fn get_current_version(&self) -> u64 {
        self.db
            .get_cf(self.cf_metadata(), KEY_CURRENT_VERSION)
            .ok()
            .flatten()
            .and_then(|v| serde_json::from_slice::<u64>(&v).ok())
            .unwrap_or(0)
    }

    fn set_current_version(&self, version: u64) -> Result<(), StorageError> {
        let data = serde_json::to_vec(&version)?;
        self.db
            .put_cf(self.cf_metadata(), KEY_CURRENT_VERSION, data)?;
        Ok(())
    }

    fn increment_version(&self) -> Result<u64, StorageError> {
        let next = self.get_current_version() + 1;
        self.set_current_version(next)?;
        Ok(next)
    }

    pub fn put(&self, key: &str, value: Vec<u8>) -> Result<ConfigRecord, StorageError> {
        let existing = self.get(key)?;
        let operation = if existing.is_some() {
            WriteOp::Update
        } else {
            WriteOp::Create
        };

        let version = self.increment_version()?;
        let timestamp = Utc::now();
        let checksum = compute_checksum(&value);

        let record = ConfigRecord {
            key: key.to_string(),
            value,
            version,
            timestamp,
            checksum,
        };

        let record_data = serde_json::to_vec(&record)?;
        self.db.put_cf(self.cf_config(), key, &record_data)?;

        let version_entry = VersionEntry {
            version,
            key: key.to_string(),
            operation,
            timestamp,
        };
        let version_key = format!("{}\x00{:020}", key, version);
        let version_data = serde_json::to_vec(&version_entry)?;
        self.db.put_cf(self.cf_versions(), &version_key, &version_data)?;

        info!("Put key={} version={} op={:?}", key, version, operation);
        Ok(record)
    }

    pub fn get(&self, key: &str) -> Result<Option<ConfigRecord>, StorageError> {
        match self.db.get_cf(self.cf_config(), key)? {
            Some(bytes) => {
                let record: ConfigRecord = serde_json::from_slice(&bytes)?;
                Ok(Some(record))
            }
            None => Ok(None),
        }
    }

    pub fn delete(&self, key: &str) -> Result<(), StorageError> {
        if self.get(key)?.is_none() {
            return Err(StorageError::NotFound(key.to_string()));
        }

        let version = self.increment_version()?;
        let timestamp = Utc::now();

        self.db.delete_cf(self.cf_config(), key)?;

        let version_entry = VersionEntry {
            version,
            key: key.to_string(),
            operation: WriteOp::Delete,
            timestamp,
        };
        let version_key = format!("{}\x00{:020}", key, version);
        let version_data = serde_json::to_vec(&version_entry)?;
        self.db.put_cf(self.cf_versions(), &version_key, &version_data)?;

        info!("Delete key={} version={}", key, version);
        Ok(())
    }

    pub fn list(&self, prefix: Option<&str>) -> Result<Vec<ConfigRecord>, StorageError> {
        let cf = self.cf_config();
        let iter = match prefix {
            Some(p) => {
                self.db
                    .iterator_cf(cf, IteratorMode::From(p.as_bytes(), Direction::Forward))
            }
            None => self.db.iterator_cf(cf, IteratorMode::Start),
        };

        let mut records = Vec::new();
        for item in iter {
            let (k, v) = item?;
            let key_str = String::from_utf8_lossy(&k);
            if let Some(p) = prefix {
                if !key_str.starts_with(p) {
                    break;
                }
            }
            let record: ConfigRecord = serde_json::from_slice(&v)?;
            records.push(record);
        }

        Ok(records)
    }

    pub fn get_version_history(&self, key: &str) -> Result<Vec<VersionEntry>, StorageError> {
        let prefix = format!("{}\x00", key);
        let cf = self.cf_versions();
        let iter = self.db.iterator_cf(
            cf,
            IteratorMode::From(prefix.as_bytes(), Direction::Forward),
        );

        let mut entries = Vec::new();
        for item in iter {
            let (k, v) = item?;
            let key_str = String::from_utf8_lossy(&k);
            if !key_str.starts_with(&prefix) {
                break;
            }
            let entry: VersionEntry = serde_json::from_slice(&v)?;
            entries.push(entry);
        }

        Ok(entries)
    }

    pub fn create_snapshot(&self, name: &str) -> Result<Snapshot, StorageError> {
        let snapshot_key = format!("__snapshot__{}", name);
        if self
            .db
            .get_cf(self.cf_metadata(), &snapshot_key)?
            .is_some()
        {
            return Err(StorageError::Conflict(format!(
                "Snapshot '{}' already exists",
                name
            )));
        }

        let records = self.list(None)?;
        let entry_count = records.len();
        let version = self.get_current_version();
        let timestamp = Utc::now();

        let snapshot = Snapshot {
            name: name.to_string(),
            created_at: timestamp,
            entry_count,
            version,
        };

        let snapshot_data = serde_json::to_vec(&snapshot)?;
        self.db
            .put_cf(self.cf_metadata(), &snapshot_key, &snapshot_data)?;

        for record in &records {
            let snap_data_key = format!("__snapdata__{}__{}", name, record.key);
            let record_data = serde_json::to_vec(record)?;
            self.db
                .put_cf(self.cf_metadata(), &snap_data_key, &record_data)?;
        }

        info!(
            "Created snapshot '{}' with {} entries at version {}",
            name, entry_count, version
        );
        Ok(snapshot)
    }

    pub fn restore_snapshot(&self, name: &str) -> Result<(), StorageError> {
        let snapshot_key = format!("__snapshot__{}", name);
        let snapshot_data = self
            .db
            .get_cf(self.cf_metadata(), &snapshot_key)?
            .ok_or_else(|| StorageError::NotFound(format!("Snapshot '{}' not found", name)))?;
        let snapshot: Snapshot = serde_json::from_slice(&snapshot_data)?;

        let mut batch = WriteBatch::default();

        let existing = self.list(None)?;
        for record in &existing {
            batch.delete_cf(self.cf_config(), &record.key);
        }

        let snap_prefix = format!("__snapdata__{}__", name);
        let cf = self.cf_metadata();
        let iter = self.db.iterator_cf(
            cf,
            IteratorMode::From(snap_prefix.as_bytes(), Direction::Forward),
        );

        for item in iter {
            let (k, v) = item?;
            let key_str = String::from_utf8_lossy(&k);
            if !key_str.starts_with(&snap_prefix) {
                break;
            }
            let record: ConfigRecord = serde_json::from_slice(&v)?;
            let record_data = serde_json::to_vec(&record)?;
            batch.put_cf(self.cf_config(), &record.key, &record_data);
        }

        let version_data = serde_json::to_vec(&snapshot.version)?;
        batch.put_cf(self.cf_metadata(), KEY_CURRENT_VERSION, &version_data);

        self.db.write(batch)?;

        info!(
            "Restored snapshot '{}' with {} entries at version {}",
            name, snapshot.entry_count, snapshot.version
        );
        Ok(())
    }

    pub fn list_snapshots(&self) -> Result<Vec<Snapshot>, StorageError> {
        let prefix = "__snapshot__";
        let cf = self.cf_metadata();
        let iter = self.db.iterator_cf(
            cf,
            IteratorMode::From(prefix.as_bytes(), Direction::Forward),
        );

        let mut snapshots = Vec::new();
        for item in iter {
            let (k, v) = item?;
            let key_str = String::from_utf8_lossy(&k);
            if !key_str.starts_with(prefix) {
                break;
            }
            let snapshot: Snapshot = serde_json::from_slice(&v)?;
            snapshots.push(snapshot);
        }

        Ok(snapshots)
    }

    pub fn delete_snapshot(&self, name: &str) -> Result<(), StorageError> {
        let snapshot_key = format!("__snapshot__{}", name);
        let snapdata_prefix = format!("__snapdata__{}__", name);
        let cf = self.cf_metadata();

        let snapshot_exists = self.db.get_cf(cf, snapshot_key.as_bytes())?
            .ok_or_else(|| StorageError::NotFound(format!("Snapshot '{}' not found", name)))?;

        let mut batch = WriteBatch::default();
        batch.delete_cf(cf, snapshot_key.as_bytes());

        let iter = self.db.iterator_cf(
            cf,
            IteratorMode::From(snapdata_prefix.as_bytes(), Direction::Forward),
        );

        for item in iter {
            let (k, _) = item?;
            let key_str = String::from_utf8_lossy(&k);
            if !key_str.starts_with(&snapdata_prefix) {
                break;
            }
            batch.delete_cf(cf, &k);
        }

        self.db.write(batch)?;

        info!("Deleted snapshot '{}'", name);
        Ok(())
    }

    pub fn batch_write(
        &self,
        operations: Vec<(String, Option<Vec<u8>>)>,
    ) -> Result<Vec<ConfigRecord>, StorageError> {
        let mut batch = WriteBatch::default();
        let mut results = Vec::with_capacity(operations.len());
        let mut version = self.get_current_version();

        for (key, value_opt) in &operations {
            version += 1;
            let timestamp = Utc::now();

            match value_opt {
                Some(value) => {
                    let existing = self.get(key)?;
                    let operation = if existing.is_some() {
                        WriteOp::Update
                    } else {
                        WriteOp::Create
                    };

                    let checksum = compute_checksum(value);
                    let record = ConfigRecord {
                        key: key.clone(),
                        value: value.clone(),
                        version,
                        timestamp,
                        checksum,
                    };

                    let record_data = serde_json::to_vec(&record)?;
                    batch.put_cf(self.cf_config(), key, &record_data);

                    let version_entry = VersionEntry {
                        version,
                        key: key.clone(),
                        operation,
                        timestamp,
                    };
                    let version_key = format!("{}\x00{:020}", key, version);
                    let version_data = serde_json::to_vec(&version_entry)?;
                    batch.put_cf(self.cf_versions(), &version_key, &version_data);

                    results.push(record);
                }
                None => {
                    let version_entry = VersionEntry {
                        version,
                        key: key.clone(),
                        operation: WriteOp::Delete,
                        timestamp,
                    };
                    let version_key = format!("{}\x00{:020}", key, version);
                    let version_data = serde_json::to_vec(&version_entry)?;
                    batch.put_cf(self.cf_versions(), &version_key, &version_data);
                    batch.delete_cf(self.cf_config(), key);
                }
            }
        }

        let version_data = serde_json::to_vec(&version)?;
        batch.put_cf(self.cf_metadata(), KEY_CURRENT_VERSION, &version_data);

        self.db.write(batch)?;

        info!(
            "Batch write: {} operations, new version {}",
            operations.len(),
            version
        );
        Ok(results)
    }

    pub fn compact(&self) -> Result<(), StorageError> {
        for cf_name in &[CF_CONFIG, CF_VERSIONS, CF_METADATA] {
            let cf = self
                .db
                .cf_handle(cf_name)
                .ok_or_else(|| StorageError::RocksdbError(format!("CF {} not found", cf_name)))?;
            self.db
                .compact_range_cf(cf, None::<Vec<u8>>, None::<Vec<u8>>);
        }
        info!("Compaction completed");
        Ok(())
    }

    pub fn save_routing_table(&self, local_node_id_hex: &str, nodes: &[serde_json::Value]) -> Result<(), StorageError> {
        let key = format!("__routing_table__{}", local_node_id_hex);
        let data = serde_json::to_vec(nodes)?;
        self.db.put_cf(self.cf_metadata(), &key, &data)?;
        info!("Saved routing table for node {} ({} nodes)", local_node_id_hex, nodes.len());
        Ok(())
    }

    pub fn load_routing_table(&self, local_node_id_hex: &str) -> Result<Vec<serde_json::Value>, StorageError> {
        let key = format!("__routing_table__{}", local_node_id_hex);
        match self.db.get_cf(self.cf_metadata(), &key)? {
            Some(data) => {
                let nodes: Vec<serde_json::Value> = serde_json::from_slice(&data)?;
                info!("Loaded routing table for node {} ({} nodes)", local_node_id_hex, nodes.len());
                Ok(nodes)
            }
            None => {
                info!("No saved routing table found for node {}", local_node_id_hex);
                Ok(Vec::new())
            }
        }
    }

    pub fn save_bootstrap_nodes(&self, nodes: &[serde_json::Value]) -> Result<(), StorageError> {
        let key = "__bootstrap_nodes__";
        let data = serde_json::to_vec(nodes)?;
        self.db.put_cf(self.cf_metadata(), key, &data)?;
        info!("Saved {} bootstrap nodes", nodes.len());
        Ok(())
    }

    pub fn load_bootstrap_nodes(&self) -> Result<Vec<serde_json::Value>, StorageError> {
        let key = "__bootstrap_nodes__";
        match self.db.get_cf(self.cf_metadata(), key)? {
            Some(data) => {
                let nodes: Vec<serde_json::Value> = serde_json::from_slice(&data)?;
                info!("Loaded {} bootstrap nodes from persistence", nodes.len());
                Ok(nodes)
            }
            None => {
                info!("No saved bootstrap nodes found");
                Ok(Vec::new())
            }
        }
    }
}
