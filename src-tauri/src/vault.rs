//! Vault data model + persistence.
//!
//! The vault is a single plaintext JSON document held fully in memory. On
//! save we write the whole thing atomically (temp file + rename) so a crash
//! mid-write can't corrupt the live file.
//!
//! Record schema (design D3 + office-hours premise 2):
//!   - id:    internal uuid, the real primary key (用途名称 may repeat)
//!   - order: display order in the record list; old vaults lack it and get
//!            their file position as fallback on load (see `normalize_orders`)
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
    #[error("重排 id 列表无效: 必须恰好包含全部记录 id 且无重复")]
    InvalidOrderList,
    #[error("vault JSON 解析失败: {0}")]
    BadJson(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Record {
    pub id: String,
    /// Display order in the record list, ascending. Old vaults have no such
    /// field — `from_json` fills the gap with the record's file position.
    #[serde(default)]
    pub order: Option<u32>,
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
    /// Custom display order for the vendor rail. Vendors not listed here
    /// (newly used ones, old vaults) sort lexicographically after listed ones.
    /// Omitted from disk while empty so untouched vaults keep their format.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vendor_order: Vec<String>,
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
    // 字符数而非字节数：与前端 maxlength（按字符）同一单位，多字节 URL 不被误拒。
    if input.website.chars().count() > 2048 {
        return Err(VaultError::WebsiteTooLong);
    }
    Ok(())
}

impl Vault {
    pub fn new() -> Self {
        Vault {
            schema_version: VAULT_SCHEMA_VERSION,
            records: Vec::new(),
            vendor_order: Vec::new(),
        }
    }

    pub fn from_json(bytes: &[u8]) -> Result<Self, VaultError> {
        let mut v: Vault =
            serde_json::from_slice(bytes).map_err(|e| VaultError::BadJson(e.to_string()))?;
        v.normalize_orders();
        Ok(v)
    }

    pub fn to_json(&self) -> Vec<u8> {
        // pretty so the on-disk vault is human-readable
        serde_json::to_vec_pretty(self).expect("vault serializes")
    }

    /// Add a record (T5). Validates required fields, assigns a fresh uuid.
    /// Duplicate 用途名称 is allowed — id keeps them distinct.
    /// The new record is appended last (order = current max + 1).
    pub fn add(&mut self, input: RecordInput, now: String) -> Result<String, VaultError> {
        validate(&input)?;
        let id = uuid::Uuid::new_v4().to_string();
        let order = self
            .records
            .iter()
            .filter_map(|r| r.order)
            .max()
            .map_or(0, |m| m + 1);
        self.records.push(Record {
            id: id.clone(),
            order: Some(order),
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

    /// Apply a new global order: `ids` must be a permutation of all record ids.
    /// On any invalid id (unknown, missing, duplicate) the vault is left
    /// untouched — the caller must not persist in that case.
    pub fn reorder(&mut self, ids: &[String]) -> Result<(), VaultError> {
        let mut incoming: Vec<&str> = ids.iter().map(String::as_str).collect();
        let mut existing: Vec<&str> = self.records.iter().map(|r| r.id.as_str()).collect();
        incoming.sort_unstable();
        existing.sort_unstable();
        if incoming != existing {
            return Err(VaultError::InvalidOrderList);
        }
        let index_of: BTreeMap<&str, u32> = ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i as u32))
            .collect();
        for r in &mut self.records {
            r.order = index_of.get(r.id.as_str()).copied();
        }
        self.records.sort_by_key(|r| r.order);
        Ok(())
    }

    /// Old vaults (and hand-edited files) may lack `order` fields — fill each
    /// missing slot with the record's file position, keeping explicit values
    /// intact so reading never destroys data that's already there.
    fn normalize_orders(&mut self) {
        for (i, r) in self.records.iter_mut().enumerate() {
            if r.order.is_none() {
                r.order = Some(i as u32);
            }
        }
    }

    /// Apply a new vendor order: `vendors` must be a permutation of the
    /// current distinct vendor set. On any invalid list the vault is left
    /// untouched — the caller must not persist in that case.
    pub fn reorder_vendors(&mut self, vendors: &[String]) -> Result<(), VaultError> {
        let mut incoming: Vec<&str> = vendors.iter().map(String::as_str).collect();
        let current = self.vendors();
        let mut existing: Vec<&str> = current.iter().map(String::as_str).collect();
        incoming.sort_unstable();
        existing.sort_unstable();
        if incoming != existing {
            return Err(VaultError::InvalidOrderList);
        }
        self.vendor_order = vendors.to_vec();
        Ok(())
    }

    /// All distinct vendors (non-empty) in display order — custom `vendor_order`
    /// first, then any others lexicographically. Drives the left-rail groups.
    pub fn vendors(&self) -> Vec<String> {
        let mut distinct: Vec<String> = self
            .records
            .iter()
            .map(|r| r.vendor.clone())
            .filter(|s| !s.is_empty())
            .collect();
        distinct.sort();
        distinct.dedup();
        let mut out: Vec<String> = Vec::with_capacity(distinct.len());
        for v in &self.vendor_order {
            if distinct.contains(v) && !out.contains(v) {
                out.push(v.clone());
            }
        }
        for v in &distinct {
            if !out.contains(v) {
                out.push(v.clone());
            }
        }
        out
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
    fn website_limit_counts_chars_not_bytes() {
        let mut v = Vault::new();
        let mut ok = input("n", "k");
        ok.website = "例".repeat(2048); // 2048 字符 = 6144 字节，应通过
        v.add(ok, "t0".into()).unwrap();

        let mut bad = input("n", "k");
        bad.website = "例".repeat(2049); // 多一个字符即拒绝
        assert!(matches!(
            v.add(bad, "t0".into()).unwrap_err(),
            VaultError::WebsiteTooLong
        ));
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
    fn vendor_order_custom_then_lexicographic_rest() {
        let mut v = Vault::new();
        for (id, vendor) in [("a", "Zeta"), ("b", "Alpha"), ("c", "Beta"), ("d", "Zeta")] {
            let mut i = input(id, "k");
            i.vendor = vendor.into();
            v.add(i, "t0".into()).unwrap();
        }
        // 未设置顺序 → 字典序
        assert_eq!(v.vendors(), vec!["Alpha", "Beta", "Zeta"]);
        // 设置自定义顺序 → 在前，未列出的按字典序补后
        v.reorder_vendors(&["Zeta".into(), "Alpha".into(), "Beta".into()])
            .unwrap();
        assert_eq!(v.vendors(), vec!["Zeta", "Alpha", "Beta"]);
    }

    #[test]
    fn reorder_vendors_rejects_bad_lists_without_mutation() {
        let mut v = Vault::new();
        for (id, vendor) in [("a", "Alpha"), ("b", "Beta")] {
            let mut i = input(id, "k");
            i.vendor = vendor.into();
            v.add(i, "t0".into()).unwrap();
        }
        // 缺一个 / 多一个 / 含未知厂商 / 重复 → 全部拒绝且顺序不变
        for bad in [
            vec!["Alpha".into()],
            vec!["Alpha".into(), "Beta".into(), "Gamma".into()],
            vec!["Alpha".into(), "Nope".into()],
            vec!["Alpha".into(), "Alpha".into()],
        ] {
            assert!(matches!(v.reorder_vendors(&bad), Err(VaultError::InvalidOrderList)));
            assert_eq!(v.vendors(), vec!["Alpha", "Beta"]);
        }
    }

    #[test]
    fn vendor_order_survives_json_roundtrip() {
        let mut v = Vault::new();
        for (id, vendor) in [("a", "Alpha"), ("b", "Beta")] {
            let mut i = input(id, "k");
            i.vendor = vendor.into();
            v.add(i, "t0".into()).unwrap();
        }
        v.reorder_vendors(&["Beta".into(), "Alpha".into()]).unwrap();
        let back = Vault::from_json(&v.to_json()).unwrap();
        assert_eq!(back.vendor_order, vec!["Beta", "Alpha"]);
        assert_eq!(back.vendors(), vec!["Beta", "Alpha"]);
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
      "order": 0,
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
                order: Some(0),
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
            vendor_order: Vec::new(),
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
    fn old_vault_without_order_keeps_file_order() {
        let literal = r#"{
  "schema_version": 1,
  "records": [
    { "id": "a", "name": "甲", "api_key": "k1" },
    { "id": "b", "name": "乙", "api_key": "k2" },
    { "id": "c", "name": "丙", "api_key": "k3" }
  ]
}"#
        .as_bytes();
        let v = Vault::from_json(literal).unwrap();
        let names: Vec<&str> = v.records.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["甲", "乙", "丙"]); // 文件内原顺序
        let orders: Vec<Option<u32>> = v.records.iter().map(|r| r.order).collect();
        assert_eq!(orders, vec![Some(0), Some(1), Some(2)]); // 兜底归一
    }

    #[test]
    fn missing_order_filled_with_position_keeping_explicit_values() {
        // 手改过的文件：部分记录有 order、部分没有 → 缺失的按文件位置补齐，
        // 已有的显式值保留（读取不破坏数据）。
        let literal = r#"{
  "schema_version": 1,
  "records": [
    { "id": "a", "name": "甲", "api_key": "k1", "order": 7 },
    { "id": "b", "name": "乙", "api_key": "k2" }
  ]
}"#
        .as_bytes();
        let v = Vault::from_json(literal).unwrap();
        assert_eq!(v.records[0].order, Some(7));
        assert_eq!(v.records[1].order, Some(1));
        let ids: Vec<&str> = v.records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]); // 文件内原顺序
    }

    #[test]
    fn reorder_applies_full_id_list() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        let c = v.add(input("c", "k3"), "t0".into()).unwrap();
        v.reorder(&[c.clone(), a.clone(), b.clone()]).unwrap();
        let ids: Vec<&str> = v.records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec![c.as_str(), a.as_str(), b.as_str()]);
        let orders: Vec<u32> = v.records.iter().filter_map(|r| r.order).collect();
        assert_eq!(orders, vec![0, 1, 2]);
    }

    #[test]
    fn reorder_rejects_unknown_id_without_mutation() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        let err = v.reorder(&[a.clone(), "not-an-id".into()]).unwrap_err();
        assert!(matches!(err, VaultError::InvalidOrderList));
        // 不落盘：顺序与 order 字段均未变。
        let ids: Vec<&str> = v.records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec![a.as_str(), b.as_str()]);
        let orders: Vec<Option<u32>> = v.records.iter().map(|r| r.order).collect();
        assert_eq!(orders, vec![Some(0), Some(1)]);
    }

    #[test]
    fn reorder_rejects_partial_list() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        v.add(input("b", "k2"), "t0".into()).unwrap();
        assert!(matches!(
            v.reorder(&[a]).unwrap_err(),
            VaultError::InvalidOrderList
        ));
    }

    #[test]
    fn reorder_rejects_duplicates() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        assert!(matches!(
            v.reorder(&[a.clone(), a.clone()]).unwrap_err(),
            VaultError::InvalidOrderList
        ));
        assert!(matches!(
            v.reorder(&[a, b.clone(), b]).unwrap_err(),
            VaultError::InvalidOrderList
        ));
    }

    #[test]
    fn reorder_empty_list_rejected_on_nonempty_vault() {
        let mut v = Vault::new();
        v.add(input("a", "k1"), "t0".into()).unwrap();
        assert!(matches!(
            v.reorder(&[]).unwrap_err(),
            VaultError::InvalidOrderList
        ));
    }

    #[test]
    fn add_new_record_goes_last_after_reorder() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        v.reorder(&[b.clone(), a.clone()]).unwrap();
        let c = v.add(input("c", "k3"), "t1".into()).unwrap();
        let ids: Vec<&str> = v.records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec![b.as_str(), a.as_str(), c.as_str()]);
        assert_eq!(v.records.last().unwrap().order, Some(2));
    }

    #[test]
    fn update_keeps_order() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        v.reorder(&[b.clone(), a.clone()]).unwrap();
        v.update(&a, input("a-renamed", "k9"), "t1".into()).unwrap();
        let ra = v.records.iter().find(|r| r.id == a).unwrap();
        assert_eq!(ra.order, Some(1));
        let ids: Vec<&str> = v.records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec![b.as_str(), a.as_str()]);
    }

    #[test]
    fn delete_keeps_remaining_orders_new_record_gets_max_plus_one() {
        let mut v = Vault::new();
        v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        v.add(input("c", "k3"), "t0".into()).unwrap();
        v.delete(&b).unwrap();
        let orders: Vec<Option<u32>> = v.records.iter().map(|r| r.order).collect();
        assert_eq!(orders, vec![Some(0), Some(2)]);
        let d = v.add(input("d", "k4"), "t1".into()).unwrap();
        assert_eq!(v.records.last().unwrap().id, d);
        assert_eq!(v.records.last().unwrap().order, Some(3));
    }

    #[test]
    fn reordered_roundtrip_preserves_order() {
        let mut v = Vault::new();
        let a = v.add(input("a", "k1"), "t0".into()).unwrap();
        let b = v.add(input("b", "k2"), "t0".into()).unwrap();
        let c = v.add(input("c", "k3"), "t0".into()).unwrap();
        v.reorder(&[c.clone(), a.clone(), b.clone()]).unwrap();
        let bytes = v.to_json();
        let back = Vault::from_json(&bytes).unwrap();
        assert_eq!(back.records, v.records);
        let ids: Vec<&str> = back.records.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec![c.as_str(), a.as_str(), b.as_str()]);
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
