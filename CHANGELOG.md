# Changelog

## 0.2.2 — 2026-10-25

- 适配 DSH **0.2.1-rc.3**：`engines.dsh` 与 `@deepseek-ai/dsh-client-ui-settings`、`@deepseek-ai/dsh-host-webserver` 两个 peer 从精确 pin `0.2.1-rc.2` 放宽为 `^0.2.1-rc.2`。
  - 修复两道兼容门槛同时不满足导致启动编排静默失效：Portable launcher 的 `pauseIncompatibleProfileBundles`（按 peerDependencies 检查）会把本插件从 profile `dsh.profile.bundles` 暂停移除；app-boot 的 `engines.dsh` 门槛同样不满足。
  - rc.3 自带的 semver（`includePrerelease: true`）判定 `^0.2.1-rc.2`：`0.2.1-rc.3` / `0.2.1-rc.4` / `0.2.2` = true，`0.3.0` = false。
- 复核 preload 对 `cordis-plugin-loader@1.0.6` 的补丁点：`Entry.prototype.init/_init`、`_initTask ??= this._init()`、`Entry.parent/tree` 与 `entries()`、`internal/plugin` 监听器置 `options.disabled = true` 的逻辑、root 上下文占位 fiber、`isReleased()` 交还官方 init 全部仍成立，**preload 无需改动**。
- 新增开发期复核脚本：`scripts/check-compat.mjs`（app-boot engines + launcher peer 双门槛，使用宿主自带 semver）与 `scripts/check-loader-compat.mjs`（loader 补丁点静态 + 动态探针）。
- 无用户可见行为变化；设置面板、三组编排与开屏等待逻辑不变。

## 0.2.1 — 2026-10-24

- “等待开机动画”扩展为同时等待 `media-wallpaper` 的开屏动画：读取其 `dsh-plugin-media-wallpaper.settings.v1`，启用且已选媒体时观察 `[data-wp-intro]` 层，播完/撤层后才放行常用组。
- 仅当 `media-wallpaper` 位于②开机启动项时生效；若在③常用组则自动跳过（避免等它自己造成死锁）。
- 未启用开屏、未安装或未打包该插件时行为不变；新增 `media-intro-gate` 测试与页面注入脚本解析测试。

## 0.2.0 — 2026-10-24

- 规范化为标准 DSH bundle 结构：`src/` → `lib/` 构建、`dsh.manifestVersion: 1`、`engines.dsh`、`dsh.client` 注入、`icon`、`repository` 等 manifest 字段。
- 包内 `lib/preload.mjs` 由 Host 每次启动部署到 `$DSH_HOME/startup-orchestrator/preload.mjs`；不再手工复制 preload。
- 按标准 profile 安装方式验证（packed tarball → `dsh plugin add`）；`files` 白名单只包含运行产物。
- 修复启动编排在入口被误置 `disabled`、热挂载入口被永久登记、面板 ↑/↓ 排序无效的问题（0.1.x 期间的修复一并收录）。
- 增加构建校验（语法 + client loader id = 包名）与三组回归测试。

## 0.1.0 — 2026-10-23

- 初始版本：三组启动编排、设置面板、preload 调度、launcher 自愈。
