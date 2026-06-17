//! Tauri command layer: holds the in-memory session (decrypted vault +
//! passphrase + the on-disk hash we loaded, for conflict detection) and
//! exposes commands to the frontend.
//!
//! Security note: the master passphrase and decrypted records live in process
//! memory only while the app is unlocked. Nothing is written to disk
//! unencrypted except an explicit user-triggered plaintext export (D6).

mod crypto;
mod vault;

use crypto::KdfParams;
use std::path::PathBuf;
use std::sync::Mutex;
use vault::{Record, RecordInput, Vault};

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
    state: tauri::State<AppState>,
    path: String,
    passphrase: String,
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
    s.passphrase = Some(passphrase);
    s.path = Some(p);
    Ok(view)
}

/// Unlock an existing vault. Wrong password -> clear error (T11 / D-fail).
#[tauri::command]
fn unlock_vault(
    state: tauri::State<AppState>,
    path: String,
    passphrase: String,
) -> Result<VaultView, String> {
    let p = PathBuf::from(&path);
    let blob = std::fs::read(&p).map_err(|e| format!("读取文件失败: {e}"))?;
    let json = crypto::decrypt_vault(&blob, passphrase.as_bytes()).map_err(|e| e.to_string())?;
    let v = Vault::from_json(&json).map_err(|e| e.to_string())?;

    let mut s = state.0.lock().unwrap();
    let view = view_of(&v);
    s.loaded_hash = Some(vault::sha256_hex(&blob));
    s.vault = Some(v);
    s.passphrase = Some(passphrase);
    s.path = Some(p);
    Ok(view)
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
            create_vault,
            unlock_vault,
            lock_vault,
            add_record,
            update_record,
            delete_record,
            export_plaintext,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
