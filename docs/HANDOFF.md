# KeyVault — 交接文档（给下一个做优化的 agent）

> 本文档面向接手 KeyVault 做优化/修复的 agent。先读这份,再读 `docs/DESIGN.md`(完整设计与决策依据)和 `README.md`(构建步骤)。

## 项目一句话

完全本地的加密 API key 收纳工具。数据存成单个 AES-256-GCM 加密文件,丢网盘(坚果云/Dropbox)多设备同步。Tauri 2 + Rust 后端 + 原生 JS 三栏前端。

## 当前状态(2026-06-21)

- 代码全部写完,**编译通过**,Rust 21 测试过,前端 27/27 测试过。
- Release 已打包:`src-tauri/target/release/` 下有 `keyvault.exe` + `.msi` + nsis `.exe` 安装器。
- 已推到 https://github.com/4sa1ary9/CabbageKey.git
- **P0(首次创建 vault 走不通)已修复** — 见下方"已修复"段。
- 新增"记住账号 / 短期免密"登录(QQ/微信式),见下方。
- **v0.2.0 新增：厂商预设、4 种 API 接口规范、vault 历史列表、3 天免密、表单重设计** — 见下方。

## 构建环境(重要)

本机 MSVC 没进全局 PATH,`cargo build` 前必须导出环境变量。完整变量见 `~/.claude` 记忆 `keyvault-build-env`,或:

```bash
export MSVC="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207"
export SDK="/c/Program Files (x86)/Windows Kits/10"
export PATH="$HOME/.cargo/bin:$MSVC/bin/Hostx64/x64:$SDK/bin/10.0.26100.0/x64:$PATH"
export LIB="$MSVC/lib/x64:$SDK/Lib/10.0.26100.0/um/x64:$SDK/Lib/10.0.26100.0/ucrt/x64"
export INCLUDE="$MSVC/include:$SDK/Include/10.0.26100.0/ucrt:$SDK/Include/10.0.26100.0/um:$SDK/Include/10.0.26100.0/shared:$SDK/Include/10.0.26100.0/winrt:$SDK/Include/10.0.26100.0/cppwinrt"
```

> 注:如果 `cargo check` 在 tauri build script 阶段报 `failed to read plugin permissions: ... \lsz\src-tauri\... (os error 3)`(路径里少了 `keyvault` 一段),那是 target 缓存里残留的旧绝对路径。`cargo clean` 后重建即可。

前端:`bun install` / `bun run test` / `bun run build`。
完整应用:`bun run tauri dev`(开发)/ `bun run tauri build`(打包)。

---

## 已修复 — P0 首次创建 vault + 登录体验

### 1) 首次创建 vault 走不通(原 P0)

**原因**:`onBrowse` 用 `state.isNewVault`(默认 false)决定弹 open 还是 save 对话框,首屏只能 openDialog 选已有文件,无法命名新文件 → 死循环。

**修法(交接文档推荐的 A 方案)**:锁屏改成**三个显式模式**,不再靠探测文件是否存在自动切换:
- `choose`:两个入口按钮「打开已有 vault」/「新建 vault」。
- `unlock`:已知路径,单个主密码框 +「解锁」。
- `create`:新建,主密码 + 确认 + 不可找回警告 +「创建并解锁」(走 saveDialog)。

代码:`src/main.js` 的 `showChoose/showUnlock/showCreate/initLock/onBrowse/onOpenExisting/onCreateNew`;`src/index.html` 锁屏区拆成 `#lock-choose` + `#lock-form`。`refreshLockMode`/`state.isNewVault` 已删除。

### 2) 记住账号 + 短期免密(QQ/微信式登录)

- 后端在**应用配置目录**(本机,不随云盘同步)存 `config.json`:
  - `last_path` — 上次用的 vault 路径,每次成功解锁/创建后写入。下次启动自动预填,直接进 `unlock` 模式(单密码),不再要求重选路径、不再要求输两次密码。
  - `remember` — 仅当用户勾选「记住我」时写入:`{ path, passphrase, expires_at }`,有效期 7 天。
- 启动流程(`initLock`):`startup_info` → 若有未过期的免密凭据则 `auto_unlock` 直接进主界面;否则用 `last_path` 进 `unlock` 模式;都没有则 `choose`。
- 「退出登录 / 使用其他 vault」(`forget_session`):清空内存会话 + `config.json`(含 `last_path` 与 `remember`),回到 choose,可换库。
- 手动锁定(🔒)只锁不清凭据,但**不**自动免密重开(免密只在启动时触发),回到单密码 unlock。

新增 Tauri 命令:`startup_info` / `auto_unlock` / `forget_session`;`create_vault` / `unlock_vault` 增加 `remember: bool` 参数。代码在 `src-tauri/src/lib.rs`。

> **安全权衡(重要)**:勾「记住我」会把主密码明文写进本机应用配置目录(独立于云端 vault,不上传)。这是用本地便利换一点本地安全,符合"本机可信、云端密文"的威胁模型,与 QQ/微信在可信设备上存登录态同理。默认**不勾**。若日后要更稳,应接 OS keychain(Windows Credential Manager / Tauri stronghold)。

### 3) 锁屏与主界面重叠(截图里上半锁屏、下半主界面)

**原因**:`.lock-screen{display:grid}` 和 `.app{display:flex}` 的优先级盖过了 HTML `hidden` 属性的 `display:none`,`hidden` 从未生效,两块一直同时渲染。

