/* ============================================================================
 * dsh-startup-orchestrator — Host 半侧
 * ----------------------------------------------------------------------------
 * 职责：
 *   1) 读写启动编排配置 $DSH_HOME/startup-orchestrator.json
 *   2) 设置面板 API（GET/POST /startup-orchestrator/config）
 *   3) 开机动画完成信号：页面脚本监听 dsh-startup:done 后 POST /done，
 *      这里把信号交给进程级调度器（preload 注入的 globalThis.__DSH_STARTUP_ORCH__）
 *   4) 保存配置时同步改写 profile 的 dsh.profile.bundles（关闭项移出、顺序按分组）
 *
 * 真正“延迟哪个插件”发生在 preload.mjs：它比本插件更早运行，包裹
 * Entry.prototype.init。本插件只负责配置与信号。
 * ============================================================================ */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureLauncherHook } from './launcher-hook.js'

const NS = 'dsh-startup-orchestrator'
const ROUTE_BASE = '/startup-orchestrator'
const CONFIG_VERSION = 1
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CONFIG_FILE = path.join(DSH_HOME, 'startup-orchestrator.json')
const LOG_FILE = path.join(DSH_HOME, 'startup-orchestrator.log')
const PROFILE_DIR = path.join(DSH_HOME, 'profiles', 'web')
const MANIFEST_FILE = path.join(PROFILE_DIR, 'package.json')
const PRELOAD_SOURCE = fileURLToPath(new URL('./preload.mjs', import.meta.url))
const PRELOAD_TARGET = path.join(DSH_HOME, 'startup-orchestrator', 'preload.mjs')

const SYSTEM_ITEMS = [NS]
const BOOT_DEFAULTS = ['dsh-startup-screen', 'dsh-ops']
const GROUP_DEFAULTS = {
  boot: { waitMs: 0, intervalMs: 150, waitForAnimation: false, readyTimeoutMs: 120000 },
  common: { waitMs: 500, intervalMs: 300, waitForAnimation: true, readyTimeoutMs: 120000 }
}
const MAX_WAIT_MS = 600000

function logLine(event, data) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), event, ...data }) + '\n', 'utf8')
  } catch (error) { /* 日志失败不影响主流程 */ }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) { return null }
}

function versionOf(name) {
  const pkg = readJson(path.join(PROFILE_DIR, 'node_modules', name, 'package.json'))
  return pkg && typeof pkg.version === 'string' ? pkg.version : ''
}

function installedNames(manifest) {
  const names = new Set()
  const deps = manifest && manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}
  for (const name of Object.keys(deps)) names.add(name)
  const bundles = manifest?.dsh?.profile?.bundles
  if (Array.isArray(bundles)) for (const name of bundles) if (typeof name === 'string') names.add(name)
  return [...names]
}

function coreNames(manifest) {
  const bundles = manifest?.dsh?.profile?.bundles
  const deps = manifest?.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}
  const names = Array.isArray(bundles) ? bundles.filter((name) => typeof name === 'string' && name.startsWith('@deepseek-ai/')) : []
  const system = SYSTEM_ITEMS.filter((name) => (Array.isArray(bundles) && bundles.includes(name)) || Object.prototype.hasOwnProperty.call(deps, name))
  return [...new Set([...names, ...system])]
}

function clampMs(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(MAX_WAIT_MS, Math.floor(n))
}

function normalizeGroup(raw, fallback) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    waitMs: clampMs(src.waitMs, fallback.waitMs),
    intervalMs: clampMs(src.intervalMs, fallback.intervalMs),
    waitForAnimation: src.waitForAnimation === true,
    readyTimeoutMs: clampMs(src.readyTimeoutMs, fallback.readyTimeoutMs)
  }
}

