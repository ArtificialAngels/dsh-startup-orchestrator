/* 手动重打 launcher 钩子（Portable 更新后可用；插件启动时也会自动自愈）。
 * 运行：E:\DSH-Portable\runtime\node\node.exe scripts\ensure-launcher-hook.mjs [portableRoot]
 */
import { ensureLauncherHook } from '../lib/launcher-hook.js'

const root = process.argv[2] || 'E:\\DSH-Portable'
const result = ensureLauncherHook(root, (line) => console.log(line))
console.log(JSON.stringify(result, null, 2))
