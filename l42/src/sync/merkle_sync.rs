use std::collections::HashMap;
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("hash computation failed")]
    HashError,
    #[error("entry not found: {0}")]
    EntryNotFound(String),
    #[error("tree is empty")]
    EmptyTree,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: Vec<u8>,
    pub version: u64,
    pub timestamp: DateTime<Utc>,
}

impl ConfigEntry {
    pub fn new(key: String, value: Vec<u8>, version: u64, timestamp: DateTime<Utc>) -> Self {
        Self {
            key,
            value,
            version,
            timestamp,
        }
    }

    pub fn compute_hash(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"LEAF\x00");
        hasher.update(&(self.key.len() as u64).to_le_bytes());
        hasher.update(self.key.as_bytes());
        hasher.update(&(self.value.len() as u64).to_le_bytes());
        hasher.update(&self.value);
        hasher.update(&self.version.to_le_bytes());
        hasher.update(self.timestamp.timestamp_millis().to_le_bytes());
        hasher.finalize().into()
    }

    pub fn hash_hex(&self) -> String {
        hex::encode(self.compute_hash())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleNode {
    pub hash: [u8; 32],
    pub children: Vec<MerkleNode>,
    pub leaf_data: Option<ConfigEntry>,
    pub key_range: (String, String),
}

impl MerkleNode {
    pub fn is_leaf(&self) -> bool {
        self.children.is_empty()
    }

    pub fn hash_hex(&self) -> String {
        hex::encode(self.hash)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerkleTree {
    pub root: Option<MerkleNode>,
    pub entries: HashMap<String, ConfigEntry>,
}

impl MerkleTree {
    pub fn new() -> Self {
        Self {
            root: None,
            entries: HashMap::new(),
        }
    }

    pub fn root_hash(&self) -> Option<[u8; 32]> {
        self.root.as_ref().map(|r| r.hash)
    }

    pub fn root_hash_hex(&self) -> Option<String> {
        self.root_hash().map(hex::encode)
    }

    pub fn get_entry(&self, key: &str) -> Option<&ConfigEntry> {
        self.entries.get(key)
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    pub fn insert_entry(&mut self, entry: ConfigEntry) {
        self.entries.insert(entry.key.clone(), entry);
    }

    pub fn rebuild(&mut self) {
        if self.entries.is_empty() {
            self.root = None;
            return;
        }

        let mut sorted_entries: Vec<&ConfigEntry> = self.entries.values().collect();
        sorted_entries.sort_by(|a, b| a.key.cmp(&b.key));

        let leaf_nodes: Vec<MerkleNode> = sorted_entries
            .into_iter()
            .map(|entry| {
                let hash = entry.compute_hash();
                MerkleNode {
                    hash,
                    children: vec![],
                    leaf_data: Some(entry.clone()),
                    key_range: (entry.key.clone(), entry.key.clone()),
                }
            })
            .collect();

        self.root = Some(Self::build_internal(leaf_nodes));
    }

    fn build_internal(nodes: Vec<MerkleNode>) -> MerkleNode {
        if nodes.len() == 1 {
            return nodes.into_iter().next().unwrap();
        }

        let chunks = Self::chunk_nodes(nodes);
        let parents: Vec<MerkleNode> = chunks
            .into_iter()
            .map(|chunk| {
                let key_start = chunk
                    .first()
                    .map(|n| n.key_range.0.clone())
                    .unwrap_or_default();
                let key_end = chunk
                    .last()
                    .map(|n| n.key_range.1.clone())
                    .unwrap_or_default();

                let mut hasher = Sha256::new();
                hasher.update(b"INTERNAL\x00");
                hasher.update(&(chunk.len() as u64).to_le_bytes());
                for child in &chunk {
                    hasher.update(&child.hash);
                }
                let hash: [u8; 32] = hasher.finalize().into();

                MerkleNode {
                    hash,
                    children: chunk,
                    leaf_data: None,
                    key_range: (key_start, key_end),
                }
            })
            .collect();

        Self::build_internal(parents)
    }

    fn chunk_nodes(nodes: Vec<MerkleNode>) -> Vec<Vec<MerkleNode>> {
        let branching = 2;
        nodes
            .chunks(branching)
            .map(|c| c.to_vec())
            .collect()
    }

    pub fn find_divergent_keys(&self, other: &MerkleTree) -> Vec<String> {
        match (&self.root, &other.root) {
            (None, None) => vec![],
            (Some(_), None) => self.entries.keys().cloned().collect(),
            (None, Some(_)) => other.entries.keys().cloned().collect(),
            (Some(local_root), Some(remote_root)) => {
                let mut divergent = vec![];
                Self::collect_divergent(local_root, remote_root, &mut divergent);
                divergent
            }
        }
    }

    fn collect_divergent(
        local: &MerkleNode,
        remote: &MerkleNode,
        divergent: &mut Vec<String>,
    ) {
        if local.hash == remote.hash {
            return;
        }

        if local.is_leaf() && remote.is_leaf() {
            match (&local.leaf_data, &remote.leaf_data) {
                (Some(a), Some(b)) if a.key == b.key => {
                    divergent.push(a.key.clone());
                }
                _ => {
                    if let Some(e) = &local.leaf_data {
                        divergent.push(e.key.clone());
                    }
                    if let Some(e) = &remote.leaf_data {
                        if !divergent.contains(&e.key) {
                            divergent.push(e.key.clone());
                        }
                    }
                }
            }
            return;
        }

        if local.is_leaf() || remote.is_leaf() {
            Self::collect_all_leaf_keys(local, divergent);
            Self::collect_all_leaf_keys(remote, divergent);
            return;
        }

        let local_map: HashMap<&str, &MerkleNode> = local
            .children
            .iter()
            .map(|c| (c.key_range.0.as_str(), c))
            .collect();
        let remote_map: HashMap<&str, &MerkleNode> = remote
            .children
            .iter()
            .map(|c| (c.key_range.0.as_str(), c))
            .collect();

        for (key_start, local_child) in &local_map {
            if let Some(remote_child) = remote_map.get(key_start) {
                Self::collect_divergent(local_child, remote_child, divergent);
            } else {
                Self::collect_all_leaf_keys(local_child, divergent);
            }
        }

        for (key_start, remote_child) in &remote_map {
            if local_map.get(key_start).is_none() {
                Self::collect_all_leaf_keys(remote_child, divergent);
            }
        }
    }

    fn collect_all_leaf_keys(node: &MerkleNode, keys: &mut Vec<String>) {
        if node.is_leaf() {
            if let Some(e) = &node.leaf_data {
                if !keys.contains(&e.key) {
                    keys.push(e.key.clone());
                }
            }
        } else {
            for child in &node.children {
                Self::collect_all_leaf_keys(child, keys);
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffPath {
    pub path: Vec<String>,
    pub key: String,
    pub diff_type: DiffType,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DiffType {
    Added,
    Updated,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncDiff {
    pub added: Vec<ConfigEntry>,
    pub updated: Vec<ConfigEntry>,
    pub deleted: Vec<String>,
}

impl SyncDiff {
    pub fn new() -> Self {
        Self {
            added: vec![],
            updated: vec![],
            deleted: vec![],
        }
    }

    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.updated.is_empty() && self.deleted.is_empty()
    }

    pub fn total_changes(&self) -> usize {
        self.added.len() + self.updated.len() + self.deleted.len()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub entries_applied: usize,
    pub conflicts_resolved: usize,
    pub sync_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncVersionVector {
    pub versions: HashMap<String, u64>,
    pub root_hash: Option<[u8; 32]>,
    pub timestamp: DateTime<Utc>,
}

impl SyncVersionVector {
    pub fn new() -> Self {
        Self {
            versions: HashMap::new(),
            root_hash: None,
            timestamp: Utc::now(),
        }
    }

    pub fn from_tree(tree: &MerkleTree) -> Self {
        let mut versions = HashMap::new();
        for (key, entry) in &tree.entries {
            versions.insert(key.clone(), entry.version);
        }
        Self {
            versions,
            root_hash: tree.root_hash(),
            timestamp: Utc::now(),
        }
    }

    pub fn entry_count(&self) -> usize {
        self.versions.len()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncrementalSyncRequest {
    pub version_vector: SyncVersionVector,
    pub want_full_tree: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncrementalSyncResponse {
    pub version_vector: SyncVersionVector,
    pub diff: SyncDiff,
    pub remote_entries: Vec<ConfigEntry>,
    pub is_incremental: bool,
    pub bandwidth_saved_bytes: usize,
}

pub struct SyncProtocol {
    key_prefix: Option<String>,
}

impl SyncProtocol {
    pub fn new() -> Self {
        Self { key_prefix: None }
    }

    pub fn with_prefix(prefix: String) -> Self {
        Self {
            key_prefix: Some(prefix),
        }
    }

    fn matches_prefix(&self, key: &str) -> bool {
        match &self.key_prefix {
            Some(prefix) => key.starts_with(prefix),
            None => true,
        }
    }

    pub fn build_tree(&self, entries: HashMap<String, ConfigEntry>) -> MerkleTree {
        let filtered: HashMap<String, ConfigEntry> = entries
            .into_iter()
            .filter(|(k, _)| self.matches_prefix(k))
            .collect();

        let mut tree = MerkleTree {
            root: None,
            entries: filtered,
        };
        tree.rebuild();
        tree
    }

    pub fn build_tree_from_vec(&self, entries: Vec<ConfigEntry>) -> MerkleTree {
        let filtered: HashMap<String, ConfigEntry> = entries
            .into_iter()
            .filter(|e| self.matches_prefix(&e.key))
            .map(|e| (e.key.clone(), e))
            .collect();

        self.build_tree(filtered)
    }

    pub fn compare_trees(
        &self,
        local: &MerkleTree,
        remote_root_hash: [u8; 32],
    ) -> Vec<DiffPath> {
        let local_root = match &local.root {
            Some(r) => r,
            None => return vec![],
        };

        if local_root.hash == remote_root_hash {
            return vec![];
        }

        let mut paths = vec![];
        Self::find_diff_paths(local_root, remote_root_hash, &mut vec![], &mut paths);
        paths
    }

    fn find_diff_paths(
        node: &MerkleNode,
        remote_hash: [u8; 32],
        current_path: &mut Vec<String>,
        paths: &mut Vec<DiffPath>,
    ) {
        if node.hash == remote_hash {
            return;
        }

        if node.is_leaf() {
            if let Some(entry) = &node.leaf_data {
                paths.push(DiffPath {
                    path: current_path.clone(),
                    key: entry.key.clone(),
                    diff_type: DiffType::Updated,
                });
            }
            return;
        }

        for child in &node.children {
            current_path.push(child.key_range.0.clone());
            Self::find_diff_paths(child, remote_hash, current_path, paths);
            current_path.pop();
        }
    }

    pub fn compute_diff(&self, local_tree: &MerkleTree, remote_tree: &MerkleTree) -> SyncDiff {
        let mut diff = SyncDiff::new();

        let divergent_keys = local_tree.find_divergent_keys(remote_tree);

        for key in divergent_keys {
            let local_entry = local_tree.get_entry(&key);
            let remote_entry = remote_tree.get_entry(&key);

            match (local_entry, remote_entry) {
                (Some(_), None) => {
                    diff.deleted.push(key);
                }
                (None, Some(remote)) => {
                    diff.added.push(remote.clone());
                }
                (Some(local), Some(remote)) => {
                    if local.version != remote.version || local.hash_hex() != remote.hash_hex() {
                        let resolved = self.resolve_conflict(local.clone(), remote.clone());
                        diff.updated.push(resolved);
                    }
                }
            }
        }

        diff
    }

    pub fn apply_diff(&self, tree: &mut MerkleTree, diff: &SyncDiff) -> SyncResult {
        let start = Instant::now();
        let mut entries_applied = 0usize;
        let mut conflicts_resolved = 0usize;

        for entry in &diff.added {
            if self.matches_prefix(&entry.key) {
                tree.insert_entry(entry.clone());
                entries_applied += 1;
            }
        }

        for entry in &diff.updated {
            if self.matches_prefix(&entry.key) {
                if let Some(existing) = tree.get_entry(&entry.key) {
                    if existing.timestamp != entry.timestamp {
                        conflicts_resolved += 1;
                    }
                }
                tree.insert_entry(entry.clone());
                entries_applied += 1;
            }
        }

        for key in &diff.deleted {
            if self.matches_prefix(key) {
                tree.entries.remove(key);
                entries_applied += 1;
            }
        }

        tree.rebuild();

        SyncResult {
            entries_applied,
            conflicts_resolved,
            sync_duration_ms: start.elapsed().as_millis() as u64,
        }
    }

    pub fn resolve_conflict(&self, local: ConfigEntry, remote: ConfigEntry) -> ConfigEntry {
        if remote.timestamp > local.timestamp {
            log::info!(
                "Conflict on key '{}': remote wins (remote={}, local={})",
                local.key,
                remote.timestamp,
                local.timestamp
            );
            remote
        } else {
            log::info!(
                "Conflict on key '{}': local wins (local={}, remote={})",
                local.key,
                local.timestamp,
                remote.timestamp
            );
            local
        }
    }

    pub fn sync_with_peer(
        &self,
        local_entries: HashMap<String, ConfigEntry>,
        remote_entries: HashMap<String, ConfigEntry>,
    ) -> SyncResult {
        let local_tree = self.build_tree(local_entries);
        let remote_tree = self.build_tree(remote_entries);

        let local_root_hash = match local_tree.root_hash() {
            Some(h) => h,
            None => {
                let diff = self.compute_diff(&local_tree, &remote_tree);
                let mut result_tree = local_tree;
                return self.apply_diff(&mut result_tree, &diff);
            }
        };

        let remote_root_hash = match remote_tree.root_hash() {
            Some(h) => h,
            None => {
                let diff = self.compute_diff(&local_tree, &remote_tree);
                let mut result_tree = local_tree;
                return self.apply_diff(&mut result_tree, &diff);
            }
        };

        if local_root_hash == remote_root_hash {
            log::info!("Root hashes match, no sync needed");
            return SyncResult {
                entries_applied: 0,
                conflicts_resolved: 0,
                sync_duration_ms: 0,
            };
        }

        log::info!(
            "Root hashes differ (local={}, remote={}), computing diff",
            hex::encode(local_root_hash),
            hex::encode(remote_root_hash)
        );

        let diff = self.compute_diff(&local_tree, &remote_tree);
        let mut result_tree = local_tree;
        self.apply_diff(&mut result_tree, &diff)
    }

    pub fn build_version_vector(&self, entries: &HashMap<String, ConfigEntry>) -> SyncVersionVector {
        let tree = self.build_tree(entries.clone());
        SyncVersionVector::from_tree(&tree)
    }

    pub fn compute_incremental_diff(
        &self,
        local_entries: &HashMap<String, ConfigEntry>,
        remote_version_vector: &SyncVersionVector,
    ) -> SyncDiff {
        let mut diff = SyncDiff::new();

        for (key, remote_version) in &remote_version_vector.versions {
            if !self.matches_prefix(key) {
                continue;
            }
            match local_entries.get(key) {
                Some(local_entry) => {
                    if local_entry.version < *remote_version {
                        diff.updated.push(local_entry.clone());
                    }
                }
                None => {
                    diff.deleted.push(key.clone());
                }
            }
        }

        for (key, local_entry) in local_entries {
            if !self.matches_prefix(key) {
                continue;
            }
            if !remote_version_vector.versions.contains_key(key) {
                diff.added.push(local_entry.clone());
            }
        }

        diff
    }

    pub fn prepare_incremental_response(
        &self,
        local_entries: &HashMap<String, ConfigEntry>,
        request: &IncrementalSyncRequest,
    ) -> IncrementalSyncResponse {
        let local_tree = self.build_tree(local_entries.clone());
        let local_vv = SyncVersionVector::from_tree(&local_tree);

        if request.want_full_tree {
            let remote_tree = self.build_tree(request.version_vector.versions.keys().cloned()
                .filter(|k| self.matches_prefix(k))
                .map(|k| (k, ConfigEntry::new("".to_string(), vec![], 0, Utc::now())))
                .collect());
            let diff = self.compute_diff(&local_tree, &remote_tree);

            let remote_entries: Vec<ConfigEntry> = diff.added.iter()
                .chain(diff.updated.iter())
                .cloned()
                .collect();

            let full_size: usize = local_entries.values()
                .filter(|e| self.matches_prefix(&e.key))
                .map(|e| e.key.len() + e.value.len() + 16)
                .sum();
            let diff_size: usize = remote_entries.iter()
                .map(|e| e.key.len() + e.value.len() + 16)
                .sum();

            return IncrementalSyncResponse {
                version_vector: local_vv,
                diff,
                remote_entries,
                is_incremental: false,
                bandwidth_saved_bytes: full_size.saturating_sub(diff_size),
            };
        }

        let diff = self.compute_incremental_diff(local_entries, &request.version_vector);
        let remote_entries: Vec<ConfigEntry> = diff.added.iter()
            .chain(diff.updated.iter())
            .cloned()
            .collect();

        let full_size: usize = local_entries.values()
            .filter(|e| self.matches_prefix(&e.key))
            .map(|e| e.key.len() + e.value.len() + 16)
            .sum();
        let diff_size: usize = remote_entries.iter()
            .map(|e| e.key.len() + e.value.len() + 16)
            .sum();

        IncrementalSyncResponse {
            version_vector: local_vv,
            diff,
            remote_entries,
            is_incremental: true,
            bandwidth_saved_bytes: full_size.saturating_sub(diff_size),
        }
    }

    pub fn apply_incremental_sync(
        &self,
        local_entries: &mut HashMap<String, ConfigEntry>,
        response: &IncrementalSyncResponse,
    ) -> SyncResult {
        let mut tree = self.build_tree(local_entries.clone());
        let result = self.apply_diff(&mut tree, &response.diff);

        for entry in &response.diff.added {
            local_entries.insert(entry.key.clone(), entry.clone());
        }
        for entry in &response.diff.updated {
            local_entries.insert(entry.key.clone(), entry.clone());
        }
        for key in &response.diff.deleted {
            local_entries.remove(key);
        }

        result
    }

    pub fn incremental_sync_with_peer(
        &self,
        local_entries: &mut HashMap<String, ConfigEntry>,
        remote_vv: &SyncVersionVector,
        remote_diff_entries: &[ConfigEntry],
        remote_deleted: &[String],
    ) -> SyncResult {
        let mut diff = SyncDiff::new();

        for (key, remote_version) in &remote_vv.versions {
            if !self.matches_prefix(key) {
                continue;
            }
            match local_entries.get(key) {
                Some(local_entry) => {
                    if local_entry.version < *remote_version {
                        if let Some(remote_entry) = remote_diff_entries.iter().find(|e| &e.key == key) {
                            diff.updated.push(remote_entry.clone());
                        }
                    }
                }
                None => {
                    if let Some(remote_entry) = remote_diff_entries.iter().find(|e| &e.key == key) {
                        diff.added.push(remote_entry.clone());
                    }
                }
            }
        }

        for key in remote_deleted {
            if self.matches_prefix(key) && local_entries.contains_key(key) {
                diff.deleted.push(key.clone());
            }
        }

        let mut tree = self.build_tree(local_entries.clone());
        let result = self.apply_diff(&mut tree, &diff);

        for entry in &diff.added {
            local_entries.insert(entry.key.clone(), entry.clone());
        }
        for entry in &diff.updated {
            local_entries.insert(entry.key.clone(), entry.clone());
        }
        for key in &diff.deleted {
            local_entries.remove(key);
        }

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_entry(key: &str, value: &[u8], version: u64, secs: i64) -> ConfigEntry {
        ConfigEntry::new(
            key.to_string(),
            value.to_vec(),
            version,
            Utc.timestamp_opt(secs, 0).unwrap(),
        )
    }

    #[test]
    fn test_config_entry_hash_deterministic() {
        let entry = make_entry("key1", b"val1", 1, 1000);
        let h1 = entry.compute_hash();
        let h2 = entry.compute_hash();
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_config_entry_hash_differs_on_value_change() {
        let e1 = make_entry("key1", b"val1", 1, 1000);
        let e2 = make_entry("key1", b"val2", 1, 1000);
        assert_ne!(e1.compute_hash(), e2.compute_hash());
    }

    #[test]
    fn test_build_tree_empty() {
        let proto = SyncProtocol::new();
        let tree = proto.build_tree(HashMap::new());
        assert!(tree.root.is_none());
    }

    #[test]
    fn test_build_tree_single_entry() {
        let proto = SyncProtocol::new();
        let mut entries = HashMap::new();
        entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));
        let tree = proto.build_tree(entries);
        assert!(tree.root.is_some());
        assert!(tree.root.as_ref().unwrap().is_leaf());
    }

    #[test]
    fn test_build_tree_multiple_entries() {
        let proto = SyncProtocol::new();
        let mut entries = HashMap::new();
        entries.insert("a".to_string(), make_entry("a", b"va", 1, 1000));
        entries.insert("b".to_string(), make_entry("b", b"vb", 1, 1000));
        entries.insert("c".to_string(), make_entry("c", b"vc", 1, 1000));
        let tree = proto.build_tree(entries);
        assert!(tree.root.is_some());
        assert!(!tree.root.as_ref().unwrap().is_leaf());
    }

    #[test]
    fn test_identical_trees_no_diff() {
        let proto = SyncProtocol::new();
        let mut entries = HashMap::new();
        entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));
        entries.insert("k2".to_string(), make_entry("k2", b"v2", 1, 2000));

        let tree1 = proto.build_tree(entries.clone());
        let tree2 = proto.build_tree(entries);
        let diff = proto.compute_diff(&tree1, &tree2);
        assert!(diff.is_empty());
    }

    #[test]
    fn test_added_entry_diff() {
        let proto = SyncProtocol::new();
        let mut local_entries = HashMap::new();
        local_entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));

        let mut remote_entries = HashMap::new();
        remote_entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));
        remote_entries.insert("k2".to_string(), make_entry("k2", b"v2", 1, 2000));

        let local_tree = proto.build_tree(local_entries);
        let remote_tree = proto.build_tree(remote_entries);
        let diff = proto.compute_diff(&local_tree, &remote_tree);

        assert_eq!(diff.added.len(), 1);
        assert_eq!(diff.added[0].key, "k2");
    }

    #[test]
    fn test_deleted_entry_diff() {
        let proto = SyncProtocol::new();
        let mut local_entries = HashMap::new();
        local_entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));
        local_entries.insert("k2".to_string(), make_entry("k2", b"v2", 1, 2000));

        let mut remote_entries = HashMap::new();
        remote_entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));

        let local_tree = proto.build_tree(local_entries);
        let remote_tree = proto.build_tree(remote_entries);
        let diff = proto.compute_diff(&local_tree, &remote_tree);

        assert_eq!(diff.deleted.len(), 1);
        assert_eq!(diff.deleted[0], "k2");
    }

    #[test]
    fn test_conflict_resolution_last_write_wins() {
        let proto = SyncProtocol::new();
        let local = make_entry("k1", b"old", 1, 1000);
        let remote = make_entry("k1", b"new", 2, 2000);
        let resolved = proto.resolve_conflict(local, remote);
        assert_eq!(resolved.value, b"new");
        assert_eq!(resolved.version, 2);
    }

    #[test]
    fn test_sync_with_peer() {
        let proto = SyncProtocol::new();

        let mut local_entries = HashMap::new();
        local_entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));

        let mut remote_entries = HashMap::new();
        remote_entries.insert("k1".to_string(), make_entry("k1", b"v1", 1, 1000));
        remote_entries.insert("k2".to_string(), make_entry("k2", b"v2", 1, 2000));

        let result = proto.sync_with_peer(local_entries, remote_entries);
        assert_eq!(result.entries_applied, 1);
    }

    #[test]
    fn test_sync_with_prefix_filter() {
        let proto = SyncProtocol::with_prefix("app/".to_string());

        let mut local_entries = HashMap::new();
        local_entries.insert("app/k1".to_string(), make_entry("app/k1", b"v1", 1, 1000));
        local_entries.insert("sys/k1".to_string(), make_entry("sys/k1", b"v1", 1, 1000));

        let mut remote_entries = HashMap::new();
        remote_entries.insert("app/k1".to_string(), make_entry("app/k1", b"v1", 1, 1000));
        remote_entries.insert("app/k2".to_string(), make_entry("app/k2", b"v2", 1, 2000));
        remote_entries.insert("sys/k2".to_string(), make_entry("sys/k2", b"v2", 1, 2000));

        let local_tree = proto.build_tree(local_entries);
        let remote_tree = proto.build_tree(remote_entries);

        assert!(!local_tree.entries.contains_key("sys/k1"));
        assert!(!remote_tree.entries.contains_key("sys/k2"));
    }

    #[test]
    fn test_merkle_tree_rebuild_preserves_entries() {
        let proto = SyncProtocol::new();
        let mut entries = HashMap::new();
        entries.insert("a".to_string(), make_entry("a", b"va", 1, 1000));
        entries.insert("b".to_string(), make_entry("b", b"vb", 1, 2000));

        let tree = proto.build_tree(entries);
        assert_eq!(tree.entries.len(), 2);
        assert!(tree.get_entry("a").is_some());
        assert!(tree.get_entry("b").is_some());
    }
}
