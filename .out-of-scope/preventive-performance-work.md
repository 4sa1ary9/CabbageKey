# Preventive Performance Work

KeyVault 不做未经测量的预防性性能优化（列表渲染与拖拽排序管线）。

## Why this is out of scope

产品形态是单机自用的 API key 收纳工具，现实数据量是几十到几百条记录（DESIGN.md："单人自用工具"；AGENTS.md："Simplicity First / 不会过度设计的代码才算好"）。在这个量级上：

- 状态变化时的全量 innerHTML 重渲染（rail + 列表 + 详情一次重建）耗时在个位数毫秒级；"state → 全量 render"的简单性本身是特性，引入增量 diff/虚拟列表只增加复杂度，无可感知收益。
- 拖拽排序在每次指针移动时读取全列表几何，数百行远低于一帧预算；"拖起时缓存一次几何"只在数千行时才有意义。

重新评估条件：真实使用中出现数千条记录或可感知卡顿——先测量（DevTools performance profile），再凭数据重新立项。

## Prior requests

- `.scratch/review-2026-08/issues/14-preventive-performance-work.md`（2026-08-29 全量代码评审，AI triage 归档）
