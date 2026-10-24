/* ============================================================================
 * dsh-startup-orchestrator — 进程级启动调度器（preload）
 * ----------------------------------------------------------------------------
 * 由 launcher 通过 NODE_OPTIONS=--import=... 注入，早于 DSH 的 loader 创建入口。
 *
 * 关键设计：
 *   - 开机启动组（boot）：阻塞式延迟（组等待 + 项间间隔），保证启动屏等先 apply；
 *   - 常用组（common）：**不阻塞 boot 流程**。第一次 init 只登记入口并立即返回，
 *     等启动屏动画结束信号到达后，再按配置顺序调用真正的 init。
 *     这样 URL/首屏不会被“等待动画”卡住（否则 launcher 拿不到 URL，动画永远不播）。
 *
 * 入口保持 enabled（不写 disabled），因此不会触发 Portable 的“停用待生效”。
 * 动画结束信号由 Host 半侧在收到页面 dsh-startup:done 后调用 bootDone()。
 * ============================================================================ */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'startup-orchestrator.json')
const LOG_FILE = path.join(DSH_HOME, 'startup-orchestrator.log')
const BOOT_COMPLETION_TIMEOUT = 30000

function logLine(event, data) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + '\n', 'utf8') } catch (error) { /* 忽略 */ }
}

const DEBUG = process.env.DSH_STARTUP_ORCH_DEBUG === '1'
const watchedOptions = new WeakSet()

/** 诊断用：监视 entry.options.disabled 的赋值来源（DSH_STARTUP_ORCH_DEBUG=1）。 */
function watchDisabled(entry, label) {
  if (!DEBUG || !entry || !entry.options || typeof entry.options !== 'object') return
  if (watchedOptions.has(entry.options)) return
  watchedOptions.add(entry.options)
  let value = entry.options.disabled
  try {
    Object.defineProperty(entry.options, 'disabled', {
      configurable: true,
      enumerable: true,
      get() { return value },
      set(next) {
        value = next
        let stack = ''
        try { stack = String(new Error().stack || '') } catch (error) { stack = '' }
        logLine('disabled-set', { label, next, stack: stack.split('\n').slice(1, 12) })
      }
    })
  } catch (error) {
    logLine('watch-error', { label, message: error instanceof Error ? error.message : String(error) })
  }
}

function delay(ms) {
  const wait = Math.max(0, Number(ms) || 0)
  if (wait === 0) return Promise.resolve()
  return new Promise((resolve) => { const timer = setTimeout(resolve, wait); timer.unref?.() })
}

function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch (error) { return null }
}

function resolveLoaderFile() {
  const candidates = []
  if (process.env.DSH_STARTUP_ORCH_LOADER) candidates.push(process.env.DSH_STARTUP_ORCH_LOADER)
  // 直接 `node bin.js` 时 argv[1] 是 bin；Portable 走 portable-host 进程时 argv[2] 是 dshBin。
  for (const arg of process.argv.slice(1)) {
    if (typeof arg !== 'string' || !/[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/.test(arg)) continue
    const dir = path.dirname(arg)
    candidates.push(path.resolve(dir, '..', '..', 'cordis-plugin-loader', 'lib', 'index.js'))
    candidates.push(path.resolve(dir, '..', '..', '..', 'cordis-plugin-loader', 'lib', 'index.js'))
  }
  // Portable runtime root 兜底（如果显式提供了 app 目录）。
  const runtimeRoot = process.env.DSH_PORTABLE_RUNTIME_ROOT
  if (runtimeRoot) candidates.push(path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js'))
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate } catch (error) { /* 下一个 */ }
  }
  return null
}

function matches(itemName, options) {
  const name = typeof options?.name === 'string' ? options.name : ''
  const id = typeof options?.id === 'string' ? options.id : ''
  return name === itemName || id === itemName || name.startsWith(itemName + '/')
}

