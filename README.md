# KeyVault

本地、无密码的 API key 收纳工具。完全本地单机：所有记录以明文 JSON 存于单个 vault 文件（人类可读），打开即用，拷贝整个数据文件夹到另一台机器即可直接使用。无主密码、无加密、无网盘同步——安全姿态与 `~/.aws/credentials` 同级，由本机账户密码 / BitLocker 兜底（威胁模型见 `docs/adr/0002-plaintext-storage-no-password.md`）。

## 架构

- **前端**：Vite + 原生 JS（三栏布局：筛选 / 列表 / 详情）
- **后端**：Tauri 2 (Rust)
- **数据**：单个明文 JSON vault 文件，整读入内存、原子写回（tmp+rename，防崩溃半截文件）
- **启动**：自动打开上次使用的 vault 直进主界面；无历史或文件缺失时进入选择页（打开已有 / 新建 / 最近历史）
- **迁移**：拷贝 vault 文件（或整个文件夹）到另一台机器即可直接打开使用，无密钥、无账号依赖

每条记录：`用途名称*` + `api_key*`（必填）+ 厂商 / 端点 URL（按接口规范分别保存）/ 接口规范 / 官网 / 备注 / 标签（可选）。

内置 10 家 AI 厂商预设（OpenAI、Anthropic、Google、DeepSeek 等），选择后自动填充端点 URL 和官网。支持 4 种接口规范：OpenAI Chat Completions、OpenAI Responses API、Anthropic Messages、Gemini generateContent。

> 术语与产品定位以 `CONTEXT.md` 为准；关键决策见 `docs/adr/0001-keep-rust-tauri-stack.md`（保持技术栈）与 `docs/adr/0002-plaintext-storage-no-password.md`（明文化、删加密）。

## 开发前置（需自行安装）

Tauri 2 需要本机具备：

1. **Rust**：`https://rustup.rs` 安装 rustup（含 cargo）
2. **MSVC C++ Build Tools**（Windows）：安装 "Visual Studio Build Tools"，勾选 "Desktop development with C++"
3. **WebView2 运行时**：Windows 11 通常已内置
4. **Node + bun**：本仓库前端用 bun

## 命令

```bash
bun install              # 装前端依赖
bun run test             # 前端单元测试（filter / vendorPresets / formState / history）
bun run dev              # 仅前端开发服务器（无 Tauri 后端）
bun run tauri dev        # 完整应用（需 Rust 工具链）
bun run tauri build      # 打包安装产物（需 Rust 工具链）

cd src-tauri && cargo test   # Rust 后端测试（vault CRUD + 明文格式 golden test）
```

> **Windows 构建提示**：本机 MSVC 可能未在全局 PATH 中。使用项目根目录的 `build.ps1`（需 PowerShell 7 / pwsh）自动定位 vcvars64.bat 并构建，或手动在 VS Developer Command Prompt 中执行 `bun run tauri build`。

## 测试覆盖

- `src/filter.test.js`：检索逻辑（搜索/厂商/标签叠加、空状态判定）— 10 测试通过
- `src/vendorPresets.test.js`：厂商预设数据、工具函数（getPreset/getSupportedStandards/getEndpointUrl/normalizeUrl）— 17 测试通过
- `src/formState.test.js`：表单状态机（预设联动、接口规范 toggle、提交载荷构建与校验）— 25 测试通过
- `src/history.test.js`：vault 历史列表标注（文件存在性驱动置灰）— 4 测试通过
- `src-tauri/src/vault.rs`：CRUD、必填校验、api_standard 验证、website 长度验证、重名按 id 区分、分组/标签去重、JSON round-trip、**明文格式 golden test**（逐字节冻结磁盘 JSON，schema_version 1）、历史列表（去重/上限/display_name）

## 待办

见 `TODOS.md`：CI 跨平台打包发布流水线、完整无障碍审计。

## 更新日志

见 `CHANGELOG.md`。

## 文档

- `CONTEXT.md` — 术语与产品定位（Vault / 记录 / 厂商预设 / 接口规范 / 迁移）
- `docs/adr/` — 架构决策记录（ADR-0001 技术栈、ADR-0002 明文化无密码）
- `docs/HANDOFF.md` — 交接文档（当前状态、构建环境、架构速查、已知待优化项）
- `docs/DESIGN.md` — 设计文档（问题陈述、架构决策、三栏 UI、故障模式）
- `docs/TEST-PLAN.md` — QA 测试计划（含人工端到端走查清单）

接手优化先读 `docs/HANDOFF.md`。
