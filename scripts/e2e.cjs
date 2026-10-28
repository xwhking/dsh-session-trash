/**
 * End-to-end acceptance for the plugin's own HTTP surface.
 *
 * Asserts the user-visible contract rather than the filesystem alone: a delete
 * must take the chat out of the host's own session list (which is what the
 * sidebar renders) and must NOT leave it archived, because an archived chat
 * stays in the platform's archive list and its undo brings the chat back.
 *
 * Usage:
 *   node scripts/e2e.cjs                  # read-only checks only
 *   E2E_SESSION_ID=<id> node scripts/e2e.cjs
 *
 * With E2E_SESSION_ID the run is destructive for that one chat: its log is
 * copied to a temp backup first and put back at the end.
 */
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')
const { homedir, tmpdir } = require('node:os')

const ORIGIN = process.env.E2E_ORIGIN || 'http://127.0.0.1:1349'
const API = `${ORIGIN}/session-trash/api`
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const sessionsRoot = join(home, 'sessions')
const binRoot = join(home, 'dsh-session-trash', 'files')
const statePath = join(home, 'dsh-session-trash', 'state.json')
const cacheRoot = join(home, 'storages', 'session_projcache', 'sessions')
const registryPath = join(home, 'storages', 'workspace.json')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function call(action, payload) {
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ action, ...(payload ?? {}) }),
  })
  return { status: response.status, body: await response.json() }
}

function findLogDir(sessionId) {
  for (const group of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    const candidate = join(sessionsRoot, group.name, sessionId)
    if (existsSync(candidate)) return { group: group.name, path: candidate }
  }
  return undefined
}

const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()
const archivedIds = () => JSON.parse(readFileSync(registryPath, 'utf8')).global?.archivedSessionIds ?? []
const registryText = () => readFileSync(registryPath, 'utf8')

/** Whether the host still lists this chat, which is what the sidebar shows. */
async function isListed(sessionId) {
  const answer = await call('inspect')
  const sessions = answer.body.sessions ?? []
  if (sessions.some((entry) => entry.error !== undefined)) throw new Error('inspect failed')
  return sessions.some((entry) => entry.sessionId === sessionId)
}