/** 合并已安装插件与已有配置，得到完整、可展示、可保存的配置。 */
function normalizeConfig(raw, manifest) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const core = coreNames(manifest)
  const coreSet = new Set(core)
  const installed = installedNames(manifest).filter((name) => !coreSet.has(name))
  const installedSet = new Set(installed)
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const bundled = new Set(bundles)

  const previous = Array.isArray(src.items) ? src.items : []
  const seen = new Set()
  const items = []
  for (const row of previous) {
    const name = row && typeof row.name === 'string' ? row.name : ''
    if (!name || !installedSet.has(name) || seen.has(name)) continue
    seen.add(name)
    const group = row.group === 'boot' ? 'boot' : 'common'
    items.push({ name, group, enabled: row.enabled !== false })
  }
  for (const name of installed) {
    if (seen.has(name)) continue
    seen.add(name)
    // 依赖里存在但不在 bundles 里的，视为关闭；仍保留在常用组，方便面板重新打开。
    const group = BOOT_DEFAULTS.includes(name) ? 'boot' : 'common'
    items.push({ name, group, enabled: bundled.has(name) })
  }
  // 稳定排序：boot 组在前、common 组在后，组内保持配置顺序。
  items.sort((a, b) => (a.group === b.group ? 0 : a.group === 'boot' ? -1 : 1))

  const groups = {
    boot: normalizeGroup(src.groups?.boot, GROUP_DEFAULTS.boot),
    common: normalizeGroup(src.groups?.common, GROUP_DEFAULTS.common)
  }
  return { version: CONFIG_VERSION, enabled: src.enabled !== false, groups, items }
}

function readConfig(manifest) {
  return normalizeConfig(readJson(CONFIG_FILE), manifest)
}

function writeFileAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, text, 'utf8')
  fs.renameSync(temporary, file)
}

