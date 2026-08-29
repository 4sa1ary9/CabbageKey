# Changelog

## [Unreleased] — 2026-08-29 全量评审整改

### 修复

- **剪贴板误清**：复制后的 30 秒自动清空先比对剪贴板内容，仅当仍是本应用写入的值才清空——不再清掉用户期间在其它应用复制的内容。
- **双击重复提交**：新增/编辑保存期间禁用保存按钮并忽略重复 submit，不再产生重复记录。
- **官网长度上限单位不一致**：后端改按字符数（原按 UTF-8 字节数），与前端 maxlength 同单位，中文 URL 不再被误拒。
- **窄窗口详情死路**：窗口最小宽度 720→860，详情面板（复制/编辑/删除入口）在任何允许的窗口宽度下都可达。
- **无厂商记录不可达**：左栏新增"未分组"项（确有无厂商记录时出现，可筛选、不参与厂商排序持久化）；厂商/标签被删光后失效筛选自动复位。

### 新增/改进

- 搜索覆盖 api_key 与端点 URL（"只记得 key 的一段"可反查）。
- 详情面板显示创建/更新时间（本地时间；老 vault 缺失时不显示）。
- api_key 显示后 30 秒自动回掩码（与剪贴板清空同一防护窗口）。
- 已填端点 URL 时切换厂商先确认；取消则回退厂商值。
- 对话框：厂商字段 Enter 改为确认并跳下一字段（不再直接提交表单）；backdrop/Esc 关闭前若有未保存修改先确认；复制反馈去重（按钮态 + toast 只提示自动清空）。
- config.json 写盘改原子写（tmp+rename，与 vault 同一纪律）。
- 单实例：二次启动聚焦已有窗口，杜绝双实例写同一 vault 互相覆盖（tauri-plugin-single-instance）。
- 搜索/揭示图标与按钮从 emoji 换成描边 SVG；应用图标从纯色占位换成品牌图标（青绿渐变 + 钥匙孔）。
- 详情面板事件改为一次性委托、选中记录不再整树重渲染（保住滚动位置与焦点）。

## [0.3.0] — 2026-08-04

### ⚠️ 破坏性变更：明文化重构（威胁模型变化）

**vault 从此是明文 JSON，不再加密。** API key 明文落盘，任何能读本机硬盘的程序 / 人 / 备份软件都可取得 key 原文；兜底是本机账户密码 / BitLocker 全盘加密，与 `~/.aws/credentials`、`~/.ssh` 明文私钥同级（用户已知情接受，见 `docs/adr/0002-plaintext-storage-no-password.md`）。

**不要把 vault 文件放进网盘 / 云同步目录**——明文一旦上传即泄露。迁移 = 拷贝文件夹，不是同步。

### 删除

- **整个加密层**：Argon2id / AES-256-GCM / KAT 固定向量测试、crypto 模块（仓库不再含任何加密代码）
- **主密码与锁屏**：锁屏三模式（choose/unlock/create）、解锁/创建需密码、错误密码报错
- **"记住我 / 免密登录"**：config.json 中的 remember 凭据、auto_unlock、forget_session
- **网盘同步设计**：sha256 冲突检测、保存前哈希比对警告、`.bak` 自动备份
- **明文导出命令**（vault 本身就是明文）、CRUD 命令的 `force` 参数
- **依赖**：aes-gcm / argon2 / rand / zeroize / sha2 / base64 / hex
- **一次性迁移工具** `migrate_vault`（已完成使命：旧加密 vault → 明文 JSON，用户已核对迁移数据）

### 新增

- **无密码启动**：上次 vault 存在时启动直进主界面，全程无密码
- **vault 选择页**：打开已有 / 新建 / 最近历史（最多 10 条、失效置灰、单条移除），主界面内"切换 vault"入口
- **明文格式 golden test**：逐字节冻结磁盘 JSON（schema_version 1），接替原 KAT"防静默改格式"的角色
- **前端控制器模块化**：薄 DOM 壳 + 纯逻辑模块（filter / vendorPresets / formState / history，全部有单测）

### 保留

- 厂商预设（10 家）、4 种接口规范 + endpoints 映射、官网超链接
- 三栏 UI（筛选 / 列表 / 详情）、标签 / 备注 / 搜索三路筛选
- 字段级一键复制 + 剪贴板自动清空（30 秒）
- 原子写（tmp+rename，防崩溃半截文件）；防数据丢失 = 原子写 + 用户自己的备份习惯

---

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
