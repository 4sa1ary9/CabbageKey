# 01 — 详情页展示整改

**What to build:** 详情面板的信息顺序改为"厂商 → 官网 → api_key → 支持的接口规范 → 端点 URL → 标签 → 备注"（厂商/官网置顶，字段缺失时仍按现状省略）；api_key 遮盖串从 12 个 `•` 改为 24 个 `•`（显示与隐藏两处一致）。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 详情页字段顺序为新顺序（厂商在最上，官网次之，然后 api_key）
- [ ] 无厂商/无官网的记录不显示对应字段（现状行为保留）
- [ ] api_key 遮盖态显示 24 个 `•`，点击"显示"后正常露出真实值，再点"隐藏"回到 24 点
- [ ] `npm test` 与 `vite build` 通过
