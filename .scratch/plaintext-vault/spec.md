# KeyVault 明文化重构 Spec（PRD）

Status: ready-for-agent

术语以仓库根目录 `CONTEXT.md` 为准。本 spec 遵守 `docs/adr/0001-keep-rust-tauri-stack.md`（不换技术栈）与 `docs/adr/0002-plaintext-storage-no-password.md`（明文、无密码、删加密层）。

## Problem Statement

项目的唯一用户觉得 KeyVault"不符合预期、也不知道怎么改"：主密码、锁屏、免密登录、网盘同步冲突检测这些功能都不是他想要的，而代码复杂度恰恰集中在这些地方（加密层、会话态、784 行的前端控制器）。他真正想要的是一个**简单的、无密码的本地 API key + url 收纳工具**：打开就用，数据可以通过拷贝文件夹迁移到另一台机器。原始设计前提（"加密文件丢网盘多设备同步"）已经不成立——用户不需要同步，只需要迁移。

## Solution

把 KeyVault 重新定义为：**本地、单机、无密码、明文存储的个人 API key 收纳工具**。

- 打开应用直进主界面（三栏：筛选 / 列表 / 详情），全程无密码、无锁屏。
- Vault 是单个明文 JSON 文件，包含全部记录；迁移 = 拷贝文件（或整个数据文件夹）到另一台机器即可用。
- 删除：整个加密层、锁屏三模式、"记住我/免密"、sha256 冲突检测、`.bak` 备份、明文导出命令（vault 本身就是明文）。
- 保留：厂商预设、4 种接口规范（endpoints 映射）、标签、备注、vault 历史列表、三栏 UI、原子写（防崩溃半截文件）。
- 前端控制器重写为"薄 DOM 壳 + 纯逻辑模块"，UI 决策由用户参与。
- 旧加密 vault 由一次性迁移脚本（用完即弃）解锁导出为新格式。
- 技术栈不变：Rust + Tauri 2 + Vite/原生 JS（ADR-0001）。

## User Stories

1. 作为本机用户，我希望双击图标后直接进入我的 key 列表，以便全程不需要输入任何密码。
2. 作为本机用户，我希望首次启动时能选择 vault 文件的存放位置并创建空 vault，以便数据放在我选的文件夹里。
3. 作为本机用户，我希望启动时自动打开上次使用的 vault，以便不用每次重新选路径。
4. 作为本机用户，我希望上次使用的 vault 文件不存在时看到明确的提示并能另选/新建，以便不会卡在一个打不开的启动画面。
5. 作为本机用户，我希望能从"vault 切换"入口打开另一个路径的 vault 或新建 vault，以便管理多个 vault 文件。
6. 作为本机用户，我希望在切换入口看到最近用过的 vault 历史列表（最多 10 条、可单条移除、失效路径置灰），以便快速回到常用 vault。
7. 作为本机用户，我希望添加一条记录时只需填用途名称和 api_key，以便最快完成收纳。
8. 作为本机用户，我希望选择厂商预设后自动填充官网、支持的接口规范和对应端点 URL，以便少打字、不出错。
9. 作为本机用户，我希望一条记录能按接口规范分别保存端点 URL（endpoints 映射），以便同一厂商多协议切换时各存各的。
10. 作为本机用户，我希望多协议厂商切换接口规范时 URL 联动更新、单协议厂商选不支持的规范时被提示并回退，以便表单始终合法。
11. 作为本机用户，我希望给记录打标签并按标签筛选，以便按项目/用途归类。
12. 作为本机用户，我希望给记录写备注，以便记下额度、到期日等杂项信息。
13. 作为本机用户，我希望能按搜索词 + 厂商 + 标签叠加筛选记录列表，以便快速定位。
14. 作为本机用户，我希望在详情面板一键复制 api_key（并有复制成功反馈），以便粘贴到各处使用。
15. 作为本机用户，我希望官网显示为可点击链接（自动补 https://），以便直接访问厂商控制台。
16. 作为本机用户，我希望编辑和删除记录时只影响目标记录（按 id 区分同名记录），以便数据不被误伤。
17. 作为本机用户，我希望保存时即使应用崩溃也不会得到半个写坏的文件（原子写），以便数据可靠。
18. 作为本机用户，我希望把数据文件夹整个拷到另一台机器后，在那台机器上打开就能直接用，以便完成迁移——无需密码、无需导出导入。
19. 作为本机用户，我希望旧的加密 vault 能通过一个一次性工具（输入一次旧主密码）导出为新的明文 vault，以便不丢失已有数据。
20. 作为本机用户，我希望 vault 文件是人类可读的 JSON，以便我随时可以打开确认里面有什么。

## Implementation Decisions

