/**
 * Session Trash — Host half.
 *
 * Deleting a chat archives it (so every surface stops listing it) and records
 * it in a plugin-owned trash file. A trashed chat stays recoverable for
 * `retentionDays` and is then removed permanently: its stored log directory,
 * its projection cache, its archive membership and its workspace accounting.
 *
 * The UI talks to this half over one same-origin HTTP prefix
 * (`/session-trash/api`), the only endpoint this plugin adds.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STATE_VERSION = 1
const DAY_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 5 * 60 * 1000
const STARTUP_SWEEP_DELAY_MS = 4000

function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return join(homedir(), '.dsh')
}

function header(request, name) {
  const value = request?.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

function parseAuthority(host) {
  if (typeof host !== 'string' || host.length === 0) return undefined
  try {
    const url = new URL(`http://${host}`)
    return url.hostname ? { hostname: url.hostname, host: url.host } : undefined
  } catch {
    return undefined
  }
}

function isLoopbackHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    hostname.endsWith('.localhost')
  )
}

/** Loopback Host, non-cross-site, and an Origin matching that Host. */
function isTrustedRequest(request) {
  const hostHeader = header(request, 'host')
  if (hostHeader === undefined) return false
  const hostUrl = parseAuthority(hostHeader)
  if (hostUrl === undefined || !isLoopbackHostname(hostUrl.hostname)) return false
  if (header(request, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 64 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function apply(ctx, config = {}) {
  const home = resolveHome()
  const retentionDays =
    typeof config.retentionDays === 'number' && Number.isFinite(config.retentionDays) && config.retentionDays > 0
      ? config.retentionDays
      : 3
  const retentionMs = retentionDays * DAY_MS
  const sessionsRoot =
    typeof config.sessionsRoot === 'string' && config.sessionsRoot.length > 0
      ? config.sessionsRoot
      : join(home, 'sessions')
  const trashRoot = join(home, 'dsh-session-trash')
  const statePath = join(trashRoot, 'state.json')
  const cacheFileOf = (id) => join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)

  /** The plugin's own durable state; `items` is the trash list. */
  let state = { version: STATE_VERSION, items: [] }
  let loaded = false

  const registry = () => ctx.get('workspaceRegistry')

  async function loadState() {
    if (loaded) return state
    loaded = true
    try {
      const parsed = JSON.parse(await readFile(statePath, 'utf8'))
      const items = Array.isArray(parsed?.items) ? parsed.items : []
      state = {
        version: STATE_VERSION,
        items: items.filter(
          (item) =>
            typeof item?.sessionId === 'string' &&
            Number.isFinite(item?.deletedAt) &&
            Number.isFinite(item?.expiresAt),
        ),
      }
    } catch {
      state = { version: STATE_VERSION, items: [] }
    }
    return state
  }

  let writeTail = Promise.resolve()
  function persist() {
    const snapshot = JSON.stringify(state, null, 2)
    writeTail = writeTail.then(async () => {
      await mkdir(trashRoot, { recursive: true })
      const tmp = join(trashRoot, `state.json.tmp-${process.pid}-${Date.now()}`)
      await writeFile(tmp, snapshot, 'utf8')
      await rename(tmp, statePath)
    })
    return writeTail.catch((error) => {
      ctx.logger?.warn?.(`session-trash: persisting trash state failed: ${String(error)}`)
    })
  }

  /** Locate one stored session's directory under the sessions root. */
  async function findSessionDir(sessionId) {
    let groups
    try {
      groups = await readdir(sessionsRoot, { withFileTypes: true })
    } catch {
      return undefined
    }
    for (const group of groups) {
      if (!group.isDirectory()) continue
      const candidate = join(sessionsRoot, group.name, sessionId)
      try {
        if ((await stat(candidate)).isDirectory()) return candidate
      } catch {
        // Not this group.
      }
    }
    return undefined
  }

  async function readTitle(sessionId) {
    const query = ctx.get('sessionQuery')
    if (query === undefined) return ''
    try {
      const snapshot = await query.readTitle(sessionId)
      return typeof snapshot?.title === 'string' ? snapshot.title : ''
    } catch {
      return ''
    }
  }

  function itemFor(sessionId) {
    return state.items.find((item) => item.sessionId === sessionId)
  }

  function dropItem(sessionId) {
    state.items = state.items.filter((item) => item.sessionId !== sessionId)
  }

  /** Move one chat into the trash: hide it everywhere, then record the deadline. */
  async function trashSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('sessionId is required')
    await loadState()
    const existing = itemFor(sessionId)
    if (existing !== undefined) return { item: describeItem(existing), alreadyTrashed: true }

    const workspaces = registry()
    if (workspaces === undefined) throw new Error('workspace registry is unavailable')
    // Archiving hides the chat from every surface; stopActivity also ends any
    // work that would otherwise keep writing its log while it sits in the bin.
    await workspaces.archiveSession(sessionId, { stopActivity: true })

    const now = Date.now()
    const title = await readTitle(sessionId)
    const item = { sessionId, title, deletedAt: now, expiresAt: now + retentionMs }
    state.items = [item, ...state.items]
    await persist()
    return { item: describeItem(item), alreadyTrashed: false }
  }

  /** Undo a trashed chat while it is still inside the retention window. */
  async function restoreSession(sessionId) {
    await loadState()
    const workspaces = registry()
    if (workspaces === undefined) throw new Error('workspace registry is unavailable')
    await workspaces.unarchiveSession(sessionId)
    dropItem(sessionId)
    await persist()
    return { restored: true }
  }

  /**
   * Remove one trashed chat for good. `dryRun` reports what would be removed,
   * so the same path can be inspected without touching a log.
   */
  async function purgeSession(sessionId, options = {}) {
    await loadState()
    const logDir = await findSessionDir(sessionId)
    const cache = cacheFileOf(sessionId)
    const hasCache = await pathExists(cache)
    if (options.dryRun === true) {
      return { sessionId, logDir: logDir ?? null, cachePath: hasCache ? cache : null, dryRun: true }
    }
    if (ctx.get('agents')?.get(sessionId) !== undefined) {
      throw new Error('refusing to purge a chat that is still running')
    }
    if (logDir !== undefined) await rm(logDir, { recursive: true, force: true })
    if (hasCache) await rm(cache, { force: true })

    const workspaces = registry()
    if (workspaces !== undefined) {
      try {
        await workspaces.unarchiveSession(sessionId)
      } catch (error) {
        ctx.logger?.warn?.(`session-trash: clearing archive membership for '${sessionId}' failed: ${String(error)}`)
      }
      for (const workspace of workspaces.list()) {
        if (!workspace.sessionIds.includes(sessionId)) continue
        try {
          await workspace.detachSession(sessionId)
        } catch (error) {
          ctx.logger?.warn?.(`session-trash: detaching '${sessionId}' from workspace '${workspace.id}' failed: ${String(error)}`)
        }
      }
    }
    dropItem(sessionId)
    await persist()
    return { sessionId, logDir: logDir ?? null, removed: logDir !== undefined }
  }

  async function emptyTrash() {
    await loadState()
    const ids = state.items.map((item) => item.sessionId)
    const results = []
    for (const id of ids) {
      try {
        results.push(await purgeSession(id))
      } catch (error) {
        results.push({ sessionId: id, error: String(error) })
      }
    }
    return { purged: results.filter((entry) => entry.error === undefined).length, results }
  }

  /** Purge every chat whose deadline has passed. */
  async function sweep() {
    await loadState()
    const now = Date.now()
    const due = state.items.filter((item) => item.expiresAt <= now)
    let purged = 0
    for (const item of due) {
      try {
        await purgeSession(item.sessionId)
        purged += 1
      } catch (error) {
        ctx.logger?.warn?.(`session-trash: purging '${item.sessionId}' failed: ${String(error)}`)
      }
    }
    return purged
  }

  function describeItem(item) {
    return {
      sessionId: item.sessionId,
      title: item.title,
      deletedAt: item.deletedAt,
      expiresAt: item.expiresAt,
      remainingMs: Math.max(0, item.expiresAt - Date.now()),
    }
  }

  async function snapshot() {
    await loadState()
    return {
      retentionDays,
      now: Date.now(),
      items: state.items.map(describeItem),
    }
  }

  /* ------------------------------------------------------------------ */
  /* HTTP surface shared by the panel and the row action                 */
  /* ------------------------------------------------------------------ */

  const ACTIONS = new Map([
    ['state', async () => await snapshot()],
    ['delete', async (body) => {
      const result = await trashSession(body.sessionId)
      return { ...result, state: await snapshot() }
    }],
    ['restore', async (body) => {
      const result = await restoreSession(body.sessionId)
      return { ...result, state: await snapshot() }
    }],
    ['purge', async (body) => {
      const result = await purgeSession(body.sessionId, { dryRun: body.dryRun === true })
      return { ...result, state: await snapshot() }
    }],
    ['empty', async () => {
      const result = await emptyTrash()
      return { ...result, state: await snapshot() }
    }],
    ['sweep', async () => ({ purged: await sweep(), state: await snapshot() })],
  ])

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'prefix',
          path: '/session-trash/api',
          handler: async (req, res) => {
            if (!isTrustedRequest(req)) {
              writeJson(res, 403, { ok: false, message: 'forbidden' })
              return
            }
            if (req.method !== 'POST') {
              res.writeHead(405, { allow: 'POST' })
              res.end()
              return
            }
            try {
              const body = await readJsonBody(req)
              const action = ACTIONS.get(body?.action)
              if (action === undefined) {
                writeJson(res, 400, { ok: false, message: `unknown action "${String(body?.action ?? '')}"` })
                return
              }
              const value = await action(body ?? {})
              writeJson(res, 200, { ok: true, ...value })
            } catch (error) {
              writeJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
      'session-trash: api route',
    )
  })

  /* ------------------------------------------------------------------ */
  /* Expiry                                                              */
  /* ------------------------------------------------------------------ */

  const sweepTimer = setInterval(() => {
    void sweep().catch((error) => {
      ctx.logger?.warn?.(`session-trash: expiry sweep failed: ${String(error)}`)
    })
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()

  const startupTimer = setTimeout(() => {
    void sweep().catch((error) => {
      ctx.logger?.warn?.(`session-trash: startup sweep failed: ${String(error)}`)
    })
  }, STARTUP_SWEEP_DELAY_MS)
  startupTimer.unref?.()

  ctx.effect(
    () => () => {
      clearInterval(sweepTimer)
      clearTimeout(startupTimer)
    },
    'session-trash: expiry timers',
  )

  void loadState().then(() => {
    ctx.logger?.info?.(
      `session-trash: ${state.items.length} trashed chat(s), retention ${retentionDays} day(s)`,
    )
  })
}
