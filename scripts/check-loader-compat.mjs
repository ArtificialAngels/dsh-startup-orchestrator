/* dsh-startup-orchestrator — preload 对宿主 loader 的适配复核（rc.3 / cordis-plugin-loader@1.0.6）
 *
 * 目的：preload 依赖 cordis-plugin-loader 的内部结构；宿主升级后跑一遍，
 * 静态 + 动态确认补丁点仍成立，避免“编排静默失效”。
 *
 * 用法：
 *   node scripts/check-loader-compat.mjs [--app <runtime app 目录>]
 *   app 目录可用 DSH_APP_ROOT / DSH_PORTABLE_RUNTIME_ROOT 指定；
 *   缺省扫描 %LOCALAPPDATA%\DSH-Portable\runtime-cache\*\app。
 *
 * 退出码 0 = 全部通过；1 = 有补丁点不成立（需适配 preload）。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { installedVersion, resolveAppRoot } from './runtime-app.mjs'

const appRoot = resolveAppRoot()
if (!appRoot) {
  console.error('check-loader-compat: 未找到 runtime app 目录（用 --app 或 DSH_APP_ROOT 指定）')
  process.exit(1)
}
const loaderFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')
const cordisFile = path.join(appRoot, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')
const preloadFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'preload.mjs')

const pass = []
const fail = []
function check(label, fn) {
  try {
    const detail = fn()
    pass.push(`${label}${detail ? ' — ' + detail : ''}`)
  } catch (error) {
    fail.push(`${label} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

/* ============================== 1) 静态结构 ============================== */
const source = fs.readFileSync(loaderFile, 'utf8')
const version = installedVersion(appRoot, '@deepseek-ai/cordis-plugin-loader')
const staticChecks = [
  ['export { Entry, ... }', /export\s*\{[^}]*\bEntry\b/],
  ['class Entry', /var Entry = class Entry/],
  ['Entry.prototype.init = async init()', /async init\(\)\s*\{/],
  ['Entry.prototype._init = async _init()', /async _init\(\)\s*\{/],
  ['_init 中 this.fiber = this.ctx.registry.plugin(...)', /this\.fiber = this\.ctx\.registry\.plugin\(/],
  ['update() 内 await this.init()', /await this\.init\(\)/],
  ['refresh() 内 await this.init()', /await this\.init\(\)/],
  ['EntryTree.entries() 生成器', /\*entries\(\)\s*\{/],
  ['lookup: EntryGroup.tree 字段（entry.parent.tree.*）', /this\.tree = tree;/],
  ['lookup: Entry.parent 字段', /parent;\s*\n\s*options = \{\};/],
  ['init 使用 _initTask ??= this._init()', /_initTask \?\?= this\._init\(\)/],
  ['internal/plugin 监听器', /ctx\.on\("internal\/plugin"/],
  ['监听器写 entry.options.disabled = true', /fiber\.entry\.options\.disabled = true/],
  ['监听器写 entry.parent.tree.write()', /fiber\.entry\.parent\.tree\.write\(\)/],
  ['fiber.entry 由父上下文 [Entry.key] 挂载', /fiber\.parent\[Entry\.key\]/]
]
for (const [label, re] of staticChecks) {
  check(`[static] ${label}`, () => { assert.match(source, re); return '' })
}
check('[static] loader 版本', () => `cordis-plugin-loader@${version}`)

/* ============================== 2) 动态探针 ============================== */
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-orch-loader-probe-'))
const tmpPlugin = (name) => {
  const file = path.join(tmpHome, `${name}.mjs`)
  fs.writeFileSync(file, `export default function ${name.replace(/[^A-Za-z0-9_]/g, '_')}() {}\n`)
  return pathToFileURL(file).href
}
const bootName = tmpPlugin('bootPlugin')
const commonName = tmpPlugin('commonPlugin')
const lateName = tmpPlugin('latePlugin')
fs.writeFileSync(path.join(tmpHome, 'startup-orchestrator.json'), JSON.stringify({
  version: 1,
  enabled: true,
  groups: {
    boot: { waitMs: 0, intervalMs: 0, waitForAnimation: false },
    common: { waitMs: 0, intervalMs: 0, waitForAnimation: true, readyTimeoutMs: 5000 }
  },
  items: [
    { name: bootName, group: 'boot', enabled: true },
    { name: commonName, group: 'common', enabled: true }
  ]
}, null, 2))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await delay(20)
  }
  return false
}

let loaderModule
let Entry
let bootEntry
let commonEntry
let commonNamespace
let lateEntry

try {
  loaderModule = await import(pathToFileURL(loaderFile).href)
  Entry = loaderModule.Entry
  check('[dynamic] loader 导出 Entry', () => { assert.equal(typeof Entry, 'function'); return '' })
  check('[dynamic] Entry.prototype.init/_init 存在', () => {
    assert.equal(typeof Entry.prototype.init, 'function')
    assert.equal(typeof Entry.prototype._init, 'function')
    return ''
  })

  process.env.DSH_HOME = tmpHome
  process.env.DSH_STARTUP_ORCH_LOADER = loaderFile
  process.argv.push('C:\\fake\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js')
  const originalInit = Entry.prototype.init
  await import(pathToFileURL(preloadFile).href)
  check('[dynamic] preload 包裹了 Entry.prototype.init', () => {
    assert.notEqual(Entry.prototype.init, originalInit)
    assert.equal(Entry.prototype.init.name, 'startupOrchestratedInit')
    return 'startupOrchestratedInit'
  })
  check('[dynamic] scheduler 已挂到 globalThis.__DSH_STARTUP_ORCH__', () => {
    const orch = globalThis.__DSH_STARTUP_ORCH__
    assert.equal(orch?.version, 2)
    return `boot=${JSON.stringify(orch.bootGroup)} common=${JSON.stringify(orch.commonGroup)}`
  })

  const { Context } = await import(pathToFileURL(cordisFile).href)
  const root = new Context()
  await root.plugin(loaderModule.Loader)
  const loader = root.get('loader')
  check('[dynamic] 建立 cordis root + Loader', () => {
    assert.ok(loader, 'loader service')
    return `cordis ${JSON.parse(fs.readFileSync(path.join(appRoot, 'node_modules', '@deepseek-ai', 'cordis', 'package.json'), 'utf8')).version}`
  })
  loader.internal = undefined // 让 EntryTree.import 走原生 import(file URL)

  // 开机启动组：补丁应阻塞到组放行后调用官方 init。
  const bootId = await loader.create({ id: 'boot-1', name: bootName })
  bootEntry = loader.store[bootId]
  check('[dynamic] boot 入口走官方 init 并激活', () => {
    assert.equal(bootEntry.options.disabled, undefined)
    assert.equal(bootEntry.fiber?.state, 2, 'fiber ACTIVE')
    return `fiber.uid=${bootEntry.fiber.uid}`
  })

  // 常用组：补丁应只登记、立即返回，并放一个无 Entry 的占位 fiber。
  const commonId = await loader.create({ id: 'common-1', name: commonName })
  commonEntry = loader.store[commonId]
  check('[dynamic] common 入口非阻塞（init 立即返回，loader.await 不卡住）', () => {
    assert.equal(commonEntry.moduleNamespace, undefined, 'not really loaded yet')
    assert.equal(commonEntry.fiber?.runtime?.name, 'startupOrchestratorPlaceholder')
    return `placeholder fiber.uid=${commonEntry.fiber.uid} state=${commonEntry.fiber.state}`
  })
  const nonBlocking = await Promise.race([loader.await().then(() => 'settled'), delay(2000).then(() => 'timeout')])
  check('[dynamic] loader.await() 在待释放期间能结束（URL 不被卡住）', () => { assert.equal(nonBlocking, 'settled'); return '' })
  check('[dynamic] entry.parent.tree.entries() 可枚举入口（放行前的存活检查）', () => {
    const all = [...commonEntry.parent.tree.entries()]
    assert.ok(all.includes(commonEntry))
    return `entries=${all.length}`
  })

  // 占位 fiber 必须挂在无 Entry 的根上下文：释放时不会被 loader 当作插件卸载。
  check('[dynamic] 占位 fiber 无 entry（root 上下文）', () => {
    assert.equal(commonEntry.fiber.entry, undefined)
    assert.equal(commonEntry.fiber.parent.fiber.uid, 0, 'placeholder parent is root fiber')
    return ''
  })
  await commonEntry.fiber.dispose()
  check('[dynamic] 释放占位 fiber 不会写 disabled', () => {
    assert.equal(commonEntry.options.disabled, undefined)
    return ''
  })

  // 反向证明：挂在入口上下文上的 fiber 被 dispose 时，rc.3 loader 仍会写 disabled（历史 bug）。
  const probe = new Entry(loader)
  probe.parent = loader.root
  probe.options = { id: 'probe', name: 'probe' }
  loader.root.tree.store.probe = probe
  const probeFiber = probe.ctx.registry.plugin(function probePlugin() {}).ctx.fiber
  await probeFiber.dispose()
  check('[dynamic] 反向证明：entry 上下文 fiber 释放仍触发 loader 置 disabled（占位必须避开）', () => {
    assert.equal(probe.options.disabled, true)
    return '选项保持 enabled 的入口不会误禁用'
  })
  delete loader.root.tree.store.probe

  // 动画结束 → 放行常用组 → 真正调用官方 init。
  globalThis.__DSH_STARTUP_ORCH__.bootDone('loader-compat-probe')
  const released = await waitFor(() => commonEntry.fiber?.uid > 0 && commonEntry.moduleNamespace !== undefined)
  commonNamespace = await import(commonName)
  check('[dynamic] bootDone 后 common 入口真正加载', () => {
    assert.equal(released, true)
    assert.equal(commonEntry.fiber.runtime.callback, commonNamespace.default)
    assert.equal(commonEntry.fiber.entry, commonEntry, 'loader internal/plugin 把 fiber 挂回入口')
    assert.equal(commonEntry.options.disabled, undefined)
    return `fiber.uid=${commonEntry.fiber.uid} state=${commonEntry.fiber.state}`
  })

  // 放行之后新建的入口应直接交回官方 init（isReleased 放行）。
  const lateId = await loader.create({ id: 'late-1', name: lateName })
  lateEntry = loader.store[lateId]
  check('[dynamic] 放行后新建入口直接官方 init', () => {
    assert.equal(lateEntry.fiber?.state, 2)
    assert.ok(lateEntry.fiber.uid > 0)
    return `fiber.uid=${lateEntry.fiber.uid}`
  })

  const log = fs.readFileSync(path.join(tmpHome, 'startup-orchestrator.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  check('[dynamic] 调度日志事件序列', () => {
    const events = log.map((row) => row.event)
    for (const expected of ['scheduler-ready', 'preload-ready', 'entry-release', 'entry-deferred', 'boot-done', 'animation-wait', 'entry-loaded', 'common-done']) {
      assert.ok(events.includes(expected), `missing log event ${expected}`)
    }
    return events.join(' → ')
  })
} catch (error) {
  fail.push(`[dynamic] 探针异常 — ${error instanceof Error ? error.stack || error.message : String(error)}`)
} finally {
  try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch (error) { /* ignore */ }
}

console.log(`check-loader-compat: ${appRoot}`)
for (const line of pass) console.log('  PASS', line)
for (const line of fail) console.log('  FAIL', line)
if (fail.length) {
  console.error(`check-loader-compat: ${fail.length} failed, ${pass.length} passed — preload 需要适配`)
  process.exit(1)
}
console.log(`check-loader-compat: ${pass.length} checks PASS（loader 补丁点对当前宿主仍成立）`)
process.exit(0)
