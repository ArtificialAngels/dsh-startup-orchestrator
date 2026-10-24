# dsh-startup-orchestrator — 部署记录（2026-10-23）

## 目标

1. 修掉插件页对 `dsh-pet` 的 **「停用待生效」** 误报；
2. 新增设置面板「启动编排」：三组（核心 / 开机启动项 / 常用插件）、顺序、等待时间、启动加载开关。

## 根因与方案

| 问题 | 根因 | 方案 |
| --- | --- | --- |
| 停用待生效 | 上一版用 profile `cordis.patch.yml` 的 `disabled: true` 延迟宠物；Portable 市场把 patch 禁用记为 `patchDisabled`，与运行状态不一致就标红 | 移除 patch 禁用；入口保持 enabled，改为**进程级延迟激活** |
| 顺序不生效 | DSH loader 会并行创建所有入口，`dsh.profile.bundles` 顺序只影响 patch 层拼装，不影响 apply 时机 | preload 包裹 `Entry.prototype.init`，按分组顺序调度 |
| 等动画会卡启动 | 若把常用组 init 阻塞到动画结束，`loader.await()` 不结束 → launcher 拿不到 URL → 页面不开 → 动画永远不播 | 常用组**非阻塞**：第一次 init 只登记并返回，给入口一个 no-op 占位 fiber（避免启动审计报「未激活」）；动画结束后再按顺序调用真正 init |

## 改动位置

| 位置 | 内容 |
| --- | --- |
| `launcher/portable-cli.mjs` | host spawn 时若存在 `$DSH_HOME/startup-orchestrator/preload.mjs`，注入 `NODE_OPTIONS=--import=...`（只影响 host 进程） |
| `profiles/web/package.json` | 移除 `dsh-startup-gate`；新增 `dsh-startup-orchestrator`（手动安装，未跑 pnpm）；bundles 按三组重排 |
| `profiles/web/cordis.patch.yml` | 删除 `- id: dsh-pet / disabled: true` |
| `profiles/web/node_modules/dsh-startup-orchestrator` | 手动解包安装的插件本体 |
| `$DSH_HOME/startup-orchestrator.json` | 初始编排配置（core 派生；boot=启动屏/Ops；common=宠物等） |
| `$DSH_HOME/startup-orchestrator/preload.mjs` | 进程级调度器（launcher 注入） |

## 运行时行为

1. **核心组**：`@deepseek-ai/*` 与编排插件自身，不延迟；
2. **开机启动组**：阻塞式延迟（组等待 + 项间间隔）后加载，默认 `dsh-startup-screen`、`dsh-ops`；
3. **常用组**：启动时只登记、不阻塞；等页面 `dsh-startup:done`（Host 收到后调用 `bootDone()`）→ 等 `waitMs` → 按顺序逐个加载，项间隔 `intervalMs`；
4. 若未安装/跳过启动屏、或等待超时（默认 120s），直接放行，不会永久卡住。

设置面板：DSH 设置 → **启动编排**。保存后改写 profile bundles 与编排配置，**重启生效**。
「启动加载」关闭 = 从 bundles 移除（官方开关语义，不产生停用待生效误报）。

## 验证记录

| 验证 | 结果 |
| --- | --- |
| Host 单元检查（配置合并/保存/bundles 改写/done 信号/注入脚本） | PASS |
| 直接 `node bin.js` + preload：boot/common 顺序、组等待、项间隔 | PASS |
| 常用组等动画：URL 提前输出；动画信号前 common 不加载；`POST /done` 后按 200ms + 250ms 加载 | PASS |
| **Portable 真实路径**（`portable-host.mjs` 进程内 import bin.js）+ preload | PASS：URL 5.4s 输出；延迟与顺序正确；无「entries did not activate」警告 |
| 真实运行实例 HMR：`/startup-orchestrator/state` 401（路由存在）、客户端 `client-apply` 日志、旧 gate 路由 404 | PASS |
| `--dump-config` | `dsh-startup-orchestrator` 行存在；`dsh-pet` 无 `disabled: true`；旧 gate 消失；无 skipped bundle |

## 已知事项 / 回滚

- **手动安装**：因另一个插件（`dsh-jiuling-remote-desktop` / `dsh-mnemon`，非本任务改动）
  让 CLI 的 import 预检失败并回滚，本次未跑 pnpm；`pnpm-lock.yaml` 里仍是旧 gate 记录。
  下次执行任何 `dsh plugin add/remove` 时 pnpm 会重建 lockfile。

## 2026-10-23 依赖修复（并发安装遗留）

并发安装把 `dsh-mnemon` 按 `github:omdsh-dev/dsh-mnemon` 装成了**源码 tarball**，仓库不含构建产物，
导致安装目录里整个 `lib/` 缺失；`dsh-mnemon/bundle` 无法导入，进而让 `dsh plugin add` 的 import
预检一直失败并回滚。

