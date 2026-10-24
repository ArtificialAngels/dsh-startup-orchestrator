/* dsh-startup-orchestrator — Host/配置单元检查（不启动 DSH）。
 * 运行：node test/orchestrator.test.mjs
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-orch-test-'))
const profileDir = path.join(testHome, 'profiles', 'web')
fs.mkdirSync(profileDir, { recursive: true })
const manifest = {
  name: 'dsh-profile-web',
  private: true,
  dependencies: {
    'dsh-plugin-a': '1.0.0',
    'dsh-plugin-b': '1.0.0',
    'dsh-startup-screen': '1.0.0',
    'dsh-pet': '0.3.8'
  },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-a', 'dsh-plugin-b', 'dsh-startup-screen']
    }
  }
}
fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
for (const name of ['dsh-plugin-a', 'dsh-plugin-b', 'dsh-startup-screen', 'dsh-pet']) {
  fs.mkdirSync(path.join(profileDir, 'node_modules', name), { recursive: true })
  fs.writeFileSync(path.join(profileDir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version: '9.9.9' }))
}
process.env.DSH_HOME = testHome
const { apply } = await import('../lib/index.js')

function makeRes() {
  return {
    statusCode: 200, body: '', headers: undefined,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers },
    end(body) { this.body = body ?? '' }
  }
}
function makeReq(method, body) {
  const req = new EventEmitter()
  req.method = method
  req.bodyText = body
  return req
}
function finish(req) {
  if (req.bodyText !== undefined) req.emit('data', Buffer.from(req.bodyText, 'utf8'))
  req.emit('end')
}

const routes = new Map()
const injected = []
const cleanups = []
const ctx = {
  get(service) {
    if (service === 'webServer') {
      return {
        register(route) { routes.set(route.path, route); return () => routes.delete(route.path) },
        tapIndex(fn) { injected.push(fn); return () => {} }
      }
    }
    if (service === 'connection') return { requestRejection: () => undefined }
    return undefined
  },
  effect(fn) { cleanups.push(fn()) },
  logger: { info() {}, warn() {} }
}
apply(ctx)

// 包内 preload 应被部署到 $DSH_HOME/startup-orchestrator/preload.mjs
const deployedPreload = path.join(testHome, 'startup-orchestrator', 'preload.mjs')
assert.equal(fs.existsSync(deployedPreload), true, 'preload deployed from package lib')
assert.ok(fs.statSync(deployedPreload).size > 1000, 'deployed preload is non-empty')

async function call(method, routePath, payload) {
  const route = routes.get(routePath)
  assert.ok(route, routePath + ' registered')
  const req = makeReq(method, payload === undefined ? undefined : JSON.stringify(payload))
  const res = makeRes()
  const pending = route.handler(req, res)
  if (method === 'POST') finish(req)
  await pending
  return res
}

// 1) 初始配置：核心锁定、开机启动默认、关闭项仍可见
const initial = JSON.parse((await call('GET', '/startup-orchestrator/config')).body)
assert.equal(initial.ok, true)
assert.ok(initial.core.some((row) => row.name === '@deepseek-ai/dsh-base'))
assert.ok(!initial.config.items.some((row) => row.name === '@deepseek-ai/dsh-base'), 'core stays out of editable items')
assert.deepEqual(initial.config.items.filter((row) => row.group === 'boot').map((row) => row.name), ['dsh-startup-screen'])
const pet = initial.config.items.find((row) => row.name === 'dsh-pet')
assert.equal(pet.group, 'common')
assert.equal(pet.enabled, false, 'installed but not bundled => disabled')

// 2) 保存：调整顺序、打开 pet、关闭 plugin-b
const next = JSON.parse(JSON.stringify(initial.config))
const order = ['dsh-plugin-a', 'dsh-pet']
next.items = next.items.filter((row) => row.name !== 'dsh-pet')
for (const name of order) {
  const row = initial.config.items.find((item) => item.name === name) || { name, group: 'common', enabled: true }
  next.items.push({ name, group: 'common', enabled: true })
}
next.items.find((row) => row.name === 'dsh-plugin-b').enabled = false
next.groups.common.waitMs = 250
const saved = JSON.parse((await call('POST', '/startup-orchestrator/config', { config: next })).body)
assert.equal(saved.ok, true)
assert.equal(saved.restartRequired, true)
const written = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
assert.deepEqual(written.dsh.profile.bundles, [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  'dsh-startup-screen',
  'dsh-plugin-a',
  'dsh-pet'
])
const configOnDisk = JSON.parse(fs.readFileSync(path.join(testHome, 'startup-orchestrator.json'), 'utf8'))
assert.equal(configOnDisk.groups.common.waitMs, 250)
assert.ok(configOnDisk.items.some((row) => row.name === 'dsh-plugin-b' && row.enabled === false))
assert.ok(!configOnDisk.items.some((row) => row.name === '@deepseek-ai/dsh-base'))

// 2b) 顺序持久化：把常用组顺序反转后保存，读回应保持同一顺序
const bootRows = saved.config.items.filter((row) => row.group === 'boot')
const commonRows = saved.config.items.filter((row) => row.group === 'common')
const reversedCommon = [...commonRows].reverse()
await call('POST', '/startup-orchestrator/config', { config: { ...saved.config, items: [...bootRows, ...reversedCommon] } })
const readBack = JSON.parse((await call('GET', '/startup-orchestrator/config')).body)
assert.deepEqual(
  readBack.config.items.filter((row) => row.group === 'common').map((row) => row.name),
  reversedCommon.map((row) => row.name),
  'common group keeps the saved order'
)

// 3) page done 信号
await call('POST', '/startup-orchestrator/done', { reason: 'test' })
const state = JSON.parse((await call('GET', '/startup-orchestrator/state')).body)
assert.equal(state.bootDone, true)
assert.ok(['deployed', 'present'].includes(state.preloadDeploy?.status), 'state reports deployed preload')

// 4) 页面注入脚本存在
assert.ok(injected.length >= 1)
const html = injected[0]('<html><body></body></html>')
assert.match(html, /startup-orchestrator\/done/, 'injects completion script')
assert.match(html, /dsh-startup:done/)
const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html)
assert.ok(scriptMatch, 'injected script tag')
assert.doesNotThrow(() => new Function(scriptMatch[1]), 'injected script parses')
assert.match(scriptMatch[1], /data-wp-intro/, 'waits for media-wallpaper intro layer')
assert.match(scriptMatch[1], /dsh-plugin-media-wallpaper\.settings\.v1/, 'reads media-wallpaper settings')

for (const cleanup of cleanups) cleanup()
fs.rmSync(testHome, { recursive: true, force: true })
console.log('dsh-startup-orchestrator host checks: PASS')
