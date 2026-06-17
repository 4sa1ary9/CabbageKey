# KeyVault — 交接文档（给下一个做优化的 agent）

> 本文档面向接手 KeyVault 做优化/修复的 agent。先读这份,再读 `docs/DESIGN.md`(完整设计与决策依据)和 `README.md`(构建步骤)。

## 项目一句话

完全本地的加密 API key 收纳工具。数据存成单个 AES-256-GCM 加密文件,丢网盘(坚果云/Dropbox)多设备同步。Tauri 2 + Rust 后端 + 原生 JS 三栏前端。

## 当前状态(2026-06-17)

- 代码全部写完,**编译通过**,Rust 21/21 测试过,前端 10/10 测试过。
- Release 已打包:`src-tauri/target/release/` 下有 `keyvault.exe` + `.msi` + nsis `.exe` 安装器。
- 已推到 https://github.com/4sa1ary9/CabbageKey.git
- **但真实运行体验未通过**:用户首次启动就卡在"无法创建 vault 文件"——见下方 P0 bug。

## 构建环境(重要)

本机 MSVC 没进全局 PATH,`cargo build` 前必须导出环境变量。完整变量见 `~/.claude` 记忆 `keyvault-build-env`,或:

```bash
export MSVC="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207"
export SDK="/c/Program Files (x86)/Windows Kits/10"
export PATH="$HOME/.cargo/bin:$MSVC/bin/Hostx64/x64:$SDK/bin/10.0.26100.0/x64:$PATH"
export LIB="$MSVC/lib/x64:$SDK/Lib/10.0.26100.0/um/x64:$SDK/Lib/10.0.26100.0/ucrt/x64"
export INCLUDE="$MSVC/include:$SDK/Include/10.0.26100.0/ucrt:$SDK/Include/10.0.26100.0/um:$SDK/Include/10.0.26100.0/shared:$SDK/Include/10.0.26100.0/winrt:$SDK/Include/10.0.26100.0/cppwinrt"
```

前端:`bun install` / `bun run test` / `bun run build`。
完整应用:`bun run tauri dev`(开发)/ `bun run tauri build`(打包)。

---

## P0 BUG — 首次创建 vault 走不通(用户实测卡死)

**症状**:用户首次启动,无法新建 vault 文件。手动建了个空 `.vault` 后报 `vault file is truncated or corrupt`。

**根因**(已定位,在 `src/main.js`):
1. `state.isNewVault` 启动默认 `false`(main.js 顶部 state 初始化)。
2. `onBrowse()`(main.js:40)用 `state.isNewVault` 决定弹 saveDialog 还是 openDialog。因默认 false,首次点"浏览"弹的是 **openDialog**,只能选已存在的文件,无法指定新文件名。
3. 用户被迫手动建空文件 → `vault_exists` 返回 true → `refreshLockMode` 设 `isNewVault=false` → 点按钮走 `unlock_vault` → 后端 `decrypt_vault` 读到空文件(<45字节) → `crypto::CryptoError::Truncated`。

**死循环本质**:没有路径就没法判断 isNewVault,但拿不到"新文件"路径,因为 openDialog 不让建新文件。`refreshLockMode` 只在 `vault-path` input 事件触发,首屏空路径时按钮停在默认"解锁"态。

**建议修法(任选其一或组合)**:
- A) 把"新建 vault"和"打开已有 vault"做成两个**显式入口/标签页**,而不是靠探测文件是否存在自动切换。新建走 saveDialog,打开走 openDialog。这是最干净的修法,消除探测的歧义。
- B) `onBrowse` 默认用 saveDialog(允许输入新文件名),无论 isNewVault。saveDialog 选已存在文件也能解锁。
- C) 后端 `unlock_vault` 遇到 0 字节/truncated 文件时,返回一个可识别的错误码,前端据此提示"该文件是空的,是否新建?"并切到创建流程。

推荐 A——符合设计文档 D3 的"首次运行流程"本意,也最不容易再出歧义。相关代码:`src/main.js` 的 `refreshLockMode`/`onBrowse`/`onUnlock`,`src/index.html` 的锁屏区,`src-tauri/src/lib.rs` 的 `vault_exists`/`create_vault`/`unlock_vault`。

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
- `src-tauri/src/vault.rs` — 记录 schema(name*/api_key* 必填,vendor/url/note/tags 可选,uuid 主键)、CRUD、原子写、sha256 冲突检测、.bak 备份。
- `src-tauri/src/lib.rs` — Tauri 命令层 + 会话内存态(解密后的库 + 主密码 + 已加载文件 hash)。冲突检测(D4)在 `persist()`。
- `src/filter.js` — 纯检索逻辑(搜索/厂商/标签叠加),已单测。
- `src/main.js` — DOM 控制器(锁屏、三栏渲染、复制反馈、表单、冲突守卫)。
- `src/index.html` / `src/styles.css` — 三栏 UI + 设计代头(真字体 + 等宽渲染 key/url + 单强调色 + 4/8/16/24 间距)。

## 测试

- `cd src-tauri && cargo test` — 后端 21 测试(需先导出构建环境变量)
- `bun run test` — 前端 10 测试(filter 逻辑)
- 真实端到端流程**尚未人工验证**,P0 修好后应走一遍:设主密码→存 key→搜→复制→重开→改→删→多设备同步。
