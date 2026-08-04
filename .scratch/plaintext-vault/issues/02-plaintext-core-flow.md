# 02 — 无密码主流程（tracer bullet）：明文读写 + 启动直进主界面

**What to build:** 端到端打通无密码核心路径。vault 以明文 JSON 直读直写（schema 不变、原子写保留）；会话状态只剩当前 vault 与路径；锁屏、密码、记住我/免密相关的命令与配置全部移除；启动时自动打开上次使用的 vault，没有则显示简版选择页（打开已有 / 新建）；三栏主界面的增删改、搜索筛选、厂商预设联动、复制 api_key 全部照常工作；保存即明文落盘。新增 golden test 冻结磁盘 JSON 格式，接替原 KAT"防静默改格式"的角色。cargo test 与 vitest 全绿。

**Blocked by:** None — can start immediately（与 01 触及不同代码，可并行）

**Status:** done

- [x] 启动应用：上次 vault 存在则直进主界面；否则出现"打开已有 / 新建"选择页，全程无密码输入
- [x] 增/改/删记录后，vault 文件为人类可读的明文 JSON，字段与既有 schema（含 endpoints 映射）一致
- [x] golden test：代表性 JSON 字面量与解析/序列化双向一致，冻结磁盘格式
- [x] 冲突检测、.bak 备份、force 参数、免密凭据相关命令与配置全部移除
- [x] 原 crypto 模块保留在仓库中（01 的迁移工具仍依赖它），但应用主路径不再调用
- [x] cargo test 全绿、vitest 全绿

## Comments

2026-08-03 完成（commit 见 feat/plaintext-core-flow 分支）。实现要点：

- 后端命令层重写（src-tauri/src/lib.rs）：删除 unlock_vault / auto_unlock / lock_vault / forget_session / export_plaintext、remember 凭据、冲突检测（sha256 + disk_changed）、.bak 备份、force 参数；新增 open_vault / close_vault，create_vault 不再要密码，startup_info 只返回 last_path。
- vault.rs：endpoints 由 HashMap 改为 BTreeMap（HashMap 迭代序随机会让 golden 测试逐字节断言不稳定；JSON 形状不变，仅键序变为确定排序）；删除 sha256_hex / backup_existing；新增 golden test（含全字段代表性记录 + 空库），双向冻结磁盘格式。
- 前端：锁屏三模式（choose/unlock/create）整体删除，换成简版选择页（打开已有 / 新建两个按钮 + 错误区）；启动流程 startup_info → vault_exists → open_vault 直进主界面，last_path 文件缺失时选择页显示提示；删除冲突守卫、明文导出、锁定按钮、历史列表 UI（历史后端命令按 spec 保留，供 03 使用）。
- crypto 模块与迁移工具原样保留；迁移工具测试同步 BTreeMap 类型。
- 验证：cargo test 21+4 全绿，vitest 27/27 全绿，vite build 与 cargo build 通过，code-review 两轴无阻塞项。

待办（后续 ticket）：03 恢复选择页历史列表与主界面切换入口（get_vault_history / remove_vault_history / close_vault 命令已就绪）；04 前端控制器模块化；06 文档改写（README/DESIGN/HANDOFF/TEST-PLAN，含 ADR-0002 措辞补"迁移工具例外"）。
