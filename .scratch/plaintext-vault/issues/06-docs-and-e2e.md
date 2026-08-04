# 06 — 文档改写 + 人工 E2E 走查

**What to build:** 让文档与现实对齐：README、DESIGN、HANDOFF 中"本地加密""主密码""丢网盘同步"等过时描述改写为"明文、无密码、可文件夹迁移"的新现实，并指向 CONTEXT.md 与 docs/adr/ 下两份 ADR；CHANGELOG 记录本次变更（含威胁模型变化的明确说明）；TEST-PLAN 更新为无密码流程。最后按新清单完成一次人工端到端走查。

**Blocked by:** 03 — vault 选择页完整版；04 — 前端控制器模块化；05 — 删除 crypto

**Status:** done

- [x] README / DESIGN / HANDOFF 不再包含加密、主密码、网盘同步的描述，改写为新现实并链接 CONTEXT.md 与 ADR
- [x] CHANGELOG 记录变更，明确说明威胁模型变化（明文落盘，由本机账户密码/BitLocker 兜底）
- [x] TEST-PLAN 更新为无密码流程
- [x] 人工走查通过：直进主界面 → 增 → 搜 → 复制 → 改 → 删 → 整个数据文件夹拷到另一路径直接打开使用

## Comments

### 2026-08-04 — 文档改写完成；自动化走查全流程通过，人工确认待用户

- README / DESIGN / HANDOFF / TEST-PLAN / docs/README 全部改写为明文新现实，链接 CONTEXT.md 与 ADR-0001/0002；CHANGELOG 新增 0.3.0 条目（含威胁模型变化说明）；版本同步 0.3.0（package.json / tauri.conf.json / Cargo.toml，cargo check 通过）；CONTEXT.md 记录字段同步为 endpoints 映射。
- 自动化走查（真实浏览器 + 真实文件 I/O 桥接，全程零 JS 错误）：无 last_path 启动 → 选择页（0 密码输入框）→ 新建 vault 直进主界面（空状态 + 文件真实落盘 `{schema_version:1, records:[]}`）→ 增（DeepSeek 预设联动官网/URL/双规范）→ 搜（命中/无结果空态/清除）→ 复制（✓ 已复制 + toast + 剪贴板值 + URL 复制 + key 遮罩）→ 改（回填 + 落盘）→ 删（确认 + 文件清空）→ 整个文件夹真实拷贝 walkA→walkB → 切换 vault 打开 walkB（数据完整、字节一致）→ 重启直进主界面显示 walkB 数据。
- 待用户：按 TEST-PLAN 的"人工端到端走查清单"在真实 Tauri 应用上走一遍并确认（自动化走查用 stub 模拟了后端命令，真实桥接仍需人工过目）。
- 2026-08-04 用户确认人工走查通过，ticket 完成。