function buildScheduler(config) {
  const groupsConfig = config.groups && typeof config.groups === 'object' ? config.groups : {}
  const items = Array.isArray(config.items) ? config.items.filter((row) => row && typeof row.name === 'string' && row.enabled !== false) : []
  const bootRows = items.filter((row) => row.group === 'boot')
  const commonRows = items.filter((row) => row.group === 'common')
  const bootCfg = groupsConfig.boot && typeof groupsConfig.boot === 'object' ? groupsConfig.boot : {}
  const commonCfg = groupsConfig.common && typeof groupsConfig.common === 'object' ? groupsConfig.common : {}

  const bootDoneDeferred = deferred()
  let bootDoneFlag = false
  let commonReleased = false

  const bootStates = bootRows.map((row, index) => ({
    row,
    index,
    gate: null,
    done: deferred(),
    doneResolved: false
  }))
  const bootByName = new Map(bootStates.map((state) => [state.row.name, state]))
  const bootDoneAll = deferred()
  let bootStart = null

  // 常用组：先登记入口，动画结束后按顺序真正 init。
  const deferredCommon = new Map() // itemName -> [{ entry, args }]
  const deferredEntries = new Set()
  let commonPlan = null
  let originalInit = null

  function bootDone(reason) {
    if (bootDoneFlag) return
    bootDoneFlag = true
    logLine('boot-done', { reason: String(reason || '') })
    bootDoneDeferred.resolve(String(reason || 'done'))
    scheduleCommonRelease()
  }

  async function bootGroupStart() {
    if (bootStart) return bootStart
    bootStart = (async () => {
      await delay(bootCfg.waitMs)
      logLine('group-start', { group: 'boot', waitMs: bootCfg.waitMs, items: bootRows.map((row) => row.name) })
    })()
    return bootStart
  }

  async function enterBootItem(state) {
    if (state.gate) return state.gate
    state.gate = (async () => {
      await bootGroupStart()
      for (let i = 0; i < state.index; i++) {
        await Promise.race([bootStates[i].done.promise, delay(20000)])
      }
      if (state.index > 0) await delay(bootCfg.intervalMs)
      logLine('entry-release', { group: 'boot', name: state.row.name, index: state.index })
    })()
    return state.gate
  }

  function markBootDone(state) {
    if (state.doneResolved) return
    state.doneResolved = true
    state.done.resolve()
    logLine('entry-loaded', { group: 'boot', name: state.row.name })
    if (bootStates.every((row) => row.doneResolved)) bootDoneAll.resolve()
  }

  // 开机项缺失时也能让常用组继续：从调度器就绪起最多等 BOOT_COMPLETION_TIMEOUT。
  if (bootStates.length === 0) {
    bootDoneAll.resolve()
  } else {
    const timer = setTimeout(() => {
      if (!bootStates.every((row) => row.doneResolved)) {
        logLine('group-done-timeout', { group: 'boot', timeoutMs: BOOT_COMPLETION_TIMEOUT })
      }
      bootDoneAll.resolve()
    }, BOOT_COMPLETION_TIMEOUT)
    timer.unref?.()
  }

  function registerCommon(row, entry, args, placeholder) {
    const list = deferredCommon.get(row.name) || []
    if (!deferredEntries.has(entry)) {
      deferredEntries.add(entry)
      list.push({ entry, args, placeholder })
      deferredCommon.set(row.name, list)
    }
    logLine('entry-deferred', { group: 'common', name: row.name })
  }

  async function releaseCommon(reason) {
    if (commonReleased) return
    commonReleased = true
    await Promise.race([bootDoneAll.promise, delay(BOOT_COMPLETION_TIMEOUT)])
    if (commonCfg.waitForAnimation === true) {
      const timeout = Math.max(1000, Number(commonCfg.readyTimeoutMs) || 120000)
      const outcome = await Promise.race([
        bootDoneDeferred.promise.then((value) => ({ value })),
        delay(timeout).then(() => ({ value: 'timeout' }))
      ])
      logLine('animation-wait', { reason: outcome.value })
    }
    await delay(commonCfg.waitMs)
    logLine('group-start', {
      group: 'common',
      reason,
      waitMs: commonCfg.waitMs,
      waitForAnimation: commonCfg.waitForAnimation === true
    })
    for (let index = 0; index < commonRows.length; index++) {
      const row = commonRows[index]
      const list = deferredCommon.get(row.name) || []
      if (list.length > 0) {
        logLine('entry-release', { group: 'common', name: row.name, index })
        const tasks = list.map(async ({ entry, args, placeholder }) => {
          // 启动动画期间配置被热重载时，旧入口可能已被移除；不要对幽灵入口 apply。
          try {
            let alive = false
            for (const candidate of entry.parent.tree.entries()) if (candidate === entry) { alive = true; break }
            if (!alive) { logLine('entry-skipped-removed', { name: row.name }); return }
          } catch (error) { /* 检查失败就继续 */ }
          watchDisabled(entry, 'release:' + row.name)
          try {
            if (placeholder && typeof placeholder.dispose === 'function') await placeholder.dispose()
          } catch (error) { /* 占位 fiber 释放失败不阻断真正加载 */ }
          try {
            const result = await originalInit.apply(entry, args)
            if (DEBUG) {
              logLine('release-state', {
                name: row.name,
                optionsDisabled: entry.options?.disabled,
                entryDisabled: (() => { try { return entry.disabled } catch (e) { return 'error' } })(),
                fiberUid: entry.fiber?.uid ?? null,
                fiberState: entry.fiber?.state ?? null
              })
            }
            return result
          } catch (error) { throw error }
        })
        await Promise.allSettled(tasks)
        logLine('entry-loaded', { group: 'common', name: row.name })
      }
      if (index < commonRows.length - 1) await delay(commonCfg.intervalMs)
    }
    logLine('common-done', { released: deferredEntries.size })
  }

  function scheduleCommonRelease() {
    if (commonPlan) return
    commonPlan = releaseCommon(commonCfg.waitForAnimation === true ? 'animation-done' : 'boot-group-done').catch((error) => {
      logLine('common-release-error', { message: error instanceof Error ? error.message : String(error) })
    })
  }

  // 未开启“等待动画”时：开机组完成就放行常用组。
  if (commonCfg.waitForAnimation !== true) {
    bootDoneAll.promise.then(() => scheduleCommonRelease())
    // 极端兜底：开机组一直不完成也要放行（bootDoneAll 本身有超时）。
  }

  // 调度器就绪后若既没有动画也没有开机项，主动兜底放行。
  const safety = setTimeout(() => {
    if (!commonReleased && commonCfg.waitForAnimation !== true) scheduleCommonRelease()
  }, BOOT_COMPLETION_TIMEOUT + 5000)
  safety.unref?.()

  async function beforeEntry(options) {
    if (!options || typeof options !== 'object') return null
    for (const state of bootStates) {
      if (matches(state.row.name, options)) {
        await enterBootItem(state)
        return { mode: 'boot', state }
      }
    }
    for (const row of commonRows) {
      if (matches(row.name, options)) return { mode: 'common', row }
    }
    return null
  }

  globalThis.__DSH_STARTUP_ORCH__ = {
    version: 2,
    bootDone,
    isBootDone: () => bootDoneFlag,
    bootGroup: bootRows.map((row) => row.name),
    commonGroup: commonRows.map((row) => row.name)
  }

  logLine('scheduler-ready', {
    boot: bootRows.map((row) => row.name),
    common: commonRows.map((row) => row.name),
    waitForAnimation: commonCfg.waitForAnimation === true
  })

  return {
    beforeEntry,
    afterBootEntry(token) { if (token && token.mode === 'boot') markBootDone(token.state) },
    registerCommon,
    isReleased: () => commonReleased,
    setOriginalInit(fn) { originalInit = fn }
  }
}

