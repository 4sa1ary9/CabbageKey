# 03 — vault 选择页完整版：历史列表 + 切换入口

**What to build:** 把 02 的简版选择页升级为完整版：展示最近使用的 vault 历史（最多 10 条、最新在前、按路径去重），文件不存在的条目置灰提示，每条可单条移除。主界面内提供"切换 vault"入口：关闭当前 vault 回到选择页，可打开另一个已有 vault 或新建——全程无密码。每次成功打开/新建后历史自动更新。

**Blocked by:** 02 — 无密码主流程

**Status:** done

- [x] 选择页展示 vault 历史：最多 10 条、最新在前、按路径去重
- [x] 文件不存在的历史条目置灰并给出提示
- [x] 每条历史可单条移除
- [x] 主界面内有"切换 vault"入口，可在多个 vault 间切换，全程无密码
- [x] 成功打开/新建后历史自动更新

## Comments

2026-08-03 完成。实现要点：

- 后端：`VaultHistoryEntry` 与 `add_vault_history_entry` 从 lib.rs 下沉到 vault.rs（spec 的预约定测试接缝），补 3 个单测（最新在前+按路径去重、上限 10 条、display_name 取文件名/根路径回退）。open/create 里的 remember_path 本来就会自动更新历史，无需改动。
- 前端：新增纯逻辑模块 `src/history.js`（`annotateHistoryEntries`，把并行 vault_exists 的结果标注到条目上，驱动"文件不存在"置灰），配 4 个 vitest；选择页 `.lock-choose` 内加历史列表（复用原历史 UI 样式，CSS 此前保留未删），点击条目直接打开、× 单条移除；顶栏新增"切换 vault"按钮 → `close_vault` + 清空会话态 + 回选择页并刷新历史。
- 验证：cargo test 24+4 全绿、vitest 31/31 全绿、vite build 与 cargo build 通过。
- code-review 修一处：`remove_vault_history` 现在同步清掉匹配的 `last_path`——否则移除的恰是上次使用的 vault 时，下次启动自动打开会把它重新插回历史（"复活"）。
