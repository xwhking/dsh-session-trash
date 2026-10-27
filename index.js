/**
 * Session Trash — Host half.
 *
 * Deleting a chat moves its stored log directory out of the sessions root into
 * this plugin's own trash folder, so DSH can no longer see it. A trashed chat
 * stays recoverable for `retentionDays`; after that it is removed for good.
 *
 * Archiving is used alongside the move, for two reasons only: it is how DSH
 * hides a Session from every listing surface, and `stopActivity` is how the
 * platform ends work that would otherwise keep writing the log we are about to
 * move. Restoring undoes both.
 *
 * The UI talks to this half over one same-origin HTTP prefix
 * (`/session-trash/api`), the only endpoint this plugin adds.
 */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const STATE_VERSION = 2
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
  /** Where a trashed chat's log directory actually lives while it sits in the bin. */
  const filesRoot = join(trashRoot, 'files')
  const cacheFileOf = (id) => join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  const trashDirOf = (id) => join(filesRoot, id)
  /** Last failure seen by this half, so a silent UI failure is still diagnosable. */
  const lastErrorPath = join(trashRoot, 'last-error.json')

  /** The plugin's own durable state; `items` is the trash list. */
  let state = { version: STATE_VERSION, items: [] }
  let loaded = false
  /** Session ids with a live Agent that is actually running work right now. */
  const running = new Set()

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

  /**
   * Keep the last failure on disk.
   *
   * The browser half can only surface one short line, and a menu row that fails
   * used to fail silently, so the full reason and stack are written here where
   * they can be read back later.
   */
  async function recordFailure(action, sessionId, error) {
    try {
      await mkdir(trashRoot, { recursive: true })
      await writeFile(
        lastErrorPath,
        JSON.stringify(
          {
            at: new Date().toISOString(),
            action,
            sessionId: typeof sessionId === 'string' ? sessionId : null,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? (error.stack ?? null) : null,
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch (writeError) {
      ctx.logger?.warn?.(`session-trash: recording a failure failed: ${String(writeError)}`)
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * Move one log directory, tolerating a transient Windows lock.
   *
   * A `rename` can fail with EBUSY/EPERM while the platform still holds the log
   * open, which resolves on its own a moment later. Retry first, then fall back
   * to copying and removing so a locked file is still deletable.
   */
  async function moveDirectory(source, target) {
    let lastError
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await rename(source, target)
        return 'moved'
      } catch (error) {
        lastError = error
        if (attempt < 3) await sleep(150 * attempt)
      }
    }
    try {
      await cp(source, target, { recursive: true, force: true })
      await rm(source, { recursive: true, force: true })
      return 'copied'
    } catch (copyError) {
      throw new Error(`${String(lastError)} (copy fallback also failed: ${String(copyError)})`)
    }
  }

  /** Locate one live stored session as `{ group, path }` under the sessions root. */
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
        if ((await stat(candidate)).isDirectory()) return { group: group.name, path: candidate }
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

  /** Move one chat's log directory into the bin. */
  async function moveIntoBin(sessionId, found) {
    const target = trashDirOf(sessionId)
    await rm(target, { recursive: true, force: true })
    await mkdir(filesRoot, { recursive: true })
    return await moveDirectory(found.path, target)
  }

  /** Put one chat's log directory back where DSH expects it. */
  async function moveOutOfBin(sessionId, group) {
    const source = trashDirOf(sessionId)
    if (!(await pathExists(source))) return false
    const resolvedGroup = group ?? (await findSessionDir(sessionId))?.group
    if (resolvedGroup === undefined) throw new Error('cannot tell which workspace folder this chat came from')
    const targetDir = join(sessionsRoot, resolvedGroup)
    await mkdir(targetDir, { recursive: true })
    const target = join(targetDir, sessionId)
    await rm(target, { recursive: true, force: true })
    await moveDirectory(source, target)
    return true
  }

  /**
   * Move one chat into the trash.
   *
   * The log directory moving out of the sessions root is the deletion: once it
   * is gone from there, no listing and no resume can see the chat. The archive
   * flag is set first only so the platform stops any work still writing that
   * log, and it is rolled back if the move fails.
   *
   * Archiving is also the hide for a chat that never wrote a log at all (a chat
   * opened but never messaged has no directory to move). That case is recorded
   * as `fileless` and is still deletable — refusing it is what made deleting a
   * fresh chat look broken.
   */
  async function trashSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('sessionId is required')
    await loadState()
    const existing = itemFor(sessionId)
    if (existing !== undefined) return { item: describeItem(existing), alreadyTrashed: true }

    const found = await findSessionDir(sessionId)
    const workspaces = registry()
    if (workspaces === undefined) throw new Error('workspace registry is unavailable')

    const title = await readTitle(sessionId)

    // Ends any work that would otherwise keep writing the log we move next.
    // A chat the platform will not archive is still deletable, so keep going.
    let archived = true
    try {
      await workspaces.archiveSession(sessionId, { stopActivity: true })
    } catch (error) {
      archived = false
      ctx.logger?.warn?.(`session-trash: archiving '${sessionId}' failed, deleting anyway: ${String(error)}`)
      await recordFailure('delete/archive', sessionId, error)
    }

    let fileless = false
    if (found === undefined) {
      // Nothing was ever stored, so hiding it *is* the deletion.
      fileless = true
    } else {
      try {
        await moveIntoBin(sessionId, found)
      } catch (error) {
        // The move failed, so nothing was deleted: undo the hide and record nothing.
        if (archived) {
          try {
            await workspaces.unarchiveSession(sessionId)
          } catch {
            // The original failure is the one worth reporting.
          }
        }
        throw new Error(`could not move this chat into the trash: ${String(error)}`)
      }
    }

    const now = Date.now()
    const item = {
      sessionId,
      title,
      group: found?.group ?? null,
      fileless,
      deletedAt: now,
      expiresAt: now + retentionMs,
    }
    state.items = [item, ...state.items]
    await persist()
    return { item: describeItem(item), alreadyTrashed: false, fileless }
  }

  /** Undo a trashed chat while it is still inside the retention window. */
  async function restoreSession(sessionId) {
    await loadState()
    const workspaces = registry()
    if (workspaces === undefined) throw new Error('workspace registry is unavailable')
    const item = itemFor(sessionId)
    if (item === undefined) throw new Error('this chat is not in the recycle bin')
    const moved = await moveOutOfBin(sessionId, item.group)
    await workspaces.unarchiveSession(sessionId)
    dropItem(sessionId)
    await persist()
    return { restored: true, filesReturned: moved }
  }

  /**
   * Remove one trashed chat for good.
   *
   * Success means the chat can never be listed again: the stored log is gone
   * (either it was moved into the bin by this plugin, or an older build left it
   * in the sessions root) and no workspace accounting survives. When no log
   * exists in either place for a chat that did have one, this refuses instead of
   * reporting a deletion — and it never unarchives a chat whose log is still
   * around, because unarchiving is what would bring it back.
   *
   * A `fileless` entry never had a log: nothing was ever written, so its only
   * trace is the workspace entry and the archive flag, and dropping both is the
   * whole removal. `dryRun` reports what would be removed.
   */
  async function purgeSession(sessionId, options = {}) {
    await loadState()
    const item = itemFor(sessionId)
    const fileless = item?.fileless === true
    const binDir = trashDirOf(sessionId)
    const inBin = await pathExists(binDir)
    const stray = inBin ? undefined : await findSessionDir(sessionId)
    const cache = cacheFileOf(sessionId)
    const hasCache = await pathExists(cache)
    const hasLog = inBin || stray !== undefined

    if (options.dryRun === true) {
      return {
        sessionId,
        binDir: inBin ? binDir : null,
        strayPath: stray?.path ?? null,
        cachePath: hasCache ? cache : null,
        hasLog,
        fileless,
        dryRun: true,
      }
    }

    if (!hasLog && !fileless) {
      throw new Error('no stored log found for this chat — nothing to delete')
    }
    if (stray !== undefined && running.has(sessionId)) {
      throw new Error('this chat is running right now — stop it first, then delete again')
    }

    if (inBin) await rm(binDir, { recursive: true, force: true })
    // A chat trashed by an older build may still be sitting in the sessions
    // root; remove it there rather than silently leaving it behind.
    if (stray !== undefined) await rm(stray.path, { recursive: true, force: true })
    if (hasCache) await rm(cache, { force: true })

    // The log is gone, so the archive flag is dead weight — clear it, and drop
    // the workspace accounting with it. This is cleanup, never a restore: the
    // archive flag is only cleared once no workspace still accounts for the
    // chat, so a detach that failed can never leave it visible again.
    const workspaces = registry()
    if (workspaces !== undefined) {
      let detachFailed = false
      for (const workspace of workspaces.list()) {
        if (!workspace.sessionIds.includes(sessionId)) continue
        try {
          await workspace.detachSession(sessionId)
        } catch (error) {
          detachFailed = true
          ctx.logger?.warn?.(`session-trash: detaching '${sessionId}' from workspace '${workspace.id}' failed: ${String(error)}`)
        }
      }
      if (detachFailed) {
        ctx.logger?.warn?.(
          `session-trash: kept '${sessionId}' archived because a workspace still accounts for it`,
        )
      } else {
        try {
          await workspaces.unarchiveSession(sessionId)
        } catch (error) {
          ctx.logger?.warn?.(`session-trash: clearing archive membership for '${sessionId}' failed: ${String(error)}`)
        }
      }
    }
    dropItem(sessionId)
    await persist()
    return { sessionId, removed: true, removedFromBin: inBin, removedStray: stray !== undefined, fileless }
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
      group: item.group ?? null,
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
            let body
            try {
              body = await readJsonBody(req)
              const action = ACTIONS.get(body?.action)
              if (action === undefined) {
                writeJson(res, 400, { ok: false, message: `unknown action "${String(body?.action ?? '')}"` })
                return
              }
              const value = await action(body ?? {})
              writeJson(res, 200, { ok: true, ...value })
            } catch (error) {
              await recordFailure(body?.action ?? 'unknown', body?.sessionId, error)
              writeJson(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
            }
          },
        }),
      'session-trash: api route',
    )
  })

  /* ------------------------------------------------------------------ */
  /* Liveness: only a genuinely running Agent blocks a destructive action */
  /* ------------------------------------------------------------------ */

  ctx.effect(
    () =>
      ctx.on('agent/status', (payload) => {
        const id = payload?.agent?.id
        if (typeof id !== 'string') return
        if (payload?.status === 'running') running.add(id)
        else running.delete(id)
      }),
    'session-trash: agent status',
  )

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