async function main() {
  const state = await call('state')
  check('state is reachable', state.body.ok === true, `retention ${state.body.retentionDays} day(s)`)

  /* -------- an id nobody knows: refuse, do not invent a deletion ---------- */
  const ghost = 'session-00000000-0000-4000-8000-000000000000'
  const ghostDelete = await call('delete', { sessionId: ghost })
  check('delete of an unknown chat refuses', ghostDelete.body.ok === false, ghostDelete.body.message)
  const ghostState = await call('state')
  check(
    'the refused delete left no bin entry',
    !ghostState.body.items.some((item) => item.sessionId === ghost),
    `${ghostState.body.items.length} item(s)`,
  )
  const ghostPurge = await call('purge', { sessionId: ghost })
  check(
    'purging an unknown chat reports it as already gone',
    ghostPurge.body.ok === true && ghostPurge.body.alreadyGone === true,
    ghostPurge.body.message ?? 'alreadyGone',
  )

  /* ------------------- a real chat: the whole lifecycle ------------------- */
  const sessionId = process.env.E2E_SESSION_ID
  if (sessionId === undefined || sessionId === '') {
    console.log('\n(no E2E_SESSION_ID: skipped the destructive lifecycle)')
  } else {
    const found = findLogDir(sessionId)
    if (found === undefined) throw new Error(`test session '${sessionId}' has no log directory`)
    const logPath = join(found.path, 'session.v4.jsonl.zstd')
    const backup = join(tmpdir(), 'session-trash-e2e', sessionId)
    rmSync(backup, { recursive: true, force: true })
    mkdirSync(backup, { recursive: true })
    cpSync(found.path, backup, { recursive: true })
    const before = existsSync(logPath) ? sha(logPath) : null
    console.log(`\ntesting with ${sessionId} (group ${found.group}, sha ${before})`)
    check('the test chat starts out listed', await isListed(sessionId))

    const deleted = await call('delete', { sessionId })
    check('delete succeeds', deleted.body.ok === true, deleted.body.message ?? 'ok')
    check('the log left the sessions root', findLogDir(sessionId) === undefined)
    check('the log is inside the bin', existsSync(join(binRoot, sessionId, 'session.v4.jsonl.zstd')))
    check('the chat is gone from the host list', (await isListed(sessionId)) === false)
    // A cold chat is hidden by its missing log alone, so it must not be left in
    // the platform's archive list at all.
    check('no archive entry is left behind for a cold chat', !archivedIds().includes(sessionId))
    if (before !== null) {
      check('the bin copy is byte-identical', sha(join(binRoot, sessionId, 'session.v4.jsonl.zstd')) === before)
    }

    const again = await call('delete', { sessionId })
    check('deleting twice is idempotent', again.body.ok === true && again.body.alreadyTrashed === true, 'alreadyTrashed')

    const restored = await call('restore', { sessionId })
    check('restore succeeds', restored.body.ok === true, restored.body.message ?? 'ok')
    check('the log came back', findLogDir(sessionId) !== undefined)
    if (before !== null) {
      check(
        'the restored log is byte-identical',
        sha(join(sessionsRoot, found.group, sessionId, 'session.v4.jsonl.zstd')) === before,
      )
    }
    check('the restored chat is listed again', await isListed(sessionId))
    check('the chat is not archived after restore', !archivedIds().includes(sessionId))

    const bogus = await call('restore', { sessionId: 'session-11111111-1111-4111-8111-111111111111' })
    check('restore of an unknown chat refuses', bogus.body.ok === false, bogus.body.message)

    await call('delete', { sessionId })
    const purged = await call('purge', { sessionId })
    check('purge succeeds', purged.body.ok === true, purged.body.message ?? 'ok')
    check('no log is left in the sessions root', findLogDir(sessionId) === undefined)
    check('the bin entry is gone', !existsSync(join(binRoot, sessionId)))
    check('the projection cache is gone', !existsSync(join(cacheRoot, `${sessionId}.json`)))
    check('the archive flag is gone', !archivedIds().includes(sessionId))
    check('no workspace mentions the chat', !registryText().includes(sessionId))
    check('the chat is gone from the host list', (await isListed(sessionId)) === false)

    const second = await call('purge', { sessionId })
    check('purging what is already gone is idempotent', second.body.ok === true, second.body.message ?? 'ok')

    // Put the test chat back exactly as it was found.
    const target = join(sessionsRoot, found.group, sessionId)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(backup, target, { recursive: true })
    check(
      'the test chat was restored from its backup',
      before === null || sha(join(target, 'session.v4.jsonl.zstd')) === before,
    )
  }

  /* --------------- a chat the platform still holds in memory -------------- */
  const liveId = process.env.E2E_LIVE_SESSION_ID
  if (liveId === undefined || liveId === '') {
    console.log('\n(no E2E_LIVE_SESSION_ID: skipped the live-chat fallback case)')
  } else {
    const listed = await call('inspect')
    const summary = (listed.body.sessions ?? []).find((entry) => entry.sessionId === liveId)
    check('the live test chat is currently held by the platform', summary?.agentAvailable === true, JSON.stringify(summary?.title))
    const liveFound = findLogDir(liveId)
    if (liveFound === undefined) {
      check('the live test chat has a log to move', false, 'no log directory')
    } else {
      const liveLog = join(liveFound.path, 'session.v4.jsonl.zstd')
      const liveBackup = join(tmpdir(), 'session-trash-e2e-live', liveId)
      rmSync(liveBackup, { recursive: true, force: true })
      mkdirSync(liveBackup, { recursive: true })
      cpSync(liveFound.path, liveBackup, { recursive: true })
      const liveSha = existsSync(liveLog) ? sha(liveLog) : null

      const liveDelete = await call('delete', { sessionId: liveId })
      check('deleting a chat that is still open succeeds', liveDelete.body.ok === true, liveDelete.body.message ?? 'ok')
      check('that delete reports the temporary archive fallback', liveDelete.body.archiveFallback === true)
      check('its log still left the sessions root', findLogDir(liveId) === undefined)
      check('it is therefore hidden from every list', archivedIds().includes(liveId))

      // The platform's own undo must not be able to hold the chat visible.
      await call('simulateUndo', { sessionId: liveId })
      await new Promise((resolve) => setTimeout(resolve, 3500))
      check('the bin re-hides it after the platform undo', archivedIds().includes(liveId))

      const liveRestore = await call('restore', { sessionId: liveId })
      check('the live chat restores', liveRestore.body.ok === true, liveRestore.body.message ?? 'ok')
      check('its log came back', findLogDir(liveId) !== undefined)
      check('its log is byte-identical', liveSha === null || sha(join(liveFound.path, 'session.v4.jsonl.zstd')) === liveSha)
      check('it is no longer archived', !archivedIds().includes(liveId))
      check('it is listed again', await isListed(liveId))
    }
  }

  const finalState = await call('state')
  const kept = finalState.body.items ?? []
  // Only entries this run did not create may remain (the user's own deletions).
  check(
    'the run left no new bin entries',
    kept.every((item) => item.sessionId !== ghost),
    `${kept.length} item(s) still in the bin`,
  )
  void writeFileSync
  void statePath

  const failed = results.filter((entry) => entry.ok !== true)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length > 0) {
    console.log('failed:')
    for (const entry of failed) console.log(`  - ${entry.name} (${entry.detail ?? 'no detail'})`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`e2e crashed: ${String(error)}`)
  process.exit(1)
})