async function main() {
  // NODE_OPTIONS 会被宿主的所有子 node 进程继承；只在宿主进程（argv 里带 dsh bin.js）生效。
  const hasDshBinArg = process.argv.slice(1).some((arg) => typeof arg === 'string' && /[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/.test(arg))
  if (!hasDshBinArg) return
  const config = readConfig()
  if (!config || config.enabled === false) {
    logLine('preload-skip', { reason: config ? 'disabled' : 'no-config' })
    return
  }
  const loaderFile = resolveLoaderFile()
  if (!loaderFile) {
    logLine('preload-skip', { reason: 'loader-not-found' })
    return
  }
  let Entry
  try {
    const namespace = await import(pathToFileURL(loaderFile).href)
    Entry = namespace.Entry || (namespace.default && namespace.default.Entry)
  } catch (error) {
    logLine('preload-error', { stage: 'import-loader', message: error instanceof Error ? error.message : String(error) })
    return
  }
  if (!Entry || !Entry.prototype || typeof Entry.prototype.init !== 'function') {
    logLine('preload-skip', { reason: 'entry-not-found' })
    return
  }

  const originalInit = Entry.prototype.init
  const scheduler = buildScheduler(config)
  scheduler.setOriginalInit(originalInit)

  Entry.prototype.init = async function startupOrchestratedInit(...args) {
    if (this && this.fiber) return originalInit.apply(this, args)
    // 常用组已经放行（或启动编排已结束）之后新建/重载的入口：交回官方加载控制。
    // 否则热挂载、官方插件开关、面板保存触发的 HMR 入口会一直被登记但永不释放。
    if (scheduler.isReleased()) return originalInit.apply(this, args)
    watchDisabled(this, 'init:' + String(this?.options?.name || this?.options?.id || '?'))
    let plan = null
    try { plan = await scheduler.beforeEntry(this?.options) } catch (error) {
      logLine('schedule-error', { message: error instanceof Error ? error.message : String(error) })
    }
    if (plan && plan.mode === 'common') {
      // 常用组：登记后立即返回，让 loader.await / URL 输出 / 启动屏都不被阻塞。
      // 给入口放一个 no-op 占位 fiber，避免启动审计把它当成“导入失败/未激活”。
      // 关键：占位 fiber 必须挂在**无 Entry 的根上下文**上。若挂在入口上下文，
      // 释放时 loader 会把它当成“插件被卸载”，把入口 options.disabled 置真并写回
      // cordis.yml（客户端模块随之 404，官方开关显示停用——frameless 就是这样消失的）。
      let placeholder
      try {
        const neutral = (this.ctx && this.ctx.root) || this.ctx
        placeholder = neutral.registry.plugin(function startupOrchestratorPlaceholder() {}).ctx.fiber
        this.fiber = placeholder
      } catch (error) { placeholder = undefined }
      scheduler.registerCommon(plan.row, this, args, placeholder)
      return undefined
    }
    try {
      return await originalInit.apply(this, args)
    } finally {
      try { scheduler.afterBootEntry(plan) } catch (error) { /* 忽略 */ }
    }
  }
  logLine('preload-ready', { loaderFile })
}

await main()
