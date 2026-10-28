window.__ModuleLoader__.load({
  id: 'dsh-session-trash',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const NS = 'session-trash'
    const API = '/session-trash/api'
    /**
     * Session ids the user deleted, kept in the browser so the sidebar can stop
     * rendering them regardless of how the Host still lists them.
     *
     * The sidebar is the only place that decides whether a row is drawn, and the
     * Host has no way to drop a live session from memory. So "the entry must be
     * gone at render time" has to be answered here: the Host still returns the
     * chat for a while, the browser simply stops drawing it.
     */
    const HIDDEN_KEY = 'dsh-session-trash.hidden.v1'
    function readHidden() {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '[]')
        return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [])
      } catch {
        return new Set()
      }
    }
    let hidden = readHidden()
    function writeHidden() {
      try {
        window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]))
      } catch {
        // Storage being unavailable must not break deletion; it only loses the
        // extra guarantee for a later refresh.
      }
    }

    const zh = {
      'menu.delete': '删除对话',
      'menu.deleteHint': '删除后可在回收站恢复',
      'panel.title': '回收站',
      'panel.subtitle': '删除的对话保留 {days} 天，到期后自动永久删除',
      'panel.empty': '回收站是空的',
      'panel.emptyHint': '在会话菜单里选择「删除对话」即可移入回收站',
      'panel.count': '共 {n} 条',
      'panel.refresh': '刷新',
      'panel.emptyAll': '清空回收站',
      'panel.restore': '恢复',
      'panel.purge': '彻底删除',
      'panel.deletedAt': '删除于 {time}',
      'panel.remaining': '剩余 {time}',
      'panel.expired': '即将删除',
      'panel.untitled': '未命名对话',
      'panel.gone': '日志已移走，任何列表都看不到',
      'panel.noLog': '没有落盘内容，重启后彻底消失',
      'panel.stillLoaded': '你仍开着它，关闭后会彻底隐藏',
      'panel.loading': '正在读取回收站…',
      'panel.error': '操作失败：{message}',
      'confirm.emptyAll': '确定要彻底删除回收站中的全部对话吗？该操作无法撤销。',
      'confirm.purge': '确定要彻底删除这条对话吗？该操作无法撤销。',
      'action.restored': '已恢复该对话',
      'action.purged': '已彻底删除',
      'action.deleted': '已移入回收站',
      'time.day': '{n} 天',
      'time.hour': '{n} 小时',
      'time.minute': '{n} 分钟',
      'time.lessThanMinute': '不足 1 分钟',
    }

    const en = {
      'menu.delete': 'Delete chat',
      'menu.deleteHint': 'Recoverable from the recycle bin',
      'panel.title': 'Recycle Bin',
      'panel.subtitle': 'Deleted chats are kept for {days} days, then removed permanently',
      'panel.empty': 'The recycle bin is empty',
      'panel.emptyHint': 'Choose "Delete chat" in a chat menu to move it here',
      'panel.count': '{n} item(s)',
      'panel.refresh': 'Refresh',
      'panel.emptyAll': 'Empty recycle bin',
      'panel.restore': 'Restore',
      'panel.purge': 'Delete forever',
      'panel.deletedAt': 'Deleted {time}',
      'panel.remaining': '{time} left',
      'panel.expired': 'Deleting soon',
      'panel.untitled': 'Untitled chat',
      'panel.gone': 'Log moved out; no list can show it',
      'panel.noLog': 'Never written to disk; gone after a restart',
      'panel.stillLoaded': 'Still open here; hidden once you close it',
      'panel.loading': 'Reading the recycle bin…',
      'panel.error': 'Failed: {message}',
      'confirm.emptyAll': 'Permanently delete every chat in the recycle bin? This cannot be undone.',
      'confirm.purge': 'Permanently delete this chat? This cannot be undone.',
      'action.restored': 'Chat restored',
      'action.purged': 'Deleted permanently',
      'action.deleted': 'Moved to the recycle bin',
      'time.day': '{n}d',
      'time.hour': '{n}h',
      'time.minute': '{n}m',
      'time.lessThanMinute': 'under a minute',
    }

    const CSS = `
.stRoot{display:flex;flex-direction:column;box-sizing:border-box;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.stRow{display:flex;align-items:flex-start;gap:12px;padding:24px 28px 0}
.stHeadText{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.stTitle{margin:0;font-size:20px;font-weight:600;line-height:28px;color:var(--dsw-alias-label-primary)}
.stSubtitle{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.stHeadActions{display:flex;align-items:center;gap:8px;flex:none;padding-top:2px}
.stBtn{height:32px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;cursor:pointer;white-space:nowrap}
.stBtn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.stBtn:disabled{opacity:.5;cursor:default}
.stBtnDanger{color:var(--dsw-alias-state-error-primary)}
.stBtnPrimary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.stBody{display:flex;flex-direction:column;min-height:0;flex:1;padding:16px 28px 24px;gap:12px;box-sizing:border-box}
.stList{flex:1;min-height:0;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.stItem{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.stItem:last-child{border-bottom:none}
.stItemMain{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.stItemTitle{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stItemMeta{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.stRemaining{color:var(--dsw-alias-state-warn-primary)}
.stItemActions{display:flex;gap:8px;flex:none}
.stEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:220px;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
.stEmptyTitle{font-size:14px;color:var(--dsw-alias-label-primary)}
.stEmptyHint{font-size:12px;line-height:18px}
.stNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-height:18px}
.stNoteError{color:var(--dsw-alias-state-error-primary)}
.stMenuRow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;height:32px;padding:0 12px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:13px;line-height:18px;text-align:left;cursor:pointer;white-space:nowrap}
.stMenuRow:hover:not(:disabled),.stMenuRow:focus-visible{background:var(--dsw-alias-bg-layer-2);outline:none}
.stMenuRow:disabled{opacity:.5;cursor:default}
.stMenuIcon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:16px;height:16px}
.stMenuLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.stToastHost{position:fixed;left:50%;bottom:28px;z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:8px;transform:translateX(-50%);pointer-events:none}
.stToast{max-width:min(560px,calc(100vw - 48px));box-sizing:border-box;padding:10px 16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 6px 24px rgba(0,0,0,.18);font:inherit;font-size:13px;line-height:20px;text-align:center;white-space:pre-wrap;word-break:break-word}
.stToastError{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
/* Deleted chats never render in the sidebar, at any archive filter setting. */
[data-row-key][data-st-hidden]{display:none!important}
`

    /**
     * Stop a deleted chat from ever being drawn in the sidebar.
     *
     * `data-row-key="session:<id>"` is the official row attribute. Marking the
     * row makes the CSS rule above hide it, and a MutationObserver catches rows
     * that appear later (refresh, archive-filter change, host pushing a new list
     * with the chat still in it). Removing the attribute is what lets a restored
     * chat reappear.
     */
    function applyHidden() {
      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        const id = row.getAttribute('data-row-key').slice('session:'.length)
        if (hidden.has(id)) {
          row.setAttribute('data-st-hidden', 'true')
        } else {
          row.removeAttribute('data-st-hidden')
        }
      }
    }

    function markDeleted(sessionId) {
      hidden.add(sessionId)
      writeHidden()
      applyHidden()
    }
    function markRestored(sessionId) {
      hidden.delete(sessionId)
      writeHidden()
      applyHidden()
    }

    /**
     * Hide deleted chats as soon as they are drawn, including rows the Host
     * still returns for a live session after the log was moved.
     */
    function startRowGuard() {
      applyHidden()
      const observer = new MutationObserver(() => applyHidden())
      observer.observe(document.body, { childList: true, subtree: true })
      return () => observer.disconnect()
    }
    const pad2 = (value) => String(value).padStart(2, '0')

    function formatDateTime(ms, locale) {
      const date = new Date(ms)
      if (Number.isNaN(date.getTime())) return ''
      if (locale === 'zh') {
        return `${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      }
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function formatRemaining(ms, t) {
      if (!Number.isFinite(ms) || ms <= 0) return t('panel.expired')
      const minutes = Math.floor(ms / 60000)
      if (minutes < 1) return t('time.lessThanMinute')
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      if (days > 0) return `${t('time.day', { n: days })} ${t('time.hour', { n: hours })}`
      if (hours > 0) return `${t('time.hour', { n: hours })} ${t('time.minute', { n: minutes % 60 })}`
      return t('time.minute', { n: minutes })
    }

    async function callHost(action, payload) {
      const response = await window.fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...(payload ?? {}) }),
      })
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok || body?.ok !== true) throw new Error(body?.message ?? `HTTP ${response.status}`)
      return body
    }

    /**
     * Show a result the user can actually see.
     *
     * The menu row has no panel to report into, so a failure there used to be
     * invisible — it only set a tooltip. Anything the user acted on gets an
     * on-screen answer here, including the host's own reason for refusing.
     */
    function showToast(text, isError) {
      let host = document.querySelector('.stToastHost')
      if (host === null) {
        host = document.createElement('div')
        host.className = 'stToastHost'
        document.body.appendChild(host)
      }
      const node = document.createElement('div')
      node.className = isError === true ? 'stToast stToastError' : 'stToast'
      node.setAttribute('role', isError === true ? 'alert' : 'status')
      node.textContent = text
      host.appendChild(node)
      setTimeout(() => {
        node.remove()
        if (host.childElementCount === 0) host.remove()
      }, isError === true ? 10000 : 4000)
    }

    function TrashIcon(props) {
      const size = Number.isFinite(props?.size) ? props.size : 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', { d: 'M2.75 4.25h10.5', strokeLinecap: 'round' }),
        h('path', { d: 'M6.25 4.25V2.75h3.5v1.5', strokeLinejoin: 'round' }),
        h('path', {
          d: 'M4 4.25l.6 8.1a.9.9 0 0 0 .9.85h5a.9.9 0 0 0 .9-.85L12 4.25',
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M6.6 6.6v4.2M9.4 6.6v4.2', strokeLinecap: 'round' }),
      )
    }

    /* ----------------------------------------------------------------- */
    /* Panel: the recycle bin                                              */
    /* ----------------------------------------------------------------- */

    function TrashPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const activeLocale = typeof props.getActiveLocale === 'function' ? props.getActiveLocale() : ''
      const locale = String(activeLocale ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en'

      const [snapshot, setSnapshot] = useState(null)
      const [note, setNote] = useState(null)
      const [busy, setBusy] = useState(false)
      const [now, setNow] = useState(() => Date.now())

      const read = useCallback(async () => {
        try {
          const body = await callHost('state')
          setSnapshot({ retentionDays: body.retentionDays, items: body.items ?? [] })
        } catch (reason) {
          setNote({ text: reason instanceof Error ? reason.message : String(reason), error: true })
        }
      }, [])

      useEffect(() => {
        void read()
        const poll = window.setInterval(() => void read(), 20000)
        return () => window.clearInterval(poll)
      }, [read])

      useEffect(() => {
        const tick = window.setInterval(() => setNow(Date.now()), 30000)
        return () => window.clearInterval(tick)
      }, [])

      const items = useMemo(() => {
        if (snapshot === null) return []
        return [...snapshot.items].sort((left, right) => right.deletedAt - left.deletedAt)
      }, [snapshot])

      const act = useCallback(
        async (action, payload, successText) => {
          setBusy(true)
          try {
            const body = await callHost(action, payload)
            // The row's visibility is decided here, so keep it in step with the
            // Host: restored chats must become visible again, purged ones stay hidden.
            if (action === 'restore' && typeof payload.sessionId === 'string') markRestored(payload.sessionId)
            if (action === 'delete' && typeof payload.sessionId === 'string') markDeleted(payload.sessionId)
            if (body.state !== undefined) {
              setSnapshot({ retentionDays: body.state.retentionDays, items: body.state.items ?? [] })
            } else {
              await read()
            }
            setNote(successText === undefined ? null : { text: successText, error: false })
          } catch (reason) {
            setNote({ text: reason instanceof Error ? reason.message : String(reason), error: true })
          } finally {
            setBusy(false)
          }
        },
        [read],
      )

      const days = snapshot?.retentionDays ?? 3

      return h(
        'div',
        { className: 'stRoot' },
        h(
          'div',
          { className: 'stRow' },
          h(
            'div',
            { className: 'stHeadText' },
            h('h2', { className: 'stTitle' }, t('panel.title')),
            h('p', { className: 'stSubtitle' }, t('panel.subtitle', { days })),
          ),
          h(
            'div',
            { className: 'stHeadActions' },
            h('span', { className: 'stNote' }, t('panel.count', { n: items.length })),
            h(
              'button',
              { type: 'button', className: 'stBtn', onClick: () => void read(), disabled: busy },
              t('panel.refresh'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'stBtn stBtnDanger',
                disabled: busy || items.length === 0,
                onClick: () => {
                  if (!window.confirm(t('confirm.emptyAll'))) return
                  void act('empty', {}, t('action.purged'))
                },
              },
              t('panel.emptyAll'),
            ),
          ),
        ),
        h(
          'div',
          { className: 'stBody' },
          h(
            'div',
            { className: note !== null && note.error ? 'stNote stNoteError' : 'stNote', role: 'status' },
            note !== null ? (note.error ? t('panel.error', { message: note.text }) : note.text) : '',
          ),
          h(
            'div',
            { className: 'stList' },
            snapshot === null
              ? h('div', { className: 'stEmpty' }, h('div', { className: 'stEmptyTitle' }, t('panel.loading')))
              : items.length === 0
                ? h(
                    'div',
                    { className: 'stEmpty' },
                    h('div', { className: 'stEmptyTitle' }, t('panel.empty')),
                    h('div', { className: 'stEmptyHint' }, t('panel.emptyHint')),
                  )
                : items.map((item) =>
                    h(
                      'div',
                      { className: 'stItem', key: item.sessionId },
                      h(
                        'div',
                        { className: 'stItemMain' },
                        h(
                          'div',
                          { className: 'stItemTitle', title: item.title || item.sessionId },
                          item.title && item.title.length > 0 ? item.title : t('panel.untitled'),
                        ),
                        h(
                          'div',
                          { className: 'stItemMeta' },
                          h('span', null, t('panel.deletedAt', { time: formatDateTime(item.deletedAt, locale) })),
                          h(
                            'span',
                            { className: 'stRemaining' },
                            t('panel.remaining', { time: formatRemaining(item.expiresAt - now, t) }),
                          ),
                          // Says plainly whether anything can still carry the
                          // chat, which is the only reason it could be listed.
                          h(
                            'span',
                            null,
                            item.archiveFallback === true
                              ? t('panel.stillLoaded')
                              : item.fileless === true
                                ? t('panel.noLog')
                                : t('panel.gone'),
                          ),
                        ),
                      ),
                      h(
                        'div',
                        { className: 'stItemActions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'stBtn stBtnPrimary',
                            disabled: busy,
                            onClick: () => void act('restore', { sessionId: item.sessionId }, t('action.restored')),
                          },
                          t('panel.restore'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'stBtn stBtnDanger',
                            disabled: busy,
                            onClick: () => {
                              if (!window.confirm(t('confirm.purge'))) return
                              void act('purge', { sessionId: item.sessionId }, t('action.purged'))
                            },
                          },
                          t('panel.purge'),
                        ),
                      ),
                    ),
                  ),
          ),
        ),
      )
    }

    /* ----------------------------------------------------------------- */
    /* Session-menu row: move one chat into the bin                        */
    /* ----------------------------------------------------------------- */

    function DeleteSessionMenuItem(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const openState = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : null
      const setMenuOpen = Array.isArray(openState) ? openState[1] : undefined
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)

      return h(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          className: 'stMenuRow',
          disabled: busy,
          title: error ?? t('menu.deleteHint'),
          onClick: () => {
            if (busy) return
            if (typeof setMenuOpen === 'function') setMenuOpen(false)
            setBusy(true)
            void callHost('delete', { sessionId: props.sessionId })
              .then(() => {
                setError(null)
                // The Host deleted it; the sidebar must stop drawing it now, not
                // when the Host next forgets it.
                markDeleted(props.sessionId)
                showToast(t('action.deleted'), false)
              })
              .catch((reason) => {
                const message = reason instanceof Error ? reason.message : String(reason)
                setError(message)
                showToast(t('panel.error', { message }), true)
              })
              .finally(() => setBusy(false))
          },
        },
        h('span', { className: 'stMenuIcon' }, h(TrashIcon, null)),
        h('span', { className: 'stMenuLabel' }, t('menu.delete')),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-trash: dictionary')

        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = NS
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'session-trash: styles')

        // The sidebar stops drawing deleted chats at render time, including rows
        // the Host still lists while a chat is live in memory.
        ctx.effect(() => startRowGuard(), 'session-trash: hide deleted rows')

        // Reconcile with the Host's bin on startup so a chat deleted in an older
        // build is hidden too, and one restored elsewhere is unhidden here.
        ctx.effect(() => {
          let cancelled = false
          void callHost('state')
            .then((body) => {
              if (cancelled) return
              const ids = (body.items ?? []).map((item) => item.sessionId)
              hidden = new Set(ids)
              writeHidden()
              applyHidden()
            })
            .catch(() => {
              // Keep whatever localStorage already had; the panel will show the error.
            })
          return () => {
            cancelled = true
          }
        }, 'session-trash: sync hidden set')

        /** `main` must exist before the sidebar row that selects it. */
        let mainReady = false
        let panelListReady = false
        let rowDispose = null

        const syncRow = () => {
          if (mainReady && panelListReady && rowDispose === null) {
            rowDispose = ctx.slots.register(
              { name: 'sidebar.panellist', id: NS, order: 60, label: () => ctx.locale.bind(NS)('panel.title') },
              TrashIcon,
            )
          } else if ((!mainReady || !panelListReady) && rowDispose !== null) {
            rowDispose()
            rowDispose = null
          }
        }

        ctx.effect(
          () => () => {
            if (rowDispose !== null) {
              rowDispose()
              rowDispose = null
            }
          },
          'session-trash: sidebar row',
        )

        ctx.slots.inject('main', () => {
          const dispose = ctx.slots.register(
            {
              name: 'main',
              key: NS,
              locale: NS,
              inject: () => ({ getActiveLocale: () => ctx.locale.getLocale().active }),
            },
            TrashPanel,
          )
          mainReady = true
          syncRow()
          return () => {
            mainReady = false
            syncRow()
            dispose()
          }
        })

        ctx.slots.inject('sidebar.panellist', () => {
          panelListReady = true
          syncRow()
          return () => {
            panelListReady = false
            syncRow()
          }
        })

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.workspaces.session.menu.item', id: 'session-trash-delete', order: 500, locale: NS },
            DeleteSessionMenuItem,
          ),
        )
      },
    }
  },
})
