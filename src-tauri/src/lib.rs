//! Tauri command layer: holds the in-memory session (decrypted vault +
//! passphrase + the on-disk hash we loaded, for conflict detection) and
//! exposes commands to the frontend.
//!
//! Security note: the master passphrase and decrypted records live in process
//! memory only while the app is unlocked. Nothing is written to disk
//! unencrypted except an explicit user-triggered plaintext export (D6).

pub mod crypto;
pub mod vault;

use crypto::KdfParams;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use vault::{Record, RecordInput, Vault};

/// How long a "记住我" credential stays valid before the user must re-enter
/// the master password (3 days / 72 hours). Mirrors the QQ/WeChat "remember me" pattern.
const REMEMBER_SECS: u64 = 3 * 24 * 60 * 60;

/// Local, non-synced app config (last used vault + optional remembered login).
///
/// Security note: this lives in the OS app-config dir on the *local* machine
/// only — it is never written next to the vault and never goes to the cloud.
/// When the user opts into "记住我", the master passphrase is stored here so a
/// short-window re-open can skip the prompt. This trades some local security
/// for convenience; the cloud-synced vault file itself stays encrypted.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct VaultHistoryEntry {
    path: String,
    /// Display name (filename without directory) for quick recognition.
    display_name: String,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Config {
    /// Last vault path, prefilled on next launch (always remembered).
    last_path: Option<String>,
    /// Optional auto-login credential (only when the user ticks 记住我).
    remember: Option<Remembered>,
    /// Up to 10 most-recently-used vault paths, newest first.
    #[serde(default)]
    vault_history: Vec<VaultHistoryEntry>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Remembered {
    path: String,
    passphrase: String,
    /// Unix seconds after which this credential is no longer accepted.
    expires_at: u64,
}

fn unix_now() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
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

/// Add or promote a vault path to the front of the history list.
/// Deduplicates by path, caps at 10 entries, newest first.
fn add_vault_history_entry(history: &mut Vec<VaultHistoryEntry>, path: &str) {
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

/// Record this path as "last used" and, if `remember`, store an auto-login
/// credential with a fresh expiry. Called after every successful unlock/create.
fn remember_after(app: &tauri::AppHandle, path: &str, passphrase: &str, remember: bool) {
    let mut cfg = load_config(app);
    cfg.last_path = Some(path.to_string());
    cfg.remember = remember.then(|| Remembered {
        path: path.to_string(),
        passphrase: passphrase.to_string(),
        expires_at: unix_now() + REMEMBER_SECS,
    });
    add_vault_history_entry(&mut cfg.vault_history, path);
    let _ = save_config(app, &cfg);
}

/// Live session state. `None` fields mean "locked / no vault open".
#[derive(Default)]
struct Session {
    vault: Option<Vault>,
    passphrase: Option<String>,
    path: Option<PathBuf>,
    /// sha256 of the encrypted bytes we last loaded/saved — the baseline for
    /// conflict detection (D4).
    loaded_hash: Option<String>,
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

/// Does a vault file already exist at this path? Drives first-run vs unlock UI.
#[tauri::command]
fn vault_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

/// Create a brand-new empty vault at `path` protected by `passphrase` (first run).
#[tauri::command]
fn create_vault(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    path: String,
    passphrase: String,
    remember: bool,
) -> Result<VaultView, String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err("该位置已存在 vault 文件".into());
    }
    let v = Vault::new();
    let blob = crypto::encrypt_vault(&v.to_json(), passphrase.as_bytes(), KdfParams::default())
        .map_err(|e| e.to_string())?;
    vault::atomic_write(&p, &blob).map_err(|e| e.to_string())?;

    let mut s = state.0.lock().unwrap();
    let view = view_of(&v);
    s.loaded_hash = Some(vault::sha256_hex(&blob));
    s.vault = Some(v);
    s.passphrase = Some(passphrase.clone());
    s.path = Some(p);
    remember_after(&app, &path, &passphrase, remember);
    Ok(view)
}

/// Unlock an existing vault. Wrong password -> clear error (T11 / D-fail).
#[tauri::command]
fn unlock_vault(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
    path: String,
    passphrase: String,
    remember: bool,
) -> Result<VaultView, String> {
    let p = PathBuf::from(&path);
    let blob = std::fs::read(&p).map_err(|e| format!("读取文件失败: {e}"))?;
    let json = crypto::decrypt_vault(&blob, passphrase.as_bytes()).map_err(|e| e.to_string())?;
    let v = Vault::from_json(&json).map_err(|e| e.to_string())?;

    let mut s = state.0.lock().unwrap();
    let view = view_of(&v);
    s.loaded_hash = Some(vault::sha256_hex(&blob));
    s.vault = Some(v);
    s.passphrase = Some(passphrase.clone());
    s.path = Some(p);
    remember_after(&app, &path, &passphrase, remember);
    Ok(view)
}

/// Startup hint for the lock screen: which vault to prefill, and whether a
/// valid "记住我" credential exists so the UI can attempt a passwordless open.
#[derive(serde::Serialize)]
struct StartupInfo {
    last_path: Option<String>,
    can_auto: bool,
}

#[tauri::command]
fn startup_info(app: tauri::AppHandle) -> StartupInfo {
    let cfg = load_config(&app);
    let can_auto = cfg
        .remember
        .as_ref()
        .is_some_and(|r| r.expires_at > unix_now() && PathBuf::from(&r.path).exists());
    StartupInfo {
        last_path: cfg.last_path,
        can_auto,
    }
}

/// Passwordless open using a stored, non-expired "记住我" credential. Only the
/// frontend's startup path calls this; a manual lock never auto-reopens.
#[tauri::command]
fn auto_unlock(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<VaultView, String> {
    let mut cfg = load_config(&app);
    let r = cfg.remember.clone().ok_or("没有可用的免密凭据")?;
    if r.expires_at <= unix_now() {
        // Discard expired credential from config so it is not retried.
        cfg.remember = None;
        let _ = save_config(&app, &cfg);
        return Err("免密登录已过期，请重新输入主密码".into());
    }
    let p = PathBuf::from(&r.path);
    let blob = std::fs::read(&p).map_err(|e| format!("读取文件失败: {e}"))?;
    let json = crypto::decrypt_vault(&blob, r.passphrase.as_bytes()).map_err(|e| e.to_string())?;
    let v = Vault::from_json(&json).map_err(|e| e.to_string())?;

    // Refresh the expiry window on successful auto-unlock (reset 72h timer).
    cfg.remember = Some(Remembered {
        path: r.path.clone(),
        passphrase: r.passphrase.clone(),
        expires_at: unix_now() + REMEMBER_SECS,
    });
    let _ = save_config(&app, &cfg);

    let mut s = state.0.lock().unwrap();
    let view = view_of(&v);
    s.loaded_hash = Some(vault::sha256_hex(&blob));
    s.vault = Some(v);
    s.passphrase = Some(r.passphrase);
    s.path = Some(p);
    Ok(view)
}

/// Log out (退出登录): drop the in-memory session and clear the remembered
/// credential + last path, so the next launch starts from the chooser.
#[tauri::command]
fn forget_session(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<(), String> {
    {
        let mut s = state.0.lock().unwrap();
        *s = Session::default();
    }
    save_config(&app, &Config::default())
}

/// Lock: drop all in-memory secrets.
#[tauri::command]
fn lock_vault(state: tauri::State<AppState>) {
    let mut s = state.0.lock().unwrap();
    *s = Session::default();
}

/// Conflict check (D4): has the file on disk changed since we loaded it?
/// Called before any save. Returns true if another device wrote to it.
fn disk_changed(s: &Session) -> Result<bool, String> {
    let path = s.path.as_ref().ok_or("no vault open")?;
    if !path.exists() {
        return Ok(false);
    }
    let cur = std::fs::read(path).map_err(|e| e.to_string())?;
    let cur_hash = vault::sha256_hex(&cur);
    Ok(Some(&cur_hash) != s.loaded_hash.as_ref())
}

/// Persist the in-memory vault. `force` overrides a detected conflict.
/// Without force, a conflict returns Err("CONFLICT") so the UI can warn (D4).
fn persist(s: &mut Session, force: bool) -> Result<(), String> {
    if !force && disk_changed(s)? {
        return Err("CONFLICT".into());
    }
    let path = s.path.clone().ok_or("no vault open")?;
    let pass = s.passphrase.clone().ok_or("locked")?;
    let v = s.vault.as_ref().ok_or("locked")?;
    vault::backup_existing(&path).map_err(|e| e.to_string())?; // D6 .bak
    let blob = crypto::encrypt_vault(&v.to_json(), pass.as_bytes(), KdfParams::default())
        .map_err(|e| e.to_string())?;
    vault::atomic_write(&path, &blob).map_err(|e| e.to_string())?;
    s.loaded_hash = Some(vault::sha256_hex(&blob));
    Ok(())
}

#[tauri::command]
fn add_record(
    state: tauri::State<AppState>,
    input: RecordInput,
    force: bool,
) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("locked")?
        .add(input, now_iso())
        .map_err(|e| e.to_string())?;
    persist(&mut s, force)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

#[tauri::command]
fn update_record(
    state: tauri::State<AppState>,
    id: String,
    input: RecordInput,
    force: bool,
) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("locked")?
        .update(&id, input, now_iso())
        .map_err(|e| e.to_string())?;
    persist(&mut s, force)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

#[tauri::command]
fn delete_record(
    state: tauri::State<AppState>,
    id: String,
    force: bool,
) -> Result<VaultView, String> {
    let mut s = state.0.lock().unwrap();
    s.vault
        .as_mut()
        .ok_or("locked")?
        .delete(&id)
        .map_err(|e| e.to_string())?;
    persist(&mut s, force)?;
    Ok(view_of(s.vault.as_ref().unwrap()))
}

/// Return the vault history list from config.
#[tauri::command]
fn get_vault_history(app: tauri::AppHandle) -> Vec<VaultHistoryEntry> {
    load_config(&app).vault_history
}

/// Remove one entry from the vault history by path.
#[tauri::command]
fn remove_vault_history(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let mut cfg = load_config(&app);
    cfg.vault_history.retain(|e| e.path != path);
    save_config(&app, &cfg)
}

/// Plaintext export (D6 escape hatch). Writes the decrypted JSON to a
/// user-chosen path. High-risk; the UI gates this behind explicit confirm.
#[tauri::command]
fn export_plaintext(state: tauri::State<AppState>, dest: String) -> Result<(), String> {
    let s = state.0.lock().unwrap();
    let v = s.vault.as_ref().ok_or("locked")?;
    std::fs::write(PathBuf::from(dest), v.to_json()).map_err(|e| e.to_string())
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
            auto_unlock,
            forget_session,
            create_vault,
            unlock_vault,
            lock_vault,
            add_record,
            update_record,
            delete_record,
            export_plaintext,
            get_vault_history,
            remove_vault_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
