/* launcher 钩子自愈的锚点/幂等/语法校验回归。
 * 运行：node test/launcher-hook.test.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ensureLauncherHook } from '../lib/launcher-hook.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-launcher-hook-'))
const launcherDir = path.join(root, 'launcher')
fs.mkdirSync(launcherDir, { recursive: true })
const file = path.join(launcherDir, 'portable-cli.mjs')
const source = [
  "import { existsSync } from 'node:fs'",
  "import path from 'node:path'",
  '',
  'const buildDshEnv = (layout) => ({ DSH_HOME: layout.dshHome })',
  'const child = spawn(layout.nodeExe, [], {',
  '  env: {',
  '    ...buildDshEnv(layout),',
  '    DSH_PORTABLE_CONTROL_PIPE: controlPipe,',
  '    DSH_PORTABLE_CONTROL_TOKEN: controlToken,',
  '  },',
  '})',
  ''
].join('\n')
fs.writeFileSync(file, source)

const first = ensureLauncherHook(root)
assert.equal(first.status, 'patched')
const patched = fs.readFileSync(file, 'utf8')
assert.match(patched, /startupOrchestratorNodeOptions/)
assert.match(patched, /\.\.\.buildDshEnv\(layout\),\n\s+\.\.\.startupOrchestratorNodeOptions\(layout\),\n\s+DSH_PORTABLE_CONTROL_PIPE/)
const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
assert.equal(check.status, 0, check.stderr || 'patched launcher must parse')
const second = ensureLauncherHook(root)
assert.equal(second.status, 'present')
assert.equal(fs.readFileSync(file, 'utf8'), patched, 'idempotent')

// 锚点不匹配时不破坏文件
fs.writeFileSync(file, "import path from 'node:path'\nconst x = 1\n")
const before = fs.readFileSync(file, 'utf8')
const missing = ensureLauncherHook(root)
assert.equal(missing.status, 'anchor-missing')
assert.equal(fs.readFileSync(file, 'utf8'), before)

fs.rmSync(root, { recursive: true, force: true })
console.log('launcher hook checks: PASS')
