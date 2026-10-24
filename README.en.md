# dsh-startup-orchestrator

A DSH startup orchestrator plugin: load profile plugins in three ordered groups (core / boot / common), with configurable waits, and optionally hold common plugins until the boot animation finishes.

- Runtime data: `$DSH_HOME/startup-orchestrator.json`, `$DSH_HOME/startup-orchestrator.log`
- Settings: **DSH Settings → Startup Orchestration**
- Target runtime: `dsh 0.2.1-rc.2`, `web` profile

## Features

- Core group (all `@deepseek-ai/*` bundles + this plugin) is locked and loads first.
- Boot group (default `dsh-startup-screen`, `dsh-ops`) loads after core with a start delay and per-item interval.
- Common group (pets, memory, sidebar, …) waits for the splash animation by default, then loads in order.
- Panel controls: enable/disable per plugin, reorder with ↑/↓, move between boot/common, group wait and interval, splash wait toggle. Restart after saving.

## Install

```sh
dsh plugin --profile web add ./dist/dsh-startup-orchestrator-0.2.0.tgz
```

The plugin is installed as a real profile dependency under `profiles/web/node_modules/dsh-startup-orchestrator`. Do not copy the directory manually; a present directory is not an installed bundle.

### DSH-Portable

On every host start the plugin:

1. deploys `lib/preload.mjs` to `$DSH_HOME/startup-orchestrator/preload.mjs`;
2. checks/repairs the launcher `NODE_OPTIONS=--import=<preload>` hook in `launcher/portable-cli.mjs` (backup + syntax check).

If a Portable update replaces `launcher/portable-cli.mjs`, the first boot after the update runs without orchestration; the plugin restores the hook, and the next restart enables it.

Manual repair: `node scripts/ensure-launcher-hook.mjs [portableRoot]`.

## Layout

```
package.json        dsh.manifestVersion / dsh.bundle / dsh.client / engines.dsh
cordis.patch.yml    one insert row; id = package name = export const name
src/                source (host, client, launcher hook, preload)
lib/                built output shipped in the package
assets/icon.svg     plugin icon
scripts/            build / maintenance
test/               regression tests
docs/               deployment notes
```

## Build & test

```sh
node scripts/build.mjs
node test/orchestrator.test.mjs
node test/order-swap.test.mjs
node test/launcher-hook.test.mjs
pnpm pack --pack-destination dist
```

## Limitations

- Group delays require the Portable launcher preload injection. The panel and host half still work under plain `dsh web`, but ordered delay is Portable-specific.
- Restart after saving; after a Portable update the first start may report `scheduler:false` until the launcher hook is restored.
- If a future launcher layout breaks the repair anchors, adapt `src/launcher-hook.js`.

## License

MIT
