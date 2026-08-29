// Single seam between the frontend and the Tauri command layer. Owns command
// names and argument shapes so no caller needs to know them; errors pass
// through as the backend's strings — where (and whether) to display them
// stays with the caller.
import { invoke } from "@tauri-apps/api/core";

export function openVault(path) {
  return invoke("open_vault", { path });
}

export function createVault(path) {
  return invoke("create_vault", { path });
}

export function getVaultHistory() {
  return invoke("get_vault_history");
}

/** Does a vault file exist at `path`? Drives startup auto-open + 置灰 history. */
export function vaultExists(path) {
  return invoke("vault_exists", { path });
}

export function closeVault() {
  return invoke("close_vault");
}

export function startupInfo() {
  return invoke("startup_info");
}

export function addRecord(input) {
  return invoke("add_record", { input });
}

export function updateRecord(id, input) {
  return invoke("update_record", { id, input });
}

export function deleteRecord(id) {
  return invoke("delete_record", { id });
}

/** `ids` must be a permutation of all record ids. */
export function reorderRecords(ids) {
  return invoke("reorder_records", { ids });
}

/** `vendors` must be a permutation of the current distinct vendor set. */
export function reorderVendors(vendors) {
  return invoke("reorder_vendors", { vendors });
}

export function removeVaultHistory(path) {
  return invoke("remove_vault_history", { path });
}
