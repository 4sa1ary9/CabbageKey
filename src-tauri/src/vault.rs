//! Vault data model + persistence (D3, T4/T5/T6).
//!
//! The decrypted vault is a single JSON document held fully in memory. On
//! save we re-encrypt the whole thing and write atomically (temp file +
//! rename) so a crash mid-write can't corrupt the live file. Cloud sync
//! (坚果云/Dropbox) only ever sees one self-contained encrypted blob.
//!
//! Record schema (design D3 + office-hours premise 2):
//!   - id:    internal uuid, the real primary key (用途名称 may repeat)
//!   - name:  用途名称  REQUIRED
//!   - api_key:         REQUIRED
//!   - vendor / url / note / tags: all OPTIONAL
//!
//! Conflict detection (D4): VaultFile remembers the sha256 of the bytes it
//! loaded. Before overwriting, the caller re-reads the file on disk and
//! compares — if another device changed it during this edit session, we warn
//! instead of silently clobbering their change.

use serde::{Deserialize, Serialize};
use std::path::Path;

pub const VAULT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("用途名称不能为空")]
    MissingName,
    #[error("api_key 不能为空")]
    MissingApiKey,
    #[error("找不到记录: {0}")]
    NotFound(String),
    #[error("vault JSON 解析失败: {0}")]
    BadJson(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub id: String,
    pub name: String,
    pub api_key: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Vault {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub records: Vec<Record>,
}

fn default_schema_version() -> u32 {
    VAULT_SCHEMA_VERSION
}

/// Input for create/update. Validation lives here so both paths share it.
#[derive(Debug, Clone, Deserialize)]
pub struct RecordInput {
    pub name: String,
    pub api_key: String,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn validate(input: &RecordInput) -> Result<(), VaultError> {
    if input.name.trim().is_empty() {
        return Err(VaultError::MissingName);
    }
    if input.api_key.trim().is_empty() {
        return Err(VaultError::MissingApiKey);
    }
    Ok(())
}

impl Vault {
    pub fn new() -> Self {
        Vault {
            schema_version: VAULT_SCHEMA_VERSION,
            records: Vec::new(),
        }
    }

    pub fn from_json(bytes: &[u8]) -> Result<Self, VaultError> {
        serde_json::from_slice(bytes).map_err(|e| VaultError::BadJson(e.to_string()))
    }

    pub fn to_json(&self) -> Vec<u8> {
        // pretty so the decrypted export is human-readable (D6 plaintext export)
        serde_json::to_vec_pretty(self).expect("vault serializes")
    }

    /// Add a record (T5). Validates required fields, assigns a fresh uuid.
    /// Duplicate 用途名称 is allowed — id keeps them distinct.
    pub fn add(&mut self, input: RecordInput, now: String) -> Result<String, VaultError> {
        validate(&input)?;
        let id = uuid::Uuid::new_v4().to_string();
        self.records.push(Record {
            id: id.clone(),
            name: input.name.trim().to_string(),
            api_key: input.api_key,
            vendor: input.vendor.trim().to_string(),
            url: input.url.trim().to_string(),
            note: input.note,
            tags: normalize_tags(input.tags),
            created_at: now.clone(),
            updated_at: now,
        });
        Ok(id)
    }

    /// Update by id (T5) — touches only the matching record.
    pub fn update(&mut self, id: &str, input: RecordInput, now: String) -> Result<(), VaultError> {
        validate(&input)?;
        let rec = self
            .records
            .iter_mut()
            .find(|r| r.id == id)
            .ok_or_else(|| VaultError::NotFound(id.to_string()))?;
        rec.name = input.name.trim().to_string();
        rec.api_key = input.api_key;
        rec.vendor = input.vendor.trim().to_string();
        rec.url = input.url.trim().to_string();
        rec.note = input.note;
        rec.tags = normalize_tags(input.tags);
        rec.updated_at = now;
        Ok(())
    }

    /// Delete by id (T5) — removes only the matching record.
    pub fn delete(&mut self, id: &str) -> Result<(), VaultError> {
        let before = self.records.len();
        self.records.retain(|r| r.id != id);
        if self.records.len() == before {
            return Err(VaultError::NotFound(id.to_string()));
        }
        Ok(())
    }

    /// All distinct vendors (non-empty), sorted — drives the left-rail groups.
    pub fn vendors(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .records
            .iter()
            .map(|r| r.vendor.clone())
            .filter(|s| !s.is_empty())
            .collect();
        v.sort();
        v.dedup();
        v
    }

    /// All distinct tags, sorted — drives the tag filter.
    pub fn tags(&self) -> Vec<String> {
        let mut t: Vec<String> = self.records.iter().flat_map(|r| r.tags.clone()).collect();
        t.sort();
        t.dedup();
        t
    }
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// sha256 of arbitrary bytes (used for conflict detection, D4).
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex_encode(&h.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Atomic write: write to `<path>.tmp` then rename over the target. Rename is
/// atomic on the same filesystem, so a crash leaves either the old file or the
/// new file — never a half-written one (T4).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Make a `<path>.bak` copy of the current file before overwriting (D6 backup).
pub fn backup_existing(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        let bak = path.with_extension("bak");
        std::fs::copy(path, bak)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, key: &str) -> RecordInput {
        RecordInput {
            name: name.into(),
            api_key: key.into(),
            vendor: String::new(),
            url: String::new(),
            note: String::new(),
            tags: vec![],
        }
    }

    #[test]
    fn add_with_required_fields_persists() {
        let mut v = Vault::new();
        let id = v.add(input("翻译用", "sk-123"), "t0".into()).unwrap();
        assert_eq!(v.records.len(), 1);
        assert_eq!(v.records[0].id, id);
        assert_eq!(v.records[0].name, "翻译用");
    }

    #[test]
    fn add_missing_name_rejected() {
        let mut v = Vault::new();
        assert!(matches!(
            v.add(input("  ", "sk-1"), "t0".into()).unwrap_err(),
            VaultError::MissingName
        ));
    }

    #[test]
    fn add_missing_key_rejected() {
        let mut v = Vault::new();
        assert!(matches!(
            v.add(input("name", ""), "t0".into()).unwrap_err(),
            VaultError::MissingApiKey
        ));
    }

    #[test]
    fn optional_fields_allowed_empty() {
        let mut v = Vault::new();
        v.add(input("n", "k"), "t0".into()).unwrap();
        assert_eq!(v.records[0].vendor, "");
        assert_eq!(v.records[0].url, "");
        assert!(v.records[0].tags.is_empty());
    }

    #[test]
    fn duplicate_names_kept_distinct_by_id() {
        let mut v = Vault::new();
        let a = v.add(input("翻译", "k1"), "t0".into()).unwrap();
        let b = v.add(input("翻译", "k2"), "t0".into()).unwrap();
        assert_ne!(a, b);
        assert_eq!(v.records.len(), 2);
    }

    #[test]
    fn update_touches_only_target() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        let mut up = input("a-renamed", "k1-new");
        v.update(&a, up.clone(), "t1".into()).unwrap();
        let ra = v.records.iter().find(|r| r.id == a).unwrap();
        let rb = v.records.iter().find(|r| r.id == b).unwrap();
        assert_eq!(ra.name, "a-renamed");
        assert_eq!(rb.name, "b"); // untouched
        up.name = "ignored".into();
    }

    #[test]
    fn update_missing_id_errors() {
        let mut v = Vault::new();
        assert!(matches!(
            v.update("nope", input("n", "k"), "t0".into()).unwrap_err(),
            VaultError::NotFound(_)
        ));
    }

    #[test]
    fn delete_removes_only_target() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        v.delete(&a).unwrap();
        assert_eq!(v.records.len(), 1);
        assert_eq!(v.records[0].id, b);
    }

    #[test]
    fn delete_missing_id_errors() {
        let mut v = Vault::new();
        assert!(matches!(
            v.delete("nope").unwrap_err(),
            VaultError::NotFound(_)
        ));
    }

    #[test]
    fn vendors_and_tags_deduped_sorted() {
        let mut v = Vault::new();
        let mut i = input("a", "k");
        i.vendor = "OpenAI".into();
        i.tags = vec!["翻译".into(), "项目A".into()];
        v.add(i, "t0".into()).unwrap();
        let mut j = input("b", "k");
        j.vendor = "OpenAI".into();
        j.tags = vec!["翻译".into()];
        v.add(j, "t0".into()).unwrap();
        assert_eq!(v.vendors(), vec!["OpenAI"]);
        assert_eq!(v.tags(), vec!["翻译", "项目A"]);
    }

    #[test]
    fn json_roundtrip() {
        let mut v = Vault::new();
        v.add(input("n", "k"), "t0".into()).unwrap();
        let bytes = v.to_json();
        let back = Vault::from_json(&bytes).unwrap();
        assert_eq!(back.records, v.records);
    }

    #[test]
    fn sha256_changes_with_content() {
        assert_ne!(sha256_hex(b"a"), sha256_hex(b"b"));
        assert_eq!(sha256_hex(b"a"), sha256_hex(b"a"));
    }
}
