# KeyVault

本地加密的 API key 收纳工具。完全本地，数据以单个加密文件存储，可丢进网盘（坚果云/Dropbox）在多设备间同步。

## 架构

- **前端**：Vite + 原生 JS（三栏布局：筛选 / 列表 / 详情）
- **后端**：Tauri 2 (Rust)
- **加密**：AES-256-GCM + Argon2id（RustCrypto），KDF 参数随文件存储
- **数据**：单个加密 JSON blob，整读入内存、原子写回
- **同步**：外包给网盘，靠"出门前已加密"保证安全，打开/保存时哈希检测冲突

每条记录：`用途名称*` + `api_key*`（必填）+ 厂商 / url / 备注 / 标签（可选）。

## 开发前置（需自行安装）

Tauri 2 需要本机具备：

1. **Rust**：`https://rustup.rs` 安装 rustup（含 cargo）
2. **MSVC C++ Build Tools**（Windows）：安装 "Visual Studio Build Tools"，勾选 "Desktop development with C++"
3. **WebView2 运行时**：Windows 11 通常已内置
4. **Node + bun**：本仓库前端用 bun

## 命令

```bash
bun install              # 装前端依赖
bun run test             # 前端单元测试（filter 逻辑）
bun run dev              # 仅前端开发服务器（无 Tauri 后端）
bun run tauri dev        # 完整应用（需 Rust 工具链）
bun run tauri build      # 打包安装产物（需 Rust 工具链）

cd src-tauri && cargo test   # Rust 后端测试（crypto KAT + vault CRUD）
```

## 首次跑 cargo test 时

`crypto.rs` 的 KAT（known-answer test）首次会**故意失败**并打印真实派生密钥的 hex。把该值填入 `KAT_EXPECTED`、把 `KAT_PINNED` 设为 `true`，之后这个值被冻结——任何意外改动 KDF 都会让测试变红，防止老 vault 静默解不开。

## 测试覆盖

- `src/filter.test.js`：检索逻辑（搜索/厂商/标签叠加、空状态判定）— 10 测试通过
- `src-tauri/src/crypto.rs`：KAT、round-trip、错误密钥、篡改拒绝、nonce 唯一、坏 magic、截断
- `src-tauri/src/vault.rs`：CRUD、必填校验、重名按 id 区分、分组/标签去重、JSON round-trip、sha256

## 待办

见 `TODOS.md`：CI 跨平台打包发布流水线、完整无障碍审计。
