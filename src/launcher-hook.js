/* 启动编排 launcher 钩子自愈。
 *
 * Portable 更新会整包覆盖 launcher/portable-cli.mjs，把注入 preload 的
 * NODE_OPTIONS 片段冲掉。这里做幂等修补：
 *   1) 在 host 的 spawn env 里（...buildDshEnv(layout) 之后、控制管道字段之前）
 *      插入 ...startupOrchestratorNodeOptions(layout)；
 *   2) 在 import path 之后插入该辅助函数；
 *   3) 写前备份，写后用当前 node --check 校验，失败自动还原。
 *
 * 只在锚点结构匹配时动手；版本差异导致锚点变化时返回 anchor-missing，不破坏文件。
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const MARK = 'startupOrchestratorNodeOptions'
const HELPER = String.raw`
/** startup-orchestrator:preload-hook —— 在 host 进程注入启动编排 preload。 */
function startupOrchestratorNodeOptions(layout) {
  try {
    const preload = path.join(layout.dshHome, 'startup-orchestrator', 'preload.mjs')
    if (!existsSync(preload)) return {}
    const url = process.getBuiltinModule('node:url').pathToFileURL(preload).href
    const current = String(process.env.NODE_OPTIONS || '').trim()
    return { NODE_OPTIONS: current ? current + ' --import=' + url : '--import=' + url }
  } catch (error) {
    return {}
  }
}
`

/** 给 launcher 注入 preload 钩子；幂等、可重复调用。 */
export function ensureLauncherHook(root, logger = () => {}) {
  const file = path.join(root, 'launcher', 'portable-cli.mjs')
  let source
  try {
    source = fs.readFileSync(file, 'utf8')
  } catch (error) {
    return { status: 'launcher-missing', file }
  }
  const hasHelper = source.includes(MARK)
  const hasSpawnHook = /\.\.\.startupOrchestratorNodeOptions\(layout\),/.test(source)
  if (hasHelper && hasSpawnHook) return { status: 'present', file }

  let next = source
  if (!hasHelper) {
    const importAnchor = /import path from 'node:path'(\r?\n)/
    if (!importAnchor.test(next)) return { status: 'anchor-missing', file, anchor: 'import-path' }
    next = next.replace(importAnchor, (match, newline) => match + HELPER.replace(/^\n/, '') + newline)
  }
  if (!/\.\.\.startupOrchestratorNodeOptions\(layout\),/.test(next)) {
    const envAnchor = /(\.\.\.buildDshEnv\(layout\),)(\r?\n)([ \t]+)(DSH_PORTABLE_CONTROL_PIPE: controlPipe,)/
    if (!envAnchor.test(next)) return { status: 'anchor-missing', file, anchor: 'host-spawn-env' }
    next = next.replace(envAnchor, (match, spread, newline, indent, control) => {
      return `${spread}${newline}${indent}...${MARK}(layout),${newline}${indent}${control}`
    })
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${file}.before-orchestrator-${stamp}`
  try {
    fs.copyFileSync(file, backup)
    fs.writeFileSync(file, next, 'utf8')
  } catch (error) {
    try { if (fs.existsSync(backup) && fs.readFileSync(file, 'utf8') !== source) fs.copyFileSync(backup, file) } catch (restoreError) { /* 忽略 */ }
    return { status: 'write-failed', file, detail: error instanceof Error ? error.message : String(error) }
  }

  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true })
  if (check.status !== 0) {
    try { fs.copyFileSync(backup, file) } catch (error) { /* 忽略 */ }
    return { status: 'syntax-failed', file, detail: String(check.stderr || check.error || '').slice(-2000) }
  }
  logger(`[startup-orchestrator] launcher preload hook installed: ${file}`)
  return { status: 'patched', file, backup }
}
