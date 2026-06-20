# Changelog

## [0.2.0] — 2026-06-21

### 新增

- **内置 AI 厂商预设 (Vendor Presets)**
  - 10 个内置厂商：OpenAI、Anthropic、Google、DeepSeek、Moonshot、Zhipu、Baichuan、Minimax、01.AI、xAI
  - 选择厂商后自动填充官网 URL、接口规范、端点 URL
  - 厂商从文本输入改为下拉选择器（仍可选"自定义"手动填写）

- **4 种 API 接口规范**
  - OpenAI Chat Completions (`/v1/chat/completions`)
  - OpenAI Responses API (`/v1/responses`)
  - Anthropic Messages (`/v1/messages`)
  - Gemini Native generateContent
  - 多协议厂商（如 DeepSeek、OpenAI、Google）可在支持的规范间切换，URL 自动更新
  - 仅支持单一规范的厂商（如 Anthropic）切换到不支持的规范时 toast 提示"仅支持 xxx 接口"

- **登录界面 Vault 历史列表**
  - 最多展示 10 条最近使用的 vault 路径（类似微信历史账号）
  - 点击即可切换到该 vault 的解锁模式
  - 支持移除条目（×按钮）
  - 文件不存在时显示"文件不存在"标签

- **Record schema 扩展**
  - 新增 `api_standard` 字段（存储接口规范标识）
  - 新增 `website` 字段（厂商官网 URL，最长 2048 字符）
  - 完全向后兼容：旧 vault 文件中缺失的字段自动默认为空字符串

- **官网字段渲染为可点击链接**
  - 详情面板中 website 字段显示为超链接，点击在系统默认浏览器中打开
  - 自动补全 `https://` 前缀

### 变更

- **"记住我"有效期从 7 天缩短为 3 天 (72 小时)**
  - 每次成功自动解锁后重置 72 小时计时器
  - 过期凭据自动从配置中清除
  - 界面标签更新为"记住我，3 天内免密打开（仅本机）"

- **表单字段重新排序**
  - 新顺序：厂商 → 用途名称 → api_key → 接口规范+端点 URL → 官网 → 标签 → 备注
  - 接口规范选择器与端点 URL 在同一行显示

- **禁用浏览器自动填充**
  - 所有敏感字段设置 `autocomplete="off"`，防止浏览器弹出自动填充建议

- **详情面板显示优化**
  - 接口规范标签改为"支持的接口规范"
  - 编辑/删除按钮缩小

### 技术改动

- 新增 `src/vendorPresets.js` 模块（preset 数据 + 工具函数）
- 新增 `src/vendorPresets.test.js`（17 个单元测试）
- 后端新增 `VaultHistoryEntry` 结构体、`get_vault_history` / `remove_vault_history` Tauri 命令
- 后端验证扩展：`api_standard` 接受 `""` / `"openai-chat"` / `"openai-responses"` / `"anthropic"` / `"gemini"`
- CSS 新增 `.field-row` / `.field-narrow` / `.field-wide` / vault 历史列表样式

---

## [0.1.0] — 2026-06-18

### 初始版本

- 本地加密 API Key 收纳工具
- AES-256-GCM + Argon2id 加密
- 三栏布局：厂商/标签筛选 → 记录列表 → 详情面板
- 记录 CRUD（用途名称 + api_key 必填）
- 搜索/厂商/标签三路筛选
- 一键复制 + 剪贴板自动清空（30 秒）
- 多设备冲突检测（保存前哈希比对）
- 原子写 + .bak 备份
- "记住我"短期免密登录
- 明文导出逃生口
