# dsh-startup-orchestrator

DSH 启动编排插件：把 profile 里的插件分成三组按顺序加载，并可控制组间/组内等待时间；常用插件可以等开机动画播完再加载。

- 运行期数据：`$DSH_HOME/startup-orchestrator.json`、`$DSH_HOME/startup-orchestrator.log`
- 设置入口：**DSH 设置 → 启动编排**
- 目标运行时：`dsh 0.2.1-rc.2`，`web` profile

## 功能

| 组 | 默认内容 | 规则 |
| --- | --- | --- |
| ① 核心 | 所有 `@deepseek-ai/*` 官方 bundle + 本插件 | 锁定，最早加载，不可删除/排序 |
| ② 开机启动项 | `dsh-startup-screen`、`dsh-ops` | 核心之后，按顺序 + 间隔加载 |
| ③ 常用插件 | 其余插件（宠物、记忆、侧栏等） | 默认等开机动画播完（若启用 media-wallpaper 开屏，也等它播完），再按顺序 + 间隔加载 |

面板支持：启动加载开关、组内 ↑/↓ 排序、开机/常用互移、组开始前等待、组内每项间隔、是否等待开机动画。保存后需要重启 DSH 生效。

“等待开机动画”现在同时覆盖 `dsh-startup-screen` 和 `media-wallpaper` 的开屏动画：

- 读取 `dsh-plugin-media-wallpaper.settings.v1`，只有 `intro.enabled` 且已选媒体时才等待；
- 观察 `[data-wp-intro]` 层，播完/撤层后才放行常用组；
- 只在该插件位于②开机启动项时生效（若移到③常用组，等它会死锁，因此自动跳过）；
- 未启用开屏或未安装该插件时行为不变。

## 安装

标准 DSH bundle 安装（打包 tarball 后装进 profile）：

```sh
dsh plugin --profile web add ./dist/dsh-startup-orchestrator-0.2.1.tgz
```

也可以直接从 npm/GitHub 安装。安装后确认：

```sh
dsh --profile web --dump-config | grep -A2 'id: dsh-startup-orchestrator'
```

插件代码位于 `profiles/web/node_modules/dsh-startup-orchestrator`；**不要**手动复制目录到 profile，目录“存在”不等于已安装（profile 不拥有依赖时不会被组合）。

### DSH-Portable

Portable 的启动器需要把调度器 preload 注入宿主进程：

1. Host 半侧每次启动会把包内 `lib/preload.mjs` 部署到 `$DSH_HOME/startup-orchestrator/preload.mjs`；
2. 同时检查/自愈 `launcher/portable-cli.mjs` 里的 `NODE_OPTIONS=--import=<preload>` 注入（备份 + 语法校验）；
3. Portable 更新覆盖 launcher 后，更新后的第一次启动编排不生效，插件会把钩子补回，**再重启一次**恢复。

手动重打钩子：`node scripts/ensure-launcher-hook.mjs [portableRoot]`。

## 目录结构

```
dsh-startup-orchestrator/
├── package.json            dsh.manifestVersion / dsh.bundle / dsh.client / engines.dsh
├── cordis.patch.yml        insert 一行；id = 包名 = export const name
├── src/                    源码
│   ├── index.js            Host 半侧（配置 API、面板数据、启动信号）
│   ├── client.js           浏览器半侧（settings.section「启动编排」）
│   ├── launcher-hook.js    Portable launcher 钩子自愈
│   └── preload.mjs         进程级调度器（注入 Entry.prototype.init）
├── lib/                    构建产物（随包发布）
├── assets/icon.svg         插件图标
├── scripts/                构建与维护脚本
├── test/                   回归测试
├── docs/DEPLOY-NOTES.md    部署/故障/回滚记录
└── CHANGELOG.md
```

## 构建与验证

```sh
node scripts/build.mjs              # src → lib，校验语法与 client loader id
node test/orchestrator.test.mjs     # 配置/保存/顺序/信号
node test/order-swap.test.mjs       # 面板顺序交换
node test/launcher-hook.test.mjs    # launcher 自愈
pnpm pack --pack-destination dist   # 打包（files 白名单只含 lib/patch/README/LICENSE/assets）
```

安装 tarball 时 profile 会记录**文件路径**：删除/移动该 tgz 会让下次安装报 ENOENT；升级请先 bump 版本，再安装新 tarball。

## 兼容与限制

- 调度依赖 Portable launcher 的 preload 注入；标准 `dsh web` 下插件/面板可用，但“分组延迟”只在 Portable 启动链生效。
- 保存后需要重启；更新后首次启动可能 `scheduler:false`，见上面的自愈说明。
- 若未来 launcher 结构变化导致自愈报 `anchor-missing`，需要按新版 launcher 适配锚点。

## License

MIT