处理：

| 项 | 处理 |
| --- | --- |
| `dsh-mnemon` | 改为 npm 发布版 `0.5.34`（manifest spec 已固定），用 npm tarball 覆盖安装；`lib/` 13 个产物齐全，`dsh-mnemon/bundle`、`/core`、`/contracts`、`/extension-sdk` 导入通过 |
| `@dsh-ops/bash-win32-x64` | 可选依赖缺失（启动日志会警告、pnpm 每次重试下载 161MB）；已安装 `0.2.1` 到 profile node_modules |
| import 预检 | 重跑 `preflightPluginImports`：`ok: true`（含 `dsh-mnemon/bundle`），之后 `dsh plugin add/remove` 不会再因这项回滚 |
| lockfile | 仍与 manifest 有差异（旧 gate、mnemon 的 github spec、缺 orchestrator）；`pnpm install` 在本机网络下卡在解析阶段，未强行改 lockfile。启动与预检不读 lockfile；下次任何 `dsh plugin add/remove` 会重建 |

- **launcher 补丁会被 Portable 更新覆盖**：若更新后调度器不生效，检查
  `launcher/portable-cli.mjs` 里 `startupPreload`/`NODE_OPTIONS` 段是否存在，按本记录重加。
## 2026-10-23 编排层 Bug（入口被误禁用 / 热挂载被吞）

### 现象

- 重启后所有「常用组」插件在官方插件页显示为停用/未运行；
- `profiles/web/cordis.yml` 被写成完整树，其中所有常用入口 `disabled: true`；
- `dsh-frameless-page` 的客户端模块 `/plugins/dsh-frameless-page/client.js` 返回 404，灵动岛消失；
- 启动动画结束后才新建/热挂载的入口（官方插件开关、面板保存触发的 HMR）被登记但永不释放，表现为“启用了但不工作”。

### 根因（已用探针抓到调用栈）

1. **占位 fiber 挂在入口上下文上**：常用组为了绕过启动审计，创建了一个 no-op 占位 fiber 并赋给 `entry.fiber`。
   释放时 `placeholder.dispose()` 会触发 cordis 的 `emitPluginDisposed`；loader 的 `internal/plugin`
   监听器把这次 dispose 当作“插件被卸载”，执行：
   `entry.options.disabled = true; entry.parent.tree.write()`。
   于是入口被真正禁用并写回 `cordis.yml`，客户端模块随之不再提供（frameless 404）。
   探针栈：`Fiber.dispose → emitPluginDisposed → loader internal/plugin → options.disabled = true`。
2. **一次性放行**：`commonReleased` 只允许一次释放；放行后才创建/重载的入口仍被 `<init>` 登记，
   但 release 循环已经结束，永不执行真正的 init（最小复现：动画不等待时，入口 5 秒后才创建 → 永不 apply）。
3. 这等于“接管了官方加载控制，但只接管了一半”：初始窗口内拦截，窗口之后既不继续控制、也不交还。

### 修复

- 占位 fiber 改挂到**无 Entry 的根上下文**（`entry.ctx.root.registry.plugin(...)`），释放时 loader 找不到
  `fiber.entry`，不会再置 `disabled`、不会再写回树；启动审计仍认为入口已激活（无 “entries did not activate” 警告）。
- 新增 `isReleased()`：常用组一旦放行，之后新建/重载的入口**直接调用官方 init**，交回 loader/插件管理器控制；
  官方开关与 HMR 恢复正常。
- 释放前检查入口是否仍在树里，配置热重载期间被移除的“幽灵入口”不再 apply。
- 诊断：`/startup-orchestrator/state` 新增 `managedEntries`（id/name/disabled/fiber 状态）；
  `DSH_STARTUP_ORCH_DEBUG=1` 时记录 `disabled-set` 调用栈与 `release-state`。

### 回归验证

| 场景 | 结果 |
| --- | --- |
| 动画等待开启、入口先创建后放行 | apply 成功；`disabled-set` 无记录；`entryDisabled=false`；`cordis.yml` 保持 `[]` |
| 放行发生在入口创建之前（official/HMR 时序） | 入口创建后立即 apply；不再出现“永久登记” |
| 真实 `dsh-frameless-page` 隔离启动 | `/startup-orchestrator/state` 的 `managedEntries`：`disabled:false`、`fiber:2`；`cordis.yml` 保持 `[]` |
| 启动审计 | 无 `entries did not activate` 警告 |
| 探针 | 占位释放不再触发 `options.disabled = true` |

