//! Tauri command layer: holds the in-memory session (current vault + path)
//! and exposes commands to the frontend.
//!
//! The vault is a single plaintext JSON file, read and written directly — no
//! encryption, no password, no session secrets.

pub mod vault;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use vault::{add_vault_history_entry, Record, RecordInput, Vault, VaultHistoryEntry};

/// Local, non-synced app config (last used vault + recent history).
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Config {
    /// Last vault path, opened automatically on next launch.
    last_path: Option<String>,
    /// Up to 10 most-recently-used vault paths, newest first.
    #[serde(default)]
    vault_history: Vec<VaultHistoryEntry>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn load_config(app: &tauri::AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_config(app: &tauri::AppHandle, cfg: &Config) -> Result<(), String> {
    let p = config_path(app)?;
    let json = serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(p, json).map_err(|e| e.to_string())
}

/// Record this path as "last used" and promote it in the history list.
/// Called after every successful open/create.
fn remember_path(app: &tauri::AppHandle, path: &str) {
    let mut cfg = load_config(app);
    cfg.last_path = Some(path.to_string());
    add_vault_history_entry(&mut cfg.vault_history, path);
    let _ = save_config(app, &cfg);
}

/// Live session state. `None` means "no vault open" (chooser page).
#[derive(Default)]
struct Session {
    vault: Option<Vault>,
    path: Option<PathBuf>,
}

struct AppState(Mutex<Session>);

fn now_iso() -> String {
    // Readable UTC timestamp. Intentionally does not pull chrono — one
    // dependency less for a string we generate once per operation.
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let total_secs = d.as_secs();
    // Decompose into civil date via the Neri-Schneider algorithm (fast,
    // branch-light, correct for all years 1–9999).
    let s = total_secs as i64;
    let days = s / 86400;
    let sec_of_day = s % 86400;
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + if mp < 10 { 0 } else { 1 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y,
        mo,
        day,
        sec_of_day / 3600,
        (sec_of_day / 60) % 60,
        sec_of_day % 60,
    )
}

#[derive(serde::Serialize)]
struct VaultView {
    records: Vec<Record>,
    vendors: Vec<String>,
    tags: Vec<String>,
}

fn view_of(v: &Vault) -> VaultView {
    VaultView {
        records: v.records.clone(),
        vendors: v.vendors(),
        tags: v.tags(),
    }
}

/// Does a vault file already exist at this path? Drives startup auto-open and
/// the history list's missing-file state.
#[tauri::command]
fn vault_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

/// Create a brand-new empty vault at `path` (plaintext JSON).
#[tauri::command]
fn create_vault(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    path: String,
) -> Result<VaultView, String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("该位置已存在 vault 文件".into());
    }
    let v = Vault::new();
    vault::atomic_write(&p, &v.to_json()).map_err(|e| e.to_string())?;

    let mut s = state.0.lock().unwrap();
    let view = view_of(&v);
    s.vault = Some(v);
    s.path = Some(p);
    remember_path(&app, &path);
    Ok(view)
}

/// Open an existing vault. No password — reads the plaintext JSON and parses it.
#[tauri::command]
fn open_vault(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    path: String,
) -> Result<VaultView, String> {
    let p = PathBuf::from(&path);
    let bytes = std::fs::read(&p).map_err(|e| format!("读取文件失败: {e}"))?;
    let v = Vault::from_json(&bytes).map_err(|e| e.to_string())?;

    let mut s = state.0.lock().unwrap();
    let view = view_of(&v);
    s.vault = Some(v);
    s.path = Some(p);
    remember_path(&app, &path);
    Ok(view)
}

/// Startup hint: which vault to open automatically, if any.
#[derive(serde::Serialize)]
struct StartupInfo {
    last_path: Option<String>,
}

#[tauri::command]
fn startup_info(app: tauri::AppHandle) -> StartupInfo {
    StartupInfo {
        last_path: load_config(&app).last_path,
    }
}

/// Close the current vault and return to the chooser page.
#[tauri::command]
fn close_vault(state: tauri::State<AppState>) {
    let mut s = state.0.lock().unwrap();
    *s = Session::default();
}

/// Persist the in-memory vault to disk: plaintext JSON, atomic tmp+rename.
fn persist(s: &Session) -> Result<(), String> {
    let path = s.path.clone().ok_or("没有打开的 vault")?;
    let v = s.vault.as_ref().ok_or("没有打开的 vault")?;
    vault::atomic_write(&path, &v.to_json()).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_record(
    state: tauri::State<AppState>,
    input: RecordInput,
) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("没有打开的 vault")?
        .add(input, now_iso())
        .map_err(|e| e.to_string())?;
    persist(&s)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

#[tauri::command]
fn update_record(
    state: tauri::State<AppState>,
    id: String,
    input: RecordInput,
) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("没有打开的 vault")?
        .update(&id, input, now_iso())
        .map_err(|e| e.to_string())?;
    persist(&s)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

#[tauri::command]
fn delete_record(state: tauri::State<AppState>, id: String) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("没有打开的 vault")?
        .delete(&id)
        .map_err(|e| e.to_string())?;
    persist(&s)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

/// Apply a new global record order. `ids` must be a permutation of all record
/// ids; on any invalid id the vault is left untouched and nothing is written.
#[tauri::command]
fn reorder_records(
    state: tauri::State<AppState>,
    ids: Vec<String>,
) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("没有打开的 vault")?
        .reorder(&ids)
        .map_err(|e| e.to_string())?;
    persist(&s)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

/// Return the vault history list from config.
#[tauri::command]
fn get_vault_history(app: tauri::AppHandle) -> Vec<VaultHistoryEntry> {
    load_config(&app).vault_history
}

/// Remove one entry from the vault history by path. If the removed entry is
/// also the last-used vault, forget it too — otherwise the next launch's
/// auto-open would re-add it to the history.
#[tauri::command]
fn remove_vault_history(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut cfg = load_config(&app);
    cfg.vault_history.retain(|e| e.path != path);
    if cfg.last_path.as_deref() == Some(path.as_str()) {
        cfg.last_path = None;
    }
    save_config(&app, &cfg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState(Mutex::new(Session::default())))
        .invoke_handler(tauri::generate_handler![
            vault_exists,
            startup_info,
            create_vault,
            open_vault,
            close_vault,
            add_record,
            update_record,
            delete_record,
            reorder_records,
            get_vault_history,
            remove_vault_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
