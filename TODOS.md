# TODOS

## Completed (v0.2.0)

### 厂商预设与表单重设计
- ✅ 内置 10 家 AI 厂商预设（自动填充端点 URL 和官网）
- ✅ 4 种接口规范（OpenAI Chat/Responses、Anthropic Messages、Gemini generateContent）
- ✅ 登录界面 Vault 历史列表（最多 10 条）
- ✅ "记住我"有效期缩短为 3 天 + 自动刷新
- ✅ 表单字段重排 + 禁用浏览器自动填充
- ✅ Record schema 扩展（api_standard, website）
- ✅ 详情面板：官网渲染为超链接 + 接口规范显示

## Deferred

### 跨平台打包 + GitHub Releases 发布流水线
- **What:** 用 GitHub Actions 自动构建 Windows/Mac 安装包并发布到 GitHub Releases。
- **Why:** 项目目标是"做个能分享的东西"，没有分发渠道别人装不上。
- **Pros:** push tag 即出包；朋友可直接下载安装，真正达成"可分享"。
- **Cons:** 跨平台构建矩阵有坑（签名、公证、各平台产物），现在做会拖慢核心。
- **Context:** 这是 Tauri 2 的本地加密 API key 收纳工具（设计文档见 `~/.gstack/projects/lsz/`）。决定先把本地版做对、功能稳定后再做发布。Tauri 官方有 `tauri-action` GitHub Action 可直接用。
- **Depends on / blocked by:** 本地版能跑通；git 仓库已初始化并推到 GitHub。

### 完整无障碍审计
- **What:** 屏幕阅读器全流程、颜色对比度逐项核对、ARIA 地标的完整无障碍支持。
- **Why:** v1 已覆盖键盘驱动 + 基本对比度/触控目标，但完整 a11y 是更大的活。
- **Pros:** 对色弱、屏幕阅读器、纯键盘用户友好；分享出去受众更广。
- **Cons:** 完整审计需手动测试 + 辅助技术验证，工作量不小。
- **Context:** 设计评审 Pass6 评分 4→7，v1 只做了键盘可用。完整 WCAG 合规需要用真实辅助技术测试 + 专家审查，不是改几行代码能完成的。
- **Depends on / blocked by:** 主界面 UI 实现完成。

### Property-Based Tests (可选增强)
- **What:** 为 8 个正确性属性编写 property-based 测试（Rust proptest + JS fast-check）。
- **Why:** 用随机输入验证不变量（vault 历史 ≤10 且无重复、api_standard 验证边界、序列化 round-trip 等），比手写用例覆盖面更广。
- **Pros:** 自动发现边界 bug；文档化正式正确性规范。
- **Cons:** 需新增依赖（proptest, fast-check）；编写成本中等。
- **Context:** 设计文档定义了 8 条正确性属性（见 `.kiro/specs/vendor-presets-and-form-redesign/design.md` Correctness Properties 段），tasks.md 中标记为可选（`*`）。
- **Depends on / blocked by:** 无阻塞，可随时添加。

### build.ps1 兼容 PowerShell 5
- **What:** `build.ps1` 构建脚本目前仅 PowerShell 7 (pwsh) 兼容，PS5 会因 `&&` 运算符和 UTF-8 中文字符报错。
- **Why:** Windows 默认仍为 PS5；未安装 pwsh 的用户无法使用脚本。
- **Pros:** 降低构建门槛。
- **Cons:** 改动小但需测试。
- **Depends on / blocked by:** 无。