**修法**:`src/styles.css` 顶部加全局规则 `[hidden]{display:none !important;}`,让 `hidden` 始终生效。

---

## v0.2.0 — 厂商预设与表单重设计 (2026-06-21)

### 1) 内置 AI 厂商预设 + 4 种接口规范

- 新增 `src/vendorPresets.js` 模块,内含 10 家内置 AI 厂商的预设数据。
- 厂商选择改为 `<select>` 下拉(含"自定义"选项),选中后自动填充官网、接口规范、端点 URL。
- 接口规范从 2 种扩展为 4 种: OpenAI Chat Completions / OpenAI Responses API / Anthropic Messages / Gemini generateContent。
- 多协议厂商(如 DeepSeek 支持 openai-chat + openai-responses)可自由切换,URL 联动更新。
- 单协议厂商(如 Anthropic)尝试选择不支持的规范时 toast 提示"仅支持 xxx 接口"并自动回退。
- 后端 `vault.rs` 验证已更新: `api_standard` 接受 `""` / `"openai-chat"` / `"openai-responses"` / `"anthropic"` / `"gemini"`。

### 2) 登录界面 Vault 历史列表

- 登录 `choose` 模式下展示最多 10 条最近使用的 vault 路径。
- 后端新增 `VaultHistoryEntry { path, display_name }` + `get_vault_history` / `remove_vault_history` 命令。
- 每次成功解锁/创建后自动更新历史(去重、最新在前、最多 10 条)。
- 点击条目切换到 unlock 模式;× 按钮移除条目;文件不存在显示灰色提示。

### 3) "记住我"从 7 天缩短为 3 天

- `REMEMBER_SECS` 从 `7 * 86400` 改为 `3 * 86400`。
- 每次自动解锁成功后刷新 expires_at(重置 72h 窗口)。
- 过期凭据从 config 中自动清除。
- UI 标签更新为"记住我，3 天内免密打开（仅本机）"。

### 4) 表单字段重设计

- 新顺序: 厂商 → 用途名称 → api_key → 接口规范 + 端点 URL(同行) → 官网 → 标签 → 备注。
- 新增 `website` 字段(`<input maxlength="2048">`)。
- 新增 `api_standard` 下拉(4 个选项)。
- 接口规范与端点 URL 用 `.field-row` 水平布局。
- 所有输入字段 `autocomplete="off"` 禁用浏览器自动填充。

### 5) 详情面板改进

- website 显示为可点击超链接(自动补 `https://`)。
- 接口规范标签改为"支持的接口规范"。
- 编辑/删除按钮缩小(padding 3px 8px, font 12px)。

### 6) Record schema 扩展

- 新增字段: `api_standard: String` (serde default), `website: String` (serde default)。
- 完全向后兼容:旧文件缺这些字段时自动默认空字符串,schema_version 不变。

---

## 已知待优化项(非阻塞)

见 `TODOS.md`:
- CI 跨平台打包发布流水线(tauri-action)
- 完整无障碍审计(屏幕阅读器全流程、对比度逐项、ARIA)

其他设计评审记录的待办(评分见 docs/DESIGN.md 设计决策段):
- 响应式只做到窄窗折叠,键盘优先只做了基本可用
- 占位图标(`src-tauri/icons/` 是纯色块,`gen-icons.mjs` 生成),需真实品牌图标
- 深色模式未做
- KAT 测试向量已 pin(`src-tauri/src/crypto.rs` 的 KAT_EXPECTED),改 KDF 参数前必读该测试注释

## 架构速查(细节看 docs/DESIGN.md)

- `src-tauri/src/crypto.rs` — Argon2id + AES-256-GCM,文件头 magic "KVLT" + 版本 + KDF参数 + salt + nonce + 密文。header 作 AAD 防篡改。
- `src-tauri/src/vault.rs` — 记录 schema(name*/api_key* 必填,vendor/url/api_standard/website/note/tags 可选,uuid 主键)、CRUD、原子写、sha256 冲突检测、.bak 备份。
- `src-tauri/src/lib.rs` — Tauri 命令层 + 会话内存态(解密后的库 + 主密码 + 已加载文件 hash)。冲突检测(D4)在 `persist()`。新增 vault 历史管理 + get_vault_history / remove_vault_history 命令。
- `src/filter.js` — 纯检索逻辑(搜索/厂商/标签叠加),已单测。
- `src/vendorPresets.js` — 内置 AI 厂商预设数据 + 工具函数(getPreset/getSupportedStandards/getEndpointUrl/normalizeUrl/getStandardLabel)。
- `src/main.js` — DOM 控制器(锁屏、三栏渲染、复制反馈、表单、厂商预设自动填充、vault 历史 UI、冲突守卫)。
- `src/index.html` / `src/styles.css` — 三栏 UI + 设计代头(真字体 + 等宽渲染 key/url + 单强调色 + 4/8/16/24 间距)。

## 测试

- `cd src-tauri && cargo test` — 后端 21 测试(需先导出构建环境变量或用 `build.ps1`)
- `bun run test` — 前端 27 测试(filter 逻辑 10 + vendorPresets 17)
- 真实端到端流程**尚未人工验证**,P0 修好后应走一遍:设主密码→存 key→搜→复制→重开→改→删→多设备同步。