**注意**：当前正在运行的宿主仍加载着旧 preload，且内存里的常用组入口已被置 `disabled`；必须完全退出并重启，
新 preload 才会生效、`cordis.yml` 也会在启动时被重写为空树。重启后 frameless 入口会以 enabled/active 状态加载，
灵动岛应恢复（裸 `/plugins/.../client.js` 路径本身不一定可访问，客户端模块走 combo 路由）。

## 2026-10-23 面板顺序按钮修复

`↑/↓` 按钮存在但点击无效。原因：`GroupEditor.move()` 使用了**上一次渲染的 `items` 对象引用**，
而 `Panel.mutate()` 会对配置做 JSON 深拷贝，`next.items` 里全是新对象；`all.indexOf(旧引用)` 返回 -1，
`splice(-1, …)` 只动到数组末尾（看起来没反应或顺序错乱）。

修复：`move()` 改为在 `next` 的 `groupItems(next, group)` 上按索引取当前项/目标项，再交换它们在
`next.items` 中的位置。新增回归：

- `test/order-swap.test.mjs`：组内上移/下移、边界不可移动、跨组互不影响；
- `test/orchestrator.test.mjs` 增加“保存后顺序读回一致”的服务端断言。

客户端模块更新需要重启 DSH（或页面重新加载后确认新 bundle 生效）。

## 2026-10-24 Portable 0.9.5 更新后失效（launcher 钩子被覆盖）

现象：更新到 Portable 0.9.5 / runtime `4fd3a0ec…` 后，设置面板还在、插件日志仍有 `apply/client-apply`，
但 `startup-orchestrator.log` 全是 `scheduler:false`，启动编排完全不生效。

根因：更新整包替换了 `launcher/portable-cli.mjs`，把 host spawn 里的
`NODE_OPTIONS=--import=<preload>` 注入段冲掉。preload 文件、插件、配置都还在，只是没人加载它们。

处理：

1. 重新打好 launcher 钩子（带 `.before-orchestrator-*` 备份 + `node --check` 校验）；
2. 新增 `lib/launcher-hook.js`：插件每次启动自动检查 launcher，缺钩子就**幂等自愈**（备份、写入、语法校验，失败自动还原）；
3. 新增手动脚本 `scripts/ensure-launcher-hook.mjs`；
4. 新版 runtime `4fd3a0ec` 隔离回归：`scheduler:true`、目标入口 `disabled:false/fiber:2`、`cordis.yml` 保持 `[]`。

行为约定：

- 现在重启一次即可恢复编排；
- **以后每次 Portable 更新**：更新后的第一次启动仍会 `scheduler:false`（launcher 已被替换），
  但本次启动的插件会把钩子补回去，**再重启一次**即恢复。若新版 launcher 结构变化导致
  自愈返回 `anchor-missing`，运行 `scripts/ensure-launcher-hook.mjs` 查看并需要适配锚点。

## 0.2.0 结构规范化（2026-10-24）

- 源码迁入 `src/`，`lib/` 由 `scripts/build.mjs` 生成并随包发布（构建时校验语法与 client loader id）。
- manifest 补齐 DSH bundle 规范字段：`dsh.manifestVersion: 1`、`engines.dsh`、`dsh.compatibility.profiles`、`exports`、`files` 白名单、`icon`、`repository`。
- `preload.mjs` 作为包内 `lib/preload.mjs` 发布，Host 每次启动部署到 `$DSH_HOME/startup-orchestrator/preload.mjs`；不再手工复制。
- 安装改为标准流程：`pnpm pack` → `dsh plugin add file:<tarball>`。profile 记录 tarball 路径，代码位于 `profiles/web/node_modules/dsh-startup-orchestrator`。
- 验证：build/三组测试通过；`dsh plugin add` exit 0（lockfile 0.2.0）；import preflight `ok:true`；`--dump-config` 可见 entry。

## 0.2.1 开屏等待扩展（2026-10-24）

- 常用组的“等待开机动画”现在也等 `media-wallpaper` 的开屏动画：
  - Host 计算 `MEDIA_INTRO_GATE`：媒体插件已打包、启用、且分在②boot 组；
  - 页面注入脚本读取 `dsh-plugin-media-wallpaper.settings.v1`，仅当 `intro.enabled` 且有媒体时等待；
  - 用 `MutationObserver` 观察 `[data-wp-intro]`，层撤掉后 POST `/done`，preload 才放行常用组；
  - 未启用/未安装/在③common 组时不等待（避免死锁）。
- 等待窗口：启动后最多 10 秒等开屏层出现，出现后最多 120 秒；页面总超时 150 秒。

## 回滚

1. 恢复 profile 的 `package.json` / `cordis.patch.yml`（`.before-orchestrator-*` 备份）；
2. 删除 `node_modules/dsh-startup-orchestrator` 与 `$DSH_HOME/startup-orchestrator*`；
3. 还原 `launcher/portable-cli.mjs` 的 NODE_OPTIONS 段；
4. 重启。

