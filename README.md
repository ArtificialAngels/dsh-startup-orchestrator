# dsh-startup-orchestrator

DSH 启动编排：把插件分成三组按顺序加载，并控制组间/组内等待时间；常用插件可以等开机动画播完再加载。

## 三组

| 组 | 内容 | 规则 |
| --- | --- | --- |
| ① 核心 | 所有 `@deepseek-ai/*` 官方 bundle + 本插件 | 锁定，最早加载，不能删除/排序 |
| ② 开机启动项 | 默认 `dsh-startup-screen`、`dsh-ops` | 核心之后，按顺序 + 间隔加载 |
| ③ 常用插件 | 其余插件（`dsh-pet`、`dsh-context`、侧栏等） | 默认等开机动画播完，再按顺序 + 间隔加载 |

设置位置：**DSH 设置 → 启动编排**。保存后需要重启 DSH-Portable。

## 实现

- **调度器** `preload.mjs`：launcher 通过 `NODE_OPTIONS=--import=...` 注入，包裹
  `cordis-plugin-loader` 的 `Entry.prototype.init`。
  - 开机启动组：阻塞式延迟（组等待 + 项间间隔）；
  - 常用组：第一次 init 只登记并立即返回，保证 URL/首屏不被阻塞；页面动画结束
    （`dsh-startup:done` → Host `/startup-orchestrator/done` → `bootDone()`）后，
    按顺序调用真正的 init。
- **Host 半侧**：读写 `$DSH_HOME/startup-orchestrator.json`，提供设置面板 API，
  注入页面监听脚本；保存时同步改写 `profiles/web/package.json` 的
  `dsh.profile.bundles`（关闭项移出、顺序按分组）。
- **浏览器半侧**：`settings.section` 面板「启动编排」（三组、顺序、等待、开关）。

入口始终 enabled（不写 `disabled: true`），所以不会出现 Portable 插件页的
「停用待生效」误报。

## 文件

- 配置：`$DSH_HOME/startup-orchestrator.json`
- 日志：`$DSH_HOME/startup-orchestrator.log`
- preload：`$DSH_HOME/startup-orchestrator/preload.mjs`（由 launcher 注入）

## 限制

- 保存后需要重启 DSH（调度发生在进程启动阶段）。
- `等待开机动画` 依赖 `dsh-startup-screen`；未安装/被跳过时立即放行。
- 调度失败会有超时兜底（常用组最多等约 2 分钟），不会永久卡住启动。
