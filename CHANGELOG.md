# Changelog

## 0.2.0 — 2026-10-24

- 规范化为标准 DSH bundle 结构：`src/` → `lib/` 构建、`dsh.manifestVersion: 1`、`engines.dsh`、`dsh.client` 注入、`icon`、`repository` 等 manifest 字段。
- 包内 `lib/preload.mjs` 由 Host 每次启动部署到 `$DSH_HOME/startup-orchestrator/preload.mjs`；不再手工复制 preload。
- 按标准 profile 安装方式验证（packed tarball → `dsh plugin add`）；`files` 白名单只包含运行产物。
- 修复启动编排在入口被误置 `disabled`、热挂载入口被永久登记、面板 ↑/↓ 排序无效的问题（0.1.x 期间的修复一并收录）。
- 增加构建校验（语法 + client loader id = 包名）与三组回归测试。

## 0.1.0 — 2026-10-23

- 初始版本：三组启动编排、设置面板、preload 调度、launcher 自愈。
