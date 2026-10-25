/* dsh-startup-orchestrator — 兼容性双门槛验证（DSH 0.2.1-rc.3 适配）
 *
 * 复现 DSH 的两处插件兼容性判定（都用宿主自带的 semver，includePrerelease:true）：
 *   [a] app-boot：manifest.engines.dsh 必须满足当前 dsh runtime 版本；
 *   [b] Portable launcher：peerDependencies 里每个 @deepseek-ai/* 的宿主版本必须满足范围。
 *
 * 用法：
 *   node scripts/check-compat.mjs [--app <runtime app 目录>]
 *   app 目录可用 DSH_APP_ROOT / DSH_PORTABLE_RUNTIME_ROOT 指定；
 *   缺省扫描 %LOCALAPPDATA%\DSH-Portable\runtime-cache\*\app。
 *
 * 退出码 0 = 两道门槛都通过；1 = 有不满足项。
 */

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { installedVersion, resolveAppRoot } from './runtime-app.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))

const appRoot = resolveAppRoot()
if (!appRoot) {
  console.error('check-compat: 未找到 runtime app 目录（用 --app 或 DSH_APP_ROOT 指定）')
  process.exit(1)
}
const semverFile = path.join(appRoot, 'node_modules', 'semver', 'index.js')
const semver = createRequire(import.meta.url)(semverFile)
const semverVersion = JSON.parse(fs.readFileSync(path.join(appRoot, 'node_modules', 'semver', 'package.json'), 'utf8')).version
const dshVersion = installedVersion(appRoot, '@deepseek-ai/dsh') || installedVersion(appRoot, '@deepseek-ai/dsh-app-boot')

const includePrerelease = { includePrerelease: true }
const check = (range, version) => typeof range === 'string' && range.trim() !== '' && semver.satisfies(version, range, includePrerelease)

const failures = []
console.log(`check-compat: ${manifest.name}@${manifest.version}`)
console.log(`  app: ${appRoot}`)
console.log(`  dsh runtime: ${dshVersion}   semver@${semverVersion}   flags=${JSON.stringify(includePrerelease)}`)

// [a] app-boot engines.dsh 门槛
const enginesRange = manifest.engines?.dsh
const enginesOk = check(enginesRange, dshVersion)
console.log(`[a] app-boot engines.dsh: satisfies('${dshVersion}', '${enginesRange}', includePrerelease) = ${enginesOk}`)
if (!enginesOk) failures.push(`engines.dsh "${enginesRange}" 不满足 dsh ${dshVersion}`)
const boundaries = ['0.2.1-rc.4', '0.2.2', '0.3.0'].map((version) => `${version}=${check(enginesRange, version)}`)
console.log(`    boundary: ${boundaries.join('  ')}`)

// [b] launcher peerDependencies 门槛（只取 @deepseek-ai/*，与 launcher 的生产依赖检查一致）
const peers = Object.entries(manifest.peerDependencies || {}).filter(([name]) => name.startsWith('@deepseek-ai/'))
for (const [name, range] of peers) {
  const version = installedVersion(appRoot, name)
  const ok = version !== '' && check(range, version)
  console.log(`[b] launcher peer: ${name} range='${range}' installed=${version || '<missing>'} satisfies=${ok}`)
  if (!ok) failures.push(`peer ${name} 范围 "${range}" 不满足已安装版本 ${version || '<missing>'}`)
}
const skipped = Object.entries(manifest.peerDependencies || {}).filter(([name]) => !name.startsWith('@deepseek-ai/')).map(([name]) => name)
if (skipped.length) console.log(`    (非 @deepseek-ai peer，launcher 不检查，跳过：${skipped.join(', ')})`)

if (failures.length) {
  console.error(`check-compat: FAIL — ${failures.join('；')}`)
  process.exit(1)
}
console.log('check-compat: PASS（app-boot engines 门槛 + launcher peer 门槛均通过）')
