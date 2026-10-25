/* dsh-startup-orchestrator — 定位当前 DSH runtime（app 目录）的小工具。
 * 仅用于 scripts/check-*.mjs 这类开发期复核脚本，不随包发布。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * 解析 DSH runtime 的 app 根目录（含 node_modules/@deepseek-ai/...）。
 * 优先级：--app <dir> > DSH_APP_ROOT > DSH_PORTABLE_RUNTIME_ROOT > 最新 runtime-cache。
 * @param {string[]} argv
 * @returns {string} 绝对路径；未找到时返回空字符串。
 */
export function resolveAppRoot(argv = process.argv) {
  const argi = argv.indexOf('--app')
  if (argi >= 0 && argv[argi + 1]) return path.resolve(argv[argi + 1])
  if (process.env.DSH_APP_ROOT) return path.resolve(process.env.DSH_APP_ROOT)
  if (process.env.DSH_PORTABLE_RUNTIME_ROOT) return path.resolve(process.env.DSH_PORTABLE_RUNTIME_ROOT)
  const cache = path.join(resolveLocalAppData(), 'DSH-Portable', 'runtime-cache')
  let entries = []
  try { entries = fs.readdirSync(cache, { withFileTypes: true }).filter((row) => row.isDirectory()) } catch (error) { entries = [] }
  const candidates = entries
    .map((row) => path.join(cache, row.name, 'app'))
    .filter((app) => fs.existsSync(path.join(app, 'node_modules', '@deepseek-ai', 'cordis-plugin-loader', 'lib', 'index.js')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return candidates[0] || ''
}

function resolveLocalAppData() {
  if (process.env.LOCALAPPDATA) return process.env.LOCALAPPDATA
  return path.join(os.homedir(), 'AppData', 'Local')
}

/** 读取 app 内已安装包的版本（package.json 的 version）。 */
export function installedVersion(appRoot, packageName) {
  try {
    const file = path.join(appRoot, 'node_modules', packageName, 'package.json')
    return JSON.parse(fs.readFileSync(file, 'utf8')).version || ''
  } catch (error) {
    return ''
  }
}
