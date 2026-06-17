# TODOS

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