- **删除的模块与命令**（ADR-0002）：crypto 模块整体（Argon2id/AES-256-GCM/KAT）；会话中的 passphrase 与 loaded_hash 状态；`unlock_vault` / `auto_unlock` / `lock_vault` / `forget_session` / `export_plaintext` 命令；config 中的 `remember` 凭据字段；sha256 冲突检测与 `.bak` 备份；CRUD 命令上的 `force` 参数。
- **vault 模块（后端，改）**：`Vault` / `Record` / `RecordInput` 的 schema 完全不变（schema_version 保持 1，记录字段保持 id/用途名称/api_key/vendor/endpoints/website/note/tags/created_at/updated_at）；`from_json`/`to_json`/CRUD/校验逻辑不变；`to_json` 的输出现在就是磁盘文件本体。保留原子写（tmp+rename，防崩溃）。删除 sha256 工具函数与 `.bak` 备份函数。
- **命令层（后端，改薄）**：会话状态只剩"当前 vault + 路径"。启动流程：`startup_info` 只返回 last_path（不再有 can_auto）；last_path 存在且文件在 → 直接打开进主界面；否则进 vault 选择页（打开/新建/历史列表）。`open_vault(path)` 取代原 unlock——读文件、解析 JSON、载入会话，不需要密码；`create_vault(path)` 写空 vault；切换 vault 就是打开另一个（内存会话直接替换），`close_vault` 清空会话回到选择页。`get_vault_history` / `remove_vault_history` 保留。
- **config（本机应用配置目录）**：保留 `last_path` 与 `vault_history`；删除 `remember`。旧 config 中残留的 `remember` 字段在首次保存后自然消失（反序列化忽略未知字段）。
- **前端（重写控制器）**：删除锁屏相关全部 UI 与状态（choose/unlock/create 三模式、密码框、免密勾选）；新增"vault 选择页"（打开/新建 + 历史列表，复用原历史 UI 逻辑）；主界面三栏与表单逻辑保留；控制器重写为薄 DOM 壳，把可抽的纯逻辑（如预设联动、表单状态）下沉为独立模块。UI 层面的具体取舍由用户参与决定（grilling 共识）。
- **一次性迁移脚本**：临时 Rust bin（放在 src-tauri 下），依赖**现有** crypto 代码：输入旧加密 vault 路径 + 旧主密码 → 解密 → 按同一 schema 写出明文 JSON 到新路径。用完即弃：迁移验证通过后，脚本与 crypto 模块在同一批改动中删除。**顺序约束：脚本必须先可用，再删 crypto。**
- **文件格式承诺**：明文 vault 的 JSON 形状（schema_version 1）自此冻结，由 golden test 把守——接替原 KAT"防静默改格式"的角色。
- **文档更新**（ADR-0002 的 Consequences）：README、DESIGN.md、HANDOFF.md 中"本地加密""丢网盘同步""主密码"相关描述随实现同步改写；CHANGELOG 记录本变更。

## Testing Decisions

好测试的标准：只测模块边界上的外部行为（输入→输出、可观察的副作用），不测内部实现细节。

- **后端接缝：vault 模块（cargo test）**。现有 12 个 CRUD/校验/round-trip 测试基本原样存活（schema 未变）；删除 sha256 测试与 crypto 全部测试（KAT、round-trip、错误密钥、篡改、nonce、magic、截断）；**新增明文格式 golden test**：一份字面量 JSON（含全部字段的代表性记录）→ `from_json` 解析断言字段；构造 vault → `to_json` 断言与字面量逐字节一致——冻结磁盘格式。
- **临时接缝：迁移脚本（CLI/文件边界）**。删 crypto 之前，先用现有代码造一个已知主密码、已知记录的加密 fixture；断言脚本输出的明文 JSON 与该已知内容一致。验证通过后随脚本一起删除（一次性，不进 CI 遗产）。
- **前端接缝：纯逻辑模块（vitest）**。filter（10 个测试）与 vendorPresets（17 个测试）原样不动；控制器重写时抽出的新纯逻辑模块按 `filter.test.js` 的先例（纯函数、直接断言返回值）补测试。
- **Tauri 命令层不加测试接缝**：保持薄壳，逻辑全部下沉到 vault 模块（与现状一致——命令层本就无直接测试）。
- **不引入 DOM/E2E 测试**：维持项目"纯逻辑单测 + 人工走查"的传统；发布前按 TEST-PLAN 的人工清单走一遍新启动流程（直进主界面→增→搜→复制→改→删→换机迁移）。
- Prior art：`src-tauri/src/vault.rs` 的模块内 `#[cfg(test)]`、`src/filter.test.js`、`src/vendorPresets.test.js`。

## Out of Scope

- 换语言、换框架、后端逻辑推倒重写（ADR-0001 已否决）。
- 任何形式的加密、密码、PIN、OS keychain/DPAPI 集成、"伪加密"。
- 网盘同步、多设备、冲突检测（"同步"已明确不等于"迁移"，见 CONTEXT.md）。
- 移动端、CLI、Web 版、浏览器扩展。
- 同时打开多个 vault。
- 既有 TODOS：CI 跨平台打包、完整无障碍审计、品牌图标、深色模式。
- UI 视觉方向的具体定稿（控制器重写是结构性的；视觉/交互细节在实现过程中由用户逐点确认）。

## Further Notes

- 实施顺序硬约束：**迁移脚本可用 → 用户完成旧 vault 迁移并确认 → 才允许删除 crypto 与脚本**。发布的新版本不含任何加密代码。
- 威胁模型变化（用户已知情接受，见 ADR-0002）：API key 明文落盘，任何能读本机硬盘的程序/人/备份软件均可取得原文；兜底是本机账户密码/BitLocker，与 `~/.aws/credentials` 同级。
- `.bak` 删除后，防数据损失依赖两点：原子写（防崩溃半截文件）+ 用户自己的文件夹备份习惯。
- 前端控制器重写是本 spec 中唯一"写新代码"的大块，其余主要是删除——预估代码净减少约 40%。
