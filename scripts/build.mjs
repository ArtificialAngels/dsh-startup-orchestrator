import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  ['src/index.js', 'lib/index.js'],
  ['src/client.js', 'lib/client.js'],
  ['src/launcher-hook.js', 'lib/launcher-hook.js'],
  ['src/preload.mjs', 'lib/preload.mjs']
]

mkdirSync(path.join(root, 'lib'), { recursive: true })
for (const [source, target] of files) {
  copyFileSync(path.join(root, source), path.join(root, target))
  const check = spawnSync(process.execPath, ['--check', path.join(root, target)], { encoding: 'utf8', windowsHide: true })
  if (check.status !== 0) {
    process.stderr.write(`build: syntax check failed for ${target}\n${check.stderr || check.error || ''}\n`)
    process.exit(1)
  }
}

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
const banner = /__ModuleLoader__\.load\(\{\s*id:\s*['"]([^'"]+)['"]/.exec(client)
if (!banner || banner[1] !== manifest.name) {
  process.stderr.write(`build: client loader id ${banner ? JSON.stringify(banner[1]) : '<missing>'} does not match package name ${manifest.name}\n`)
  process.exit(1)
}
writeFileSync(path.join(root, 'lib/.build-stamp'), `${new Date().toISOString()} ${manifest.version}\n`)
console.log(`built ${files.length} files for ${manifest.name}@${manifest.version}`)
