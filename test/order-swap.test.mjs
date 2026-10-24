/* 面板 move() 的克隆/交换语义回归（不依赖 React）。
 * 运行：node test/order-swap.test.mjs
 */
import assert from 'node:assert/strict'

// 与 client.js 中 Panel.mutate + GroupEditor.move 相同的语义：
// mutate 先 JSON 深拷贝，旧引用在拷贝里不存在；move 必须用 next 的数组索引。
function clone(value) { return JSON.parse(JSON.stringify(value)) }

function groupItems(config, group) {
  return config.items.filter((row) => row.group === group)
}

function makeState() {
  return {
    data: {
      config: {
        items: [
          { name: 'boot-a', group: 'boot', enabled: true },
          { name: 'boot-b', group: 'boot', enabled: true },
          { name: 'a', group: 'common', enabled: true },
          { name: 'b', group: 'common', enabled: true },
          { name: 'c', group: 'common', enabled: true }
        ]
      }
    }
  }
}

function move(state, group, index, delta) {
  const next = clone(state)
  const list = groupItems(next.data.config, group)
  const target = index + delta
  if (target < 0 || target >= list.length) return state
  const all = next.data.config.items
  const current = list[index]
  const other = list[target]
  const currentIndex = all.indexOf(current)
  const otherIndex = all.indexOf(other)
  if (currentIndex < 0 || otherIndex < 0) return state
  all[currentIndex] = other
  all[otherIndex] = current
  return next
}

let state = makeState()
state = move(state, 'common', 0, 1)
assert.deepEqual(groupItems(state.data.config, 'common').map((row) => row.name), ['b', 'a', 'c'])
state = move(state, 'common', 2, -1)
assert.deepEqual(groupItems(state.data.config, 'common').map((row) => row.name), ['b', 'c', 'a'])
state = move(state, 'common', 0, -1)
assert.deepEqual(groupItems(state.data.config, 'common').map((row) => row.name), ['b', 'c', 'a'], 'first item cannot move up')
state = move(state, 'common', 2, 1)
assert.deepEqual(groupItems(state.data.config, 'common').map((row) => row.name), ['b', 'c', 'a'], 'last item cannot move down')
state = move(state, 'boot', 0, 1)
assert.deepEqual(groupItems(state.data.config, 'boot').map((row) => row.name), ['boot-b', 'boot-a'])
assert.deepEqual(groupItems(state.data.config, 'common').map((row) => row.name), ['b', 'c', 'a'], 'other group untouched')
console.log('order swap checks: PASS')
