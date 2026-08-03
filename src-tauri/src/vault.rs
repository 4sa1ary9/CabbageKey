//! Vault data model + persistence.
//!
//! The vault is a single plaintext JSON document held fully in memory. On
//! save we write the whole thing atomically (temp file + rename) so a crash
//! mid-write can't corrupt the live file.
//!
//! Record schema (design D3 + office-hours premise 2):
//!   - id:    internal uuid, the real primary key (用途名称 may repeat)
//!   - name:  用途名称  REQUIRED
//!   - api_key:         REQUIRED
//!   - vendor / url / note / tags: all OPTIONAL
//!
//! Disk format is frozen by the golden test (see `golden_plaintext_format_is_frozen`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

pub const VAULT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("用途名称不能为空")]
    MissingName,
    #[error("api_key 不能为空")]
    MissingApiKey,
    #[error("接口规范值无效: {0}")]
    InvalidApiStandard(String),
    #[error("官网 URL 超出 2048 字符限制")]
    WebsiteTooLong,
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
    /// Map of api_standard key → endpoint URL. BTreeMap so serialized key order
    /// is deterministic (the golden test freezes the exact bytes).
    #[serde(default)]
    pub endpoints: BTreeMap<String, String>,
    #[serde(default)]
    pub website: String,
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

/// One entry in the recent-vault history list (shown on the chooser page).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct VaultHistoryEntry {
    pub path: String,
    /// Display name (filename without directory) for quick recognition.
    pub display_name: String,
}

/// Add or promote a vault path to the front of the history list.
/// Deduplicates by path, caps at 10 entries, newest first.
pub fn add_vault_history_entry(history: &mut Vec<VaultHistoryEntry>, path: &str) {
    // Remove existing entry with the same path (dedup).
    history.retain(|e| e.path != path);
    // Derive display name from the path (filename only).
    let display_name = std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    // Insert at front (newest first).
    history.insert(0, VaultHistoryEntry { path: path.to_string(), display_name });
    // Cap at 10.
    history.truncate(10);
}