function writeConfigFile(config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  writeFileAtomic(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`)
}

/** 由配置推导 profile 的 bundles 列表：核心保持原顺序，然后 boot、common 中启用的项。 */
function effectiveBundles(config, manifest) {
  const core = coreNames(manifest)
  const boot = config.items.filter((row) => row.group === 'boot' && row.enabled).map((row) => row.name)
  const common = config.items.filter((row) => row.group === 'common' && row.enabled).map((row) => row.name)
  return [...new Set([...core, ...boot, ...common])]
}

function saveConfig(rawConfig) {
  const manifest = readJson(MANIFEST_FILE)
  if (!manifest || typeof manifest !== 'object') throw new Error('profile package.json is missing or invalid')
  const config = normalizeConfig(rawConfig, manifest)
  writeConfigFile(config)
  const bundles = effectiveBundles(config, manifest)
  const previousBundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : null
  if (!manifest.dsh || typeof manifest.dsh !== 'object') manifest.dsh = {}
  if (!manifest.dsh.profile || typeof manifest.dsh.profile !== 'object') manifest.dsh.profile = {}
  manifest.dsh.profile.bundles = bundles
  // 只在确实变化时写回，避免无意义的 HMR 抖动。
  if (!previousBundles || JSON.stringify(previousBundles) !== JSON.stringify(bundles)) {
    try {
      writeFileAtomic(`${MANIFEST_FILE}.before-orchestrator-${Date.now()}.json`, fs.readFileSync(MANIFEST_FILE, 'utf8'))
    } catch (error) { /* 备份失败不阻断 */ }
    writeFileAtomic(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
  }
  logLine('config-saved', { enabled: config.enabled, bundles, items: config.items.length })
  return { config, bundles, restartRequired: true }
}

function panelPayload(manifest) {
  const config = readConfig(manifest)
  const core = coreNames(manifest).map((name) => ({ name, version: versionOf(name) }))
  const coreSet = new Set(core.map((row) => row.name))
  const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const bundled = new Set(bundles)
  const deps = manifest?.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {}
  const installed = installedNames(manifest)
    .filter((name) => !coreSet.has(name))
    .map((name) => ({ name, version: versionOf(name), spec: typeof deps[name] === 'string' ? deps[name] : '', bundle: bundled.has(name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    config,
    core,
    installed,
    scheduler: (() => {
      try { return !!globalThis.__DSH_STARTUP_ORCH__ } catch (error) { return false }
    })(),
    files: { config: CONFIG_FILE, manifest: MANIFEST_FILE }
  }
}

function apply(ctx) {
  const disposers = []
  let bootDone = false
  let bootDoneReason = ''

  /** 把包内 lib/preload.mjs 部署到 $DSH_HOME/startup-orchestrator/（launcher 钩子的固定路径）。 */
  function ensurePreloadDeployed() {
    try {
      const source = fs.readFileSync(PRELOAD_SOURCE)
      let current = null
      try { current = fs.readFileSync(PRELOAD_TARGET) } catch (error) { current = null }
      if (current && Buffer.compare(current, source) === 0) return { status: 'present', file: PRELOAD_TARGET }
      fs.mkdirSync(path.dirname(PRELOAD_TARGET), { recursive: true })
      fs.writeFileSync(PRELOAD_TARGET, source)
      return { status: 'deployed', file: PRELOAD_TARGET, bytes: source.length }
    } catch (error) {
      return { status: 'error', file: PRELOAD_TARGET, detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 被编排管理的入口当前状态（诊断用，尤其确认没有被误置 disabled）。 */
  function managedEntrySnapshot(manifest) {
    const rows = []
    try {
      const config = readConfig(manifest)
      const names = new Set(config.items.map((row) => row.name))
      const loader = typeof ctx.get === 'function' ? ctx.get('loader') : undefined
      if (!loader) return rows
      for (const entry of loader.entries()) {
        const name = typeof entry.options?.name === 'string' ? entry.options.name : ''
        const id = typeof entry.options?.id === 'string' ? entry.options.id : ''
        let matched = names.has(name) || names.has(id)
        if (!matched) for (const item of names) if (name.startsWith(item + '/')) { matched = true; break }
        if (!matched) continue
        rows.push({
          id,
          name,
          disabled: (() => { try { return Boolean(entry.disabled) } catch (error) { return 'error' } })(),
          fiber: entry.fiber?.state ?? null
        })
      }
    } catch (error) { /* 诊断失败不影响启动 */ }
    return rows
  }

  const webServer = (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined) || ctx.webServer
  const canRoute = !!webServer && typeof webServer.register === 'function' && typeof webServer.tapIndex === 'function'

  function signalBootDone(reason) {
    if (bootDone) return
    bootDone = true
    bootDoneReason = String(reason || 'done')
    try { globalThis.__DSH_STARTUP_ORCH__?.bootDone?.(bootDoneReason) } catch (error) { /* 调度器不在也不影响 */ }
    logLine('boot-done', { reason: bootDoneReason, scheduler: (() => { try { return !!globalThis.__DSH_STARTUP_ORCH__ } catch (e) { return false } })() })
  }

  function rejected(req, res) {
    try {
      const conn = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined) || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch (error) {
      return false
    }
  }

  function sendJson(res, code, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Length': String(body.length)
    })
    res.end(body)
  }

  function readBody(req, limit = 256 * 1024) {
    return new Promise((resolve) => {
      let size = 0
      const chunks = []
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) { req.destroy(); resolve(''); return }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  logLine('apply', { configFile: CONFIG_FILE, canRoute, scheduler: (() => { try { return !!globalThis.__DSH_STARTUP_ORCH__ } catch (e) { return false } })() })

  // 包内 preload 是本插件代码的一部分；这里部署到 launcher 钩子的固定路径。
  // 更新插件后无需再手动复制 preload。
  const preloadDeploy = ensurePreloadDeployed()
  logLine('preload-deploy', preloadDeploy)

  // Portable 更新会覆盖 launcher，把 preload 注入钩子冲掉。每次启动自愈一次；
  // 修补后对“下一次启动”生效（当前进程早已由旧 launcher 拉起）。
  let launcherHook = null
  try {
    const portableRoot = path.resolve(DSH_HOME, '..', '..')
    launcherHook = ensureLauncherHook(portableRoot)
    logLine('launcher-hook', launcherHook)
  } catch (error) {
    launcherHook = { status: 'error', detail: error instanceof Error ? error.message : String(error) }
    logLine('launcher-hook', launcherHook)
  }

  // 兜底：页面始终不给信号时也要放行常用组，避免启动被永久卡住。
  const fallback = setTimeout(() => signalBootDone('server-timeout'), 180000)
  fallback.unref?.()

  if (!canRoute) {
    logLine('no-webserver', {})
    signalBootDone('no-webserver')
    return
  }

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/config',
    handler: async (req, res) => {
      if (rejected(req, res)) return
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'GET') {
        try {
          const manifest = readJson(MANIFEST_FILE)
          sendJson(res, 200, { ok: true, ...panelPayload(manifest) })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      if (method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      const text = await readBody(req)
      let payload
      try { payload = text ? JSON.parse(text) : {} } catch (error) { sendJson(res, 400, { ok: false, error: 'invalid json' }); return }
      try {
        const saved = saveConfig(payload && typeof payload.config === 'object' ? payload.config : payload)
        const manifest = readJson(MANIFEST_FILE)
        sendJson(res, 200, { ok: true, ...saved, ...panelPayload(manifest) })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/done',
    handler: async (req, res) => {
      if (rejected(req, res)) return
      const method = (req.method || 'GET').toUpperCase()
      if (method === 'GET') { sendJson(res, 200, { ok: true, bootDone, reason: bootDoneReason }); return }
      if (method !== 'POST') { sendJson(res, 405, { ok: false, error: 'method not allowed' }); return }
      let reason = 'page-signal'
      try {
        const text = await readBody(req)
        if (text) reason = String(JSON.parse(text)?.reason || reason)
      } catch (error) { /* 默认 reason */ }
      signalBootDone(reason)
      sendJson(res, 200, { ok: true, bootDone: true, reason })
    }
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/state',
    handler: (req, res) => {
      if (rejected(req, res)) return
      try {
        const manifest = readJson(MANIFEST_FILE)
        sendJson(res, 200, { ok: true, bootDone, reason: bootDoneReason, ...panelPayload(manifest), managedEntries: managedEntrySnapshot(manifest), launcherHook, preloadDeploy })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: ROUTE_BASE + '/client-ping',
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if ((req.method || 'GET').toUpperCase() !== 'POST') { sendJson(res, 405, { ok: false }); return }
      logLine('client-apply', {})
      sendJson(res, 200, { ok: true })
    }
  }))

  const CLIENT_SCRIPT = `(function(){try{
if(window.__DSH_STARTUP_ORCH_CLIENT__)return;
window.__DSH_STARTUP_ORCH_CLIENT__=true;
var sent=false;
function send(reason){
  if(sent)return;sent=true;
  try{
    fetch(${JSON.stringify(ROUTE_BASE + '/done')},{method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({reason:String(reason||'done'),at:Date.now()})}).catch(function(){});
  }catch(e){}
}
window.addEventListener('dsh-startup:done',function(){send('splash-event')},{once:true});
function check(){
  try{
    if(window.__DSH_STARTUP_SKIP__){send('splash-skipped');return;}
    if(window.__DSH_STARTUP_FAILED__){send('splash-failed');return;}
    var root=document.getElementById('dsh-startup-root');
    if(!root){send('no-splash');return;}
    var observer=new MutationObserver(function(){
      if(!document.getElementById('dsh-startup-root')){
        try{observer.disconnect();}catch(e){}
        send('splash-removed');
      }
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }catch(e){send('check-error');}
}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',check,{once:true});}
else{check();}
setTimeout(function(){send('client-timeout');},150000);
}catch(e){}})()`

  disposers.push(webServer.tapIndex((html) => {
    if (!html || html.includes(ROUTE_BASE + '/done')) return html
    const script = '<script>' + CLIENT_SCRIPT + '</script>'
    if (html.includes('</body>')) return html.replace('</body>', script + '</body>')
    return html + script
  }))

  ctx.effect(() => () => {
    clearTimeout(fallback)
    for (const dispose of disposers) { try { dispose() } catch (error) { /* noop */ } }
  })
}

const name = NS
const inject = ['webServer', 'connection']

export { apply, inject, name }
