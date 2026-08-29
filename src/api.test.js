import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import {
  addRecord,
  closeVault,
  createVault,
  deleteRecord,
  getVaultHistory,
  openVault,
  removeVaultHistory,
  reorderRecords,
  reorderVendors,
  startupInfo,
  updateRecord,
  vaultExists,
} from "./api.js";

const INPUT = { name: "用例", api_key: "sk-test" };

// The wire contract, frozen: each function hits exactly one command with
// exactly one argument shape. A rename here or in lib.rs fails loudly here.
const calls = [
  ["openVault", () => openVault("C:/v.json"), "open_vault", { path: "C:/v.json" }],
  ["createVault", () => createVault("C:/v.json"), "create_vault", { path: "C:/v.json" }],
  ["getVaultHistory", () => getVaultHistory(), "get_vault_history"],
  ["vaultExists", () => vaultExists("C:/v.json"), "vault_exists", { path: "C:/v.json" }],
  ["closeVault", () => closeVault(), "close_vault"],
  ["startupInfo", () => startupInfo(), "startup_info"],
  ["addRecord", () => addRecord(INPUT), "add_record", { input: INPUT }],
  ["updateRecord", () => updateRecord("r1", INPUT), "update_record", { id: "r1", input: INPUT }],
  ["deleteRecord", () => deleteRecord("r1"), "delete_record", { id: "r1" }],
  ["reorderRecords", () => reorderRecords(["r2", "r1"]), "reorder_records", { ids: ["r2", "r1"] }],
  ["reorderVendors", () => reorderVendors(["b", "a"]), "reorder_vendors", { vendors: ["b", "a"] }],
  ["removeVaultHistory", () => removeVaultHistory("C:/v.json"), "remove_vault_history", { path: "C:/v.json" }],
];

describe("api — the Tauri command seam", () => {
  beforeEach(() => invoke.mockClear());

  it.each(calls)("%s invokes %s with the frozen argument shape", (_name, call, cmd, args) => {
    call();
    if (args === undefined) expect(invoke).toHaveBeenCalledWith(cmd);
    else expect(invoke).toHaveBeenCalledWith(cmd, args);
  });

  it("passes the resolved view through unchanged", async () => {
    const view = { records: [], vendors: [], tags: [] };
    invoke.mockResolvedValueOnce(view);
    await expect(openVault("C:/v.json")).resolves.toBe(view);
  });

  it("propagates backend error strings as rejections", async () => {
    invoke.mockRejectedValueOnce("没有打开的 vault");
    await expect(deleteRecord("r1")).rejects.toBe("没有打开的 vault");
  });
});