/// Input for create/update. Validation lives here so both paths share it.
#[derive(Debug, Clone, Deserialize)]
pub struct RecordInput {
    pub name: String,
    pub api_key: String,
    #[serde(default)]
    pub vendor: String,
    /// Map of api_standard key → endpoint URL.
    #[serde(default)]
    pub endpoints: BTreeMap<String, String>,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

const VALID_STANDARDS: &[&str] = &["openai-chat", "openai-responses", "anthropic", "gemini"];

fn validate(input: &RecordInput) -> Result<(), VaultError> {
    if input.name.trim().is_empty() {
        return Err(VaultError::MissingName);
    }
    if input.api_key.trim().is_empty() {
        return Err(VaultError::MissingApiKey);
    }
    for key in input.endpoints.keys() {
        if !VALID_STANDARDS.contains(&key.as_str()) {
            return Err(VaultError::InvalidApiStandard(key.clone()));
        }
    }
    if input.website.len() > 2048 {
        return Err(VaultError::WebsiteTooLong);
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
        // pretty so the on-disk vault is human-readable
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
            endpoints: input.endpoints,
            website: input.website,
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
        rec.endpoints = input.endpoints;
        rec.website = input.website;
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

/// Atomic write: write to `<path>.tmp` then rename over the target. Rename is
/// atomic on the same filesystem, so a crash leaves either the old file or the
/// new file — never a half-written one.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn input(name: &str, key: &str) -> RecordInput {
        RecordInput {
            name: name.into(),
            api_key: key.into(),
            vendor: String::new(),
            endpoints: BTreeMap::new(),
            website: String::new(),
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
        assert!(v.records[0].endpoints.is_empty());
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

    /// 明文格式 golden test：冻结磁盘 JSON 形状（schema_version 1）。
    /// 双向断言：字面量可解析且字段正确；构造同内容 vault 序列化后与字面量
    /// 逐字节一致。任何对磁盘格式的意外改动（字段名/顺序/缩进/端点排序）都会红。
    #[test]
    fn golden_plaintext_format_is_frozen() {
        let literal = r#"{
  "schema_version": 1,
  "records": [
    {
      "id": "9f6e1f2a-0000-4000-8000-000000000001",
      "name": "翻译用",
      "api_key": "sk-abcdef1234567890",
      "vendor": "OpenAI",
      "endpoints": {
        "openai-chat": "https://api.openai.com/v1/chat/completions",
        "openai-responses": "https://api.openai.com/v1/responses"
      },
      "website": "https://platform.openai.com",
      "note": "额度到 2026-12-31",
      "tags": [
        "翻译",
        "项目A"
      ],
      "created_at": "2026-08-01T10:00:00Z",
      "updated_at": "2026-08-02T09:30:00Z"
    }
  ]
}"#
        .as_bytes();

        // 方向一：字面量 → from_json，解析并断言每个字段。
        let v = Vault::from_json(literal).unwrap();
        assert_eq!(v.schema_version, 1);
        assert_eq!(v.records.len(), 1);
        let r = &v.records[0];
        assert_eq!(r.id, "9f6e1f2a-0000-4000-8000-000000000001");
        assert_eq!(r.name, "翻译用");
        assert_eq!(r.api_key, "sk-abcdef1234567890");
        assert_eq!(r.vendor, "OpenAI");
        assert_eq!(
            r.endpoints.get("openai-chat").map(String::as_str),
            Some("https://api.openai.com/v1/chat/completions")
        );
        assert_eq!(
            r.endpoints.get("openai-responses").map(String::as_str),
            Some("https://api.openai.com/v1/responses")
        );
        assert_eq!(r.website, "https://platform.openai.com");
        assert_eq!(r.note, "额度到 2026-12-31");
        assert_eq!(r.tags, vec!["翻译", "项目A"]);
        assert_eq!(r.created_at, "2026-08-01T10:00:00Z");
        assert_eq!(r.updated_at, "2026-08-02T09:30:00Z");

        // 方向二：构造同内容 vault → to_json，与字面量逐字节一致。
        let mut endpoints = BTreeMap::new();
        endpoints.insert(
            "openai-chat".to_string(),
            "https://api.openai.com/v1/chat/completions".to_string(),
        );
        endpoints.insert(
            "openai-responses".to_string(),
            "https://api.openai.com/v1/responses".to_string(),
        );
        let built = Vault {
            schema_version: 1,
            records: vec![Record {
                id: "9f6e1f2a-0000-4000-8000-000000000001".into(),
                name: "翻译用".into(),
                api_key: "sk-abcdef1234567890".into(),
                vendor: "OpenAI".into(),
                endpoints,
                website: "https://platform.openai.com".into(),
                note: "额度到 2026-12-31".into(),
                tags: vec!["翻译".into(), "项目A".into()],
                created_at: "2026-08-01T10:00:00Z".into(),
                updated_at: "2026-08-02T09:30:00Z".into(),
            }],
        };
        assert_eq!(built.to_json(), literal);

        // 空库同样冻结。
        assert_eq!(
            Vault::new().to_json(),
            r#"{
  "schema_version": 1,
  "records": []
}"#
            .as_bytes()
        );
    }

    #[test]
    fn history_newest_first_and_dedup_by_path() {
        let mut h = Vec::new();
        add_vault_history_entry(&mut h, "C:\\a\\one.json");
        add_vault_history_entry(&mut h, "C:\\b\\two.json");
        // Reopen one.json — must move to front, not duplicate.
        add_vault_history_entry(&mut h, "C:\\a\\one.json");
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].path, "C:\\a\\one.json");
        assert_eq!(h[1].path, "C:\\b\\two.json");
    }

    #[test]
    fn history_capped_at_ten_newest_first() {
        let mut h = Vec::new();
        for i in 0..12 {
            add_vault_history_entry(&mut h, &format!("C:\\dir\\vault-{i:02}.json"));
        }
        assert_eq!(h.len(), 10);
        assert_eq!(h[0].path, "C:\\dir\\vault-11.json");
        assert_eq!(h[9].path, "C:\\dir\\vault-02.json");
    }

    #[test]
    fn history_display_name_is_filename_or_path_fallback() {
        let mut h = Vec::new();
        add_vault_history_entry(&mut h, "C:\\my stuff\\keys.json");
        add_vault_history_entry(&mut h, "C:\\");
        // Newest first: the root path is at the front.
        assert_eq!(h[0].display_name, "C:\\");
        assert_eq!(h[1].display_name, "keys.json");
    }
}
