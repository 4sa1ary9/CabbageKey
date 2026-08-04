# 05 — 删除 crypto 模块、迁移工具与加密依赖

**What to build:** 在迁移工具完成使命后，把整个加密时代从仓库中移除：crypto 模块、一次性迁移工具、明文导出命令、以及所有只为加密存在的依赖。此后仓库不再含任何加密代码，构建产物更小的同时，"没有密码"在代码层面成为事实而不仅是约定。

**Blocked by:** 01 — 一次性迁移工具；02 — 无密码主流程

**Status:** ready-for-agent

- [x] 人工门：用户确认真实 vault 已用 01 的工具导出且数据无误
- [x] crypto 模块、迁移工具、明文导出命令全部删除，仓库不再含任何加密代码
- [x] 依赖清单中不再有任何加密相关 crate
- [x] cargo test 全绿、应用构建通过
- [x] 启动、CRUD、打开迁移后文件均正常

## Comments

- 2026-08-04 实现完成。删除：`src-tauri/src/crypto.rs`（308 行，含 KAT）、`src-tauri/src/bin/migrate_vault.rs`（91 行）、`src-tauri/tests/migration_tool.rs`（185 行）；`lib.rs` 移除 `pub mod crypto` 与相关注释；`Cargo.toml` 移除 aes-gcm / argon2 / rand / zeroize / sha2 / base64 / hex（dev-dep）与 `[dev-dependencies]` 节。Cargo.lock 零新增、纯删除（213 行），移除 keyvault→hex 的 dev-dep 边（hex@0.4 包块因 serde_with 传递引用保留）；base64@0.22.1、sha2、getrandom 均为 tauri 框架自身传递依赖，非本项目直接依赖，保留。
- 迁移前人工门已过：真实 vault `CabbageKey.vault` 已导出为 `CabbageKey.json`（10 条记录），用户逐条核对 api_key 无误。
- 验证：cargo test 15 个全绿（vault 模块），cargo build 通过，前端 vitest 56 个全绿；临时验证测试确认当前 schema 可直接打开真实迁移文件 `CabbageKey.json`（10 条、字段完整），测试用完即删；debug exe 启动冒烟正常（进程存活无 panic）。GUI 人工走查（点界面完成增/搜/复制/改/删）并入 06 的人工 E2E。
- 顺手删除：`src/dist/` 过期构建产物（未跟踪，内含旧版密码锁屏 UI）。
- 提示：旧加密文件 `C:\Users\michael.li\CabbageKey.vault` 与 config.json 中残留的明文密码（remember 字段）未删除——新应用确认正常工作后建议自行清理。
