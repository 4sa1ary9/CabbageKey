# KeyVault — 交接文档（给下一个做优化的 agent）

> 本文档面向接手 KeyVault 做优化/修复的 agent。先读这份，再读 `CONTEXT.md`（术语与产品定位）、`docs/DESIGN.md`（设计与决策依据）和 `README.md`（构建步骤）。关键决策记录在 `docs/adr/`（ADR-0001 技术栈、ADR-0002 明文化无密码）。

## 项目一句话

完全本地、无密码的 API key 收纳工具。数据以明文 JSON 存于单个 vault 文件（人类可读），拷贝文件夹即迁移。Tauri 2 + Rust 后端 + 原生 JS 三栏前端。**没有加密、没有主密码、没有网盘同步。**

## 当前状态（2026-08-04）

- 明文化重构完成：加密层、主密码、锁屏、记住我/免密、冲突检测、.bak 备份、明文导出命令已全部删除（见 ADR-0002 与 CHANGELOG 0.3.0）。
- 代码全部写完，**编译通过**，Rust 15 测试过，前端 56/56 测试过。
- 一次性迁移工具 `migrate_vault` 已完成使命（真实 vault `CabbageKey.vault` → `CabbageKey.json`，10 条记录用户核对无误），与 crypto 模块同批删除，仓库不再含任何加密代码。
- 已推到 https://github.com/4sa1ary9/CabbageKey.git
- 新启动流程：无密码直进主界面 / 选择页（打开已有、新建、历史列表、切换 vault）。
- v0.2.0 的厂商预设、4 接口规范、表单重设计全部保留。

## 2026-08-29 — 全量评审整改（v0.3.0 之后，未发版）

- 修复 5 bug：剪贴板清空前比对内容（不再误清用户后续复制）、防双击重复提交、官网长度按字符数（原按字节）、minWidth 720→860（消除窄窗详情死路）、左栏"未分组"入口 + 失效筛选自动复位。
- 改进 8 项：搜索覆盖 api_key/端点 URL、详情面板创建/更新时间、key 显示 30 秒自动回掩码、已有 URL 时切厂商先确认、对话框交互打磨（Enter 跳下一字段/未保存修改先确认/复制反馈去重）、config 原子写、单实例（tauri-plugin-single-instance）、emoji 图标换描边 SVG。
- 重构：详情面板事件一次性委托在容器上；选中记录只更新行高亮 + 详情，不再整树重渲染。
- 全部落档 `.scratch/review-2026-08/`（spec + 14 票，多数 done）；预防性性能优化的"不作为"决策在 `.out-of-scope/preventive-performance-work.md`。
- 测试：前端 96/96、后端 30/30（详见"测试"节）；运行时行为（剪贴板/原生对话框/窗口缩放/双开）待真机冒烟，清单见各票 Comments 与 `docs/TEST-PLAN.md` 人工走查清单。

## 构建环境（重要）

本机 MSVC 没进全局 PATH，`cargo build` 前必须导出环境变量。完整变量见 `~/.claude` 记忆 `keyvault-build-env`，或:

```bash
export MSVC="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207"
export SDK="/c/Program Files (x86)/Windows Kits/10"
export PATH="$HOME/.cargo/bin:$MSVC/bin/Hostx64/x64:$SDK/bin/10.0.26100.0/x64:$PATH"
export LIB="$MSVC/lib/x64:$SDK/Lib/10.0.26100.0/um/x64:$SDK/Lib/10.0.26100.0/ucrt/x64"
export INCLUDE="$MSVC/include:$SDK/Include/10.0.26100.0/ucrt:$SDK/Include/10.0.26100.0/um:$SDK/Include/10.0.26100.0/shared:$SDK/Include/10.0.26100.0/winrt:$SDK/Include/10.0.26100.0/cppwinrt"
```

> 注:如果 `cargo check` 在 tauri build script 阶段报 `failed to read plugin permissions: ... \lsz\src-tauri\... (os error 3)`（路径里少了 `keyvault` 一段），那是 target 缓存里残留的旧绝对路径。`cargo clean` 后重建即可。

前端:`bun install` / `bun run test` / `bun run build`。
完整应用:`bun run tauri dev`（开发）/ `bun run tauri build`（打包）。

---

## v0.3.0 — 明文化重构（2026-08-04）

**威胁模型变化（重要）**：API key 明文落盘，任何能读本机硬盘的程序/人/备份软件都可取得原文；兜底是本机账户密码/BitLocker，与 `~/.aws/credentials`、`~/.ssh` 同级。**不要把 vault 文件放进网盘同步目录**——明文一旦上传即泄露。迁移 = 拷贝文件夹，不是同步。

### 删除（ADR-0002）

- `src-tauri/src/crypto.rs`（Argon2id + AES-256-GCM + KAT，308 行）、`src-tauri/src/bin/migrate_vault.rs`、`src-tauri/tests/migration_tool.rs`。
- 锁屏三模式（choose/unlock/create）、主密码、记住我/免密登录、`config.json` 中的 remember 凭据。
- sha256 冲突检测、保存前哈希比对、`.bak` 自动备份、明文导出命令、CRUD 的 `force` 参数。
- 依赖：aes-gcm / argon2 / rand / zeroize / sha2 / base64 / hex 全部移除。

