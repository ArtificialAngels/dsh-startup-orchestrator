/**
 * dsh-startup-orchestrator — 浏览器半侧（设置页「启动编排」）
 * ----------------------------------------------------------------------------
 * 手写 ModuleLoader bundle（与 dsh-startup-screen 同款，无需构建）。
 * 注册 settings.section：三组（核心 / 开机启动 / 常用）、顺序、等待时间、
 * 启动加载开关。数据走 Host 的 /startup-orchestrator/config。
 */
window.__ModuleLoader__.load({
  id: 'dsh-startup-orchestrator',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useCallback = react.useCallback

    var API = '/startup-orchestrator/config'
    var BOOT_DEFAULT = ['dsh-startup-screen', 'dsh-ops']

    var CSS = [
      '.__so_root{max-width:720px;display:flex;flex-direction:column;gap:14px;font-size:13px;color:var(--dsw-alias-label-primary)}',
      '.__so_head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}',
      '.__so_title{font-size:14px;font-weight:600}',
      '.__so_sub{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.__so_grow{flex:1}',
      '.__so_section{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-2,transparent)}',
      '.__so_sectionHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.__so_sectionTitle{font-size:12px;font-weight:600;letter-spacing:.04em}',
      '.__so_badge{font-size:10px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
      '.__so_badgeOn{color:var(--dsw-alias-state-business-primary,#3964fe);border-color:currentColor}',
      '.__so_hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-tertiary)}',
      '.__so_controls{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}',
      '.__so_field{display:flex;flex-direction:column;gap:4px}',
      '.__so_label{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.__so_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px;width:104px;box-sizing:border-box;outline:none}',
      '.__so_input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.__so_check{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;user-select:none}',
      '.__so_check input{accent-color:var(--dsw-alias-state-business-primary)}',
      '.__so_list{display:flex;flex-direction:column;gap:6px}',
      '.__so_row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3,transparent)}',
      '.__so_rowOff{opacity:.55}',
      '.__so_idx{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:18px;text-align:right}',
      '.__so_name{font-size:12px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__so_ver{font-size:10px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Consolas,monospace}',
      '.__so_tag{font-size:10px;padding:1px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
      '.__so_btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:7px;padding:3px 8px;font:inherit;font-size:11px;cursor:pointer}',
      '.__so_btn:disabled{opacity:.4;cursor:default}',
      '.__so_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary)}',
      '.__so_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#3964fe);background:var(--dsw-alias-state-business-primary,#3964fe);color:#fff;padding:6px 16px;font-size:12px;border-radius:8px}',
      '.__so_coreList{display:flex;flex-wrap:wrap;gap:6px}',
      '.__so_coreChip{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace}',
      '.__so_actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:2px}',
      '.__so_msg{font-size:12px}',
      '.__so_ok{color:var(--dsw-alias-state-business-primary,#3964fe)}',
      '.__so_err{color:var(--dsw-alias-state-error-primary,#f85149)}',
      '.__so_timeline{font-size:11px;line-height:1.7;color:var(--dsw-alias-label-tertiary)}'
    ].join('')
    var tagId = 'dsh-startup-orchestrator/main.css'
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
      var style = document.createElement('style')
      style.dataset.plugin = 'dsh-startup-orchestrator'
      style.dataset.pluginCss = tagId
      style.textContent = CSS
      document.head.appendChild(style)
    }

    function clone(value) { return JSON.parse(JSON.stringify(value)) }

    function defaultConfig(data) {
      var items = (data.installed || []).map(function (row) {
        return { name: row.name, group: BOOT_DEFAULT.indexOf(row.name) >= 0 ? 'boot' : 'common', enabled: !!row.bundle }
      })
      return {
        version: 1,
        enabled: true,
        groups: {
          boot: { waitMs: 0, intervalMs: 150, waitForAnimation: false, readyTimeoutMs: 120000 },
          common: { waitMs: 500, intervalMs: 300, waitForAnimation: true, readyTimeoutMs: 120000 }
        },
        items: items
      }
    }

    function groupItems(config, group) {
      return (config.items || []).filter(function (row) { return row.group === group })
    }

    function Input(props) {
      return h('input', {
        className: '__so_input', type: 'number', min: 0, step: 50,
        value: props.value,
        onChange: function (event) { props.onChange(Number(event.target.value)) }
      })
    }

    function GroupEditor(props) {
      var config = props.config
      var group = props.group
      var cfg = config.groups[group]
      var items = groupItems(config, group)
      var mutate = props.mutate

      function setGroupField(key, value) {
        mutate(function (next) { next.groups[group][key] = value })
      }

      function move(index, delta) {
        mutate(function (next) {
          // mutate 会 deep clone 配置：items[index] 是旧对象引用，不能拿去
          // next.items 里 indexOf（会返回 -1）；按 next 的数组索引交换。
          var list = groupItems(next, group)
          var target = index + delta
          if (target < 0 || target >= list.length) return
          var all = next.items
          var current = list[index]
          var other = list[target]
          var currentIndex = all.indexOf(current)
          var otherIndex = all.indexOf(other)
          if (currentIndex < 0 || otherIndex < 0) return
          all[currentIndex] = other
          all[otherIndex] = current
        })
      }

      function toggle(index) {
        mutate(function (next) {
          var row = groupItems(next, group)[index]
          row.enabled = !row.enabled
        })
      }

      function switchGroup(index) {
        mutate(function (next) {
          var list = groupItems(next, group)
          var row = list[index]
          row.group = group === 'boot' ? 'common' : 'boot'
        })
      }

      return h('section', { className: '__so_section' },
        h('div', { className: '__so_sectionHead' },
          h('span', { className: '__so_sectionTitle' }, group === 'boot' ? '② 开机启动项' : '③ 常用插件'),
          h('span', { className: '__so_badge' }, group === 'boot' ? '核心之后、常用之前' : '默认等开机动画结束'),
          h('span', { className: '__so_grow' }),
          h('span', { className: '__so_hint' }, items.length + ' 项')
        ),
        h('div', { className: '__so_controls' },
          h('label', { className: '__so_field' },
            h('span', { className: '__so_label' }, '组开始前等待 (ms)'),
            h(Input, { value: cfg.waitMs, onChange: function (value) { setGroupField('waitMs', Math.max(0, value)) } })
          ),
          h('label', { className: '__so_field' },
            h('span', { className: '__so_label' }, '组内每项间隔 (ms)'),
            h(Input, { value: cfg.intervalMs, onChange: function (value) { setGroupField('intervalMs', Math.max(0, value)) } })
          ),
          group === 'common'
            ? h('label', { className: '__so_check' },
                h('input', {
                  type: 'checkbox', checked: cfg.waitForAnimation === true,
                  onChange: function (event) { setGroupField('waitForAnimation', event.target.checked) }
                }),
                '等待开机动画播完'
              )
            : null
        ),
        h('div', { className: '__so_hint' },
          group === 'common'
            ? '顺序：核心组全部就绪 → 开机动画结束（或关闭此项时仅等待上方时长）→ 常用插件按下面的顺序逐个加载。'
            : '顺序：核心组全部就绪 → 等待上方时长 → 开机启动项按下面的顺序逐个加载。'
        ),
        h('div', { className: '__so_list' },
          items.length === 0
            ? h('div', { className: '__so_hint' }, '这一组还没有插件。可将常用插件移到这里。')
            : items.map(function (row, index) {
                return h('div', { className: '__so_row' + (row.enabled ? '' : ' __so_rowOff'), key: row.name },
                  h('input', {
                    type: 'checkbox', checked: row.enabled !== false,
                    title: row.enabled ? '从启动加载中关闭' : '重新加入启动加载',
                    onChange: function () { toggle(index) }
                  }),
                  h('span', { className: '__so_idx' }, String(index + 1)),
                  h('span', { className: '__so_name', title: row.name }, row.name),
                  h('span', { className: '__so_ver' }, props.versions[row.name] || ''),
                  row.enabled ? null : h('span', { className: '__so_tag' }, '关闭'),
                  h('span', { className: '__so_grow' }),
                  h('button', {
                    type: 'button', className: '__so_btn', disabled: index === 0,
                    onClick: function () { move(index, -1) }, title: '上移'
                  }, '↑'),
                  h('button', {
                    type: 'button', className: '__so_btn', disabled: index === items.length - 1,
                    onClick: function () { move(index, 1) }, title: '下移'
                  }, '↓'),
                  h('button', {
                    type: 'button', className: '__so_btn',
                    onClick: function () { switchGroup(index) },
                    title: group === 'boot' ? '移到常用插件' : '移到开机启动项'
                  }, group === 'boot' ? '→常用' : '→开机')
                )
              })
        )
      )
    }

    function Panel() {
      var state = useState({ loading: true, error: '', saving: false, message: '', data: null })
      var view = state[0]
      var setView = state[1]

      var load = useCallback(function () {
        setView(function (prev) { return { ...prev, loading: true, error: '' } })
        fetch(API, { cache: 'no-store' })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || '加载失败')
            setView({ loading: false, error: '', saving: false, message: '', data: payload })
          })
          .catch(function (error) { setView({ loading: false, error: String(error && error.message || error), saving: false, message: '', data: null }) })
      }, [])

      useEffect(function () { load() }, [load])

      var data = view.data
      if (view.loading) return h('div', { className: '__so_root' }, h('div', { className: '__so_hint' }, '正在读取启动编排…'))
      if (view.error) {
        return h('div', { className: '__so_root' },
          h('div', { className: '__so_err' }, view.error),
          h('div', { className: '__so_actions' }, h('button', { type: 'button', className: '__so_btn', onClick: load }, '重试'))
        )
      }

      var config = data.config
      var versions = {}
      ;(data.installed || []).forEach(function (row) { versions[row.name] = row.version || '' })

      var mutate = function (fn) {
        setView(function (prev) {
          var next = clone(prev)
          fn(next.data.config)
          next.message = ''
          return next
        })
      }

      var save = function () {
        setView(function (prev) { return { ...prev, saving: true, message: '', error: '' } })
        fetch(API, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: view.data.config })
        })
          .then(function (response) { return response.json() })
          .then(function (payload) {
            if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || '保存失败')
            setView({ loading: false, error: '', saving: false, message: '已保存。重启 DSH 后按新顺序加载。', data: payload })
          })
          .catch(function (error) { setView(function (prev) { return { ...prev, saving: false, error: String(error && error.message || error) } }) })
      }

      var reset = function () {
        mutate(function (next) {
          var defaults = defaultConfig(data)
          next.enabled = true
          next.groups = defaults.groups
          next.items = defaults.items
        })
      }

      var bootItems = groupItems(config, 'boot').filter(function (row) { return row.enabled })
      var commonItems = groupItems(config, 'common').filter(function (row) { return row.enabled })

      return h('div', { className: '__so_root' },
        h('div', { className: '__so_head' },
          h('div', { className: '__so_grow' },
            h('div', { className: '__so_title' }, '启动编排'),
            h('div', { className: '__so_sub' },
              '按三组顺序加载插件：核心 → 开机启动项 → 常用插件。保存后需要重启 DSH 生效。',
              data.scheduler ? ' 进程调度器已加载。' : ' 进程调度器未加载：重启后由 launcher 注入生效。'
            )
          ),
          h('label', { className: '__so_check' },
            h('input', {
              type: 'checkbox', checked: config.enabled !== false,
              onChange: function (event) { mutate(function (next) { next.enabled = event.target.checked }) }
            }),
            '启用启动编排'
          )
        ),
        h('div', { className: '__so_timeline' },
          '核心组：' + (data.core || []).length + ' 项（锁定）　→　开机启动项：' + bootItems.length + ' 项　→　常用插件：' + commonItems.length + ' 项'
        ),
        h('section', { className: '__so_section' },
          h('div', { className: '__so_sectionHead' },
            h('span', { className: '__so_sectionTitle' }, '① 核心'),
            h('span', { className: '__so_badge __so_badgeOn' }, '锁定'),
            h('span', { className: '__so_grow' }),
            h('span', { className: '__so_hint' }, 'DSH 核心与启动编排自身，最早加载，不能删除或排序')
          ),
          h('div', { className: '__so_coreList' },
            (data.core || []).map(function (row) {
              return h('span', { className: '__so_coreChip', key: row.name, title: row.name }, row.name + (row.version ? ' · ' + row.version : ''))
            })
          )
        ),
        h(GroupEditor, { group: 'boot', config: config, versions: versions, mutate: mutate }),
        h(GroupEditor, { group: 'common', config: config, versions: versions, mutate: mutate }),
        h('div', { className: '__so_actions' },
          h('button', { type: 'button', className: '__so_btn __so_btnPrimary', disabled: view.saving, onClick: save }, view.saving ? '保存中…' : '保存'),
          h('button', { type: 'button', className: '__so_btn', disabled: view.saving, onClick: load }, '重新读取'),
          h('button', { type: 'button', className: '__so_btn', disabled: view.saving, onClick: reset }, '恢复推荐分组')
        ),
        view.message ? h('div', { className: '__so_msg __so_ok' }, view.message) : null,
        view.error ? h('div', { className: '__so_msg __so_err' }, view.error) : null,
        h('div', { className: '__so_hint' },
          '关闭某项后保存：该插件会从 profile 的 dsh.profile.bundles 移除（重启后不加载），不会出现「停用待生效」。'
        )
      )
    }

    var inject = ['slots']

    function apply(ctx) {
      try {
        fetch('/startup-orchestrator/client-ping', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {})
      } catch (error) { /* ping 失败不影响面板 */ }
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register(
          { name: 'settings.section', id: 'startup-orchestrator', order: 27, label: '启动编排' },
          function () { return h(Panel, {}) }
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  }
})
