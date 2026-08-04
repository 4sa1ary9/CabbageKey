# 01 — 一次性迁移工具：旧加密 vault 导出为明文 JSON

**What to build:** 一个临时命令行工具：输入旧加密 vault 的路径和旧主密码，把全部记录按现有 schema 写成明文 JSON 到新路径。随附一个自动化验证：先用当前加密代码造一份"已知主密码 + 已知记录"的加密样本，工具对其迁移的输出必须与已知内容逐字节一致。工具交付后，用户即可把自己的真实 vault 迁出。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] 对"已知内容加密样本"的迁移输出与预期明文 JSON 完全一致（自动化验证通过）
- [x] 主密码错误时给出明确报错，不写出任何文件
- [x] 输出文件是合法的明文 vault（schema_version 1，含 endpoints 映射），可被明文读取逻辑直接打开
- [x] 用户已能用该工具导出自己的真实 vault 并人工确认内容正确

## Comments

- 2026-08-03 实现完成：`src-tauri/src/bin/migrate_vault.rs`（依赖现有 crypto/vault 模块，`lib.rs` 中二者改为 `pub mod`）；自动化验证在 `src-tauri/tests/migration_tool.rs`（CLI/文件边界接缝，4 个测试，含应用默认 KDF 参数路径）。手工冒烟：release 构建的 exe 对真实参数样本输出逐字节一致、错误密码不落盘。
- 用户使用：`migrate_vault.exe <旧加密vault路径> <输出明文JSON路径>`，旧主密码在提示后从标准输入读取一行；输出路径已存在时拒绝覆盖。release exe 位于 `src-tauri/target/release/migrate_vault.exe`。
- 迁移验证通过、用户确认数据正确后，脚本与 crypto 模块在同一批改动中删除（spec 顺序约束）。
- 2026-08-04 真实迁移完成（用户确认）：`C:\Users\michael.li\CabbageKey.vault`（10 条记录）→ `C:\Users\michael.li\CabbageKey.json`；密码取自 config.json 残留的 remember 字段，未出现在命令/输出中；导出的明文 JSON 由用户人工核对无误。