### 新增/保留

- 启动直进主界面（上次 vault 存在时）；选择页含历史列表（最多 10 条、置灰失效项、单条移除）；主界面"切换 vault"入口。
- 明文格式 golden test（`src-tauri/src/vault.rs`），逐字节冻结磁盘 JSON（schema_version 1）——接替原 KAT"防静默改格式"的角色。
- 前端控制器模块化（DESIGN.md D6）：`main.js` 为薄 DOM 壳；纯逻辑模块 filter / vendorPresets / formState / history 全部有 vitest。
- 保留：厂商预设、4 接口规范 + endpoints 映射、标签/备注、三栏 UI、原子写。

---

## v0.2.0 — 厂商预设与表单重设计（2026-06-21，仍有效）

### 1) 内置 AI 厂商预设 + 4 种接口规范

- 新增 `src/vendorPresets.js` 模块，内含 10 家内置 AI 厂商的预设数据。
- 厂商选择改为 `<select>` 下拉（含"自定义"选项），选中后自动填充官网、接口规范、端点 URL。
- 接口规范 4 种：OpenAI Chat Completions / OpenAI Responses API / Anthropic Messages / Gemini generateContent。
- 多协议厂商（如 DeepSeek 支持 openai-chat + openai-responses）可自由切换，URL 联动更新。
- 单协议厂商（如 Anthropic）尝试选择不支持的规范时 toast 提示"仅支持 xxx 接口"并自动回退。
- 后端 `vault.rs` 验证：`endpoints` 的 key 接受 `""`（空映射）/ `openai-chat` / `openai-responses` / `anthropic` / `gemini`。

### 2) 表单字段重设计

- 顺序：厂商 → 用途名称 → api_key → 接口规范 + 端点 URL（同行）→ 官网 → 标签 → 备注。
- 新增 `website` 字段（`<input maxlength="2048">`）；接口规范为多选 toggle 按钮。
- 详情面板：website 可点击超链接（自动补 `https://`）；端点 URL 按规范切换显示；key 默认遮罩可点睛。

### 3) Record schema 扩展

- 新增字段：`endpoints: Map<api_standard, url>`（v0.2.0 为 api_standard/url，v0.3.0 改为 BTreeMap 映射）、`website`（serde default）。
- 完全向后兼容：旧文件缺字段自动默认空，schema_version 保持 1。

---

## 已知待优化项（非阻塞）

- CI 跨平台打包发布流水线（tauri-action）
- 完整无障碍审计（屏幕阅读器全流程、对比度逐项、ARIA）
- 深色模式
- E2E 自动化（维持人工走查传统，空 `e2e/` 目录已移除；如需自动化优先考虑 tauri-driver/WebdriverIO）

## 架构速查（细节看 docs/DESIGN.md）

- `src-tauri/src/vault.rs` — 记录 schema（name*/api_key* 必填，vendor/endpoints/website/note/tags 可选，uuid 主键）、CRUD、必填校验、原子写、**明文格式 golden test**、历史列表管理（`VaultHistoryEntry` / `add_vault_history_entry`）。
- `src-tauri/src/lib.rs` — Tauri 命令层 + 会话态（只有当前 vault + 路径，无任何凭据）。命令：`startup_info` / `vault_exists` / `create_vault` / `open_vault` / `close_vault` / `add_record` / `update_record` / `delete_record` / `reorder_records` / `reorder_vendors` / `get_vault_history` / `remove_vault_history`。config 只存 `last_path` + `vault_history`，写盘走原子写。
- `src/filter.js` — 纯检索逻辑（搜索/厂商/标签叠加），已单测。
- `src/vendorPresets.js` — 内置 AI 厂商预设数据 + 工具函数（getPreset/getSupportedStandards/getEndpointUrl/normalizeUrl/getStandardLabel）。
- `src/formState.js` — 表单状态机（预设联动、接口规范 toggle、提交载荷构建/校验），已单测。
- `src/history.js` — 历史条目文件存在性标注（驱动置灰），已单测。
- `src/order.js` — 拖拽落点/全局顺序纯逻辑（moveBefore/insertionSlot/nextAfterId），已单测。
- `src/vendorDropdown.js` — 厂商下拉候选构建与过滤，已单测。
- `src/detailView.js` — 详情面板 HTML 构建（字段序、掩码、时间行、SVG 按钮），已单测。
- `src/main.js` — 薄 DOM 壳：事件绑定 + 渲染（选择页、三栏、复制反馈、表单同步）。
- `src/index.html` / `src/styles.css` — 选择页 + 三栏 UI + 设计代头（真字体 + 等宽渲染 key/url + 单强调色 + 4/8/16/24 间距）。

## 测试

- `cd src-tauri && cargo test` — 后端 30 测试（vault CRUD + 顺序/重排 + golden test + 历史，需先导出构建环境变量或用 `build.ps1`）
- `bun run test` — 前端 96 测试（filter 16 + vendorPresets 19 + formState 21 + detailView 13 + order 16 + vendorDropdown 7 + history 4）
- 人工端到端走查：见 `docs/TEST-PLAN.md` 的人工清单（直进主界面 → 增 → 搜 → 复制 → 改 → 删 → 整个数据文件夹拷到另一路径直接打开使用）。
