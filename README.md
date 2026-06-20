# KeyVault

本地加密的 API key 收纳工具。完全本地，数据以单个加密文件存储，可丢进网盘（坚果云/Dropbox）在多设备间同步。

## 架构

- **前端**：Vite + 原生 JS（三栏布局：筛选 / 列表 / 详情）
- **后端**：Tauri 2 (Rust)
- **加密**：AES-256-GCM + Argon2id（RustCrypto），KDF 参数随文件存储
- **数据**：单个加密 JSON blob，整读入内存、原子写回
- **同步**：外包给网盘，靠"出门前已加密"保证安全，打开/保存时哈希检测冲突

每条记录：`用途名称*` + `api_key*`（必填）+ 厂商 / url / 接口规范 / 官网 / 备注 / 标签（可选）。

内置 10 家 AI 厂商预设（OpenAI、Anthropic、Google、DeepSeek 等），选择后自动填充端点 URL 和官网。支持 4 种接口规范：OpenAI Chat Completions、OpenAI Responses API、Anthropic Messages、Gemini generateContent。

## 开发前置（需自行安装）

Tauri 2 需要本机具备：

1. **Rust**：`https://rustup.rs` 安装 rustup（含 cargo）
2. **MSVC C++ Build Tools**（Windows）：安装 "Visual Studio Build Tools"，勾选 "Desktop development with C++"
3. **WebView2 运行时**：Windows 11 通常已内置
4. **Node + bun**：本仓库前端用 bun

## 命令

```bash
bun install              # 装前端依赖
bun run test             # 前端单元测试（filter + vendorPresets）
bun run dev              # 仅前端开发服务器（无 Tauri 后端）
bun run tauri dev        # 完整应用（需 Rust 工具链）
bun run tauri build      # 打包安装产物（需 Rust 工具链）

cd src-tauri && cargo test   # Rust 后端测试（crypto KAT + vault CRUD）
```

> **Windows 构建提示**：本机 MSVC 可能未在全局 PATH 中。使用项目根目录的 `build.ps1`（需 PowerShell 7 / pwsh）自动定位 vcvars64.bat 并构建，或手动在 VS Developer Command Prompt 中执行 `bun run tauri build`。

## 首次跑 cargo test 时

`crypto.rs` 的 KAT（known-answer test）首次会**故意失败**并打印真实派生密钥的 hex。把该值填入 `KAT_EXPECTED`、把 `KAT_PINNED` 设为 `true`，之后这个值被冻结——任何意外改动 KDF 都会让测试变红，防止老 vault 静默解不开。

## 测试覆盖

- `src/filter.test.js`：检索逻辑（搜索/厂商/标签叠加、空状态判定）— 10 测试通过
- `src/vendorPresets.test.js`：厂商预设数据、工具函数（getPreset/getSupportedStandards/getEndpointUrl/normalizeUrl）— 17 测试通过
- `src-tauri/src/crypto.rs`：KAT、round-trip、错误密钥、篡改拒绝、nonce 唯一、坏 magic、截断
- `src-tauri/src/vault.rs`：CRUD、必填校验、api_standard 验证、website 长度验证、重名按 id 区分、分组/标签去重、JSON round-trip、sha256

## 待办

见 `TODOS.md`：CI 跨平台打包发布流水线、完整无障碍审计。

## 更新日志

见 `CHANGELOG.md`。

## 文档

`docs/` 目录：
- `docs/HANDOFF.md` — 交接文档（当前状态、**已知 P0 bug**、修复建议、构建环境）
- `docs/DESIGN.md` — 完整设计文档（架构决策 D1-D6、三栏 UI、故障模式）
- `docs/TEST-PLAN.md` — QA 测试计划
- `docs/tasks-*.jsonl` — 实现任务清单

接手优化先读 `docs/HANDOFF.md`。
