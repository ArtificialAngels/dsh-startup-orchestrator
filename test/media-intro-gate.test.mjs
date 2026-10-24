/* media-wallpaper 开屏等待的启用条件（Host 侧纯函数）。
 * 运行：node test/media-intro-gate.test.mjs
 */
import assert from 'node:assert/strict'

import { mediaIntroGate } from '../lib/index.js'

const manifest = {
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', 'dsh-plugin-media-wallpaper']
    }
  }
}
const bootItem = { name: 'dsh-plugin-media-wallpaper', group: 'boot', enabled: true }

assert.equal(mediaIntroGate({ items: [bootItem] }, manifest), true, 'boot + enabled + bundled => wait')
assert.equal(mediaIntroGate({ items: [{ ...bootItem, group: 'common' }] }, manifest), false, 'common => no wait (deadlock)')
assert.equal(mediaIntroGate({ items: [{ ...bootItem, enabled: false }] }, manifest), false, 'disabled => no wait')
assert.equal(mediaIntroGate({ items: [bootItem] }, { dsh: { profile: { bundles: [] } } }), false, 'not bundled => no wait')
assert.equal(mediaIntroGate({ items: [] }, manifest), false, 'not configured => no wait')

console.log('media intro gate checks: PASS')
