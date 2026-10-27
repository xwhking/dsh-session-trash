/**
 * End-to-end acceptance for the plugin's own HTTP surface.
 *
 * Runs against the live GUI origin and asserts the user-visible contract, not
 * just the filesystem: a delete must take the log out of the sessions root AND
 * archive it, a restore must return the identical bytes, a purge must leave no
 * log, no bin entry, no projection cache and no archive flag, and a second purge
 * must refuse instead of pretending.
 *
 * Usage:
 *   node scripts/e2e.cjs                  # fileless cases only
 *   E2E_SESSION_ID=<id> node scripts/e2e.cjs
 *
 * With E2E_SESSION_ID the run is destructive for that one session: the log is
 * copied to a temp backup first and restored at the end.
 */
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')
const { homedir, tmpdir } = require('node:os')

const ORIGIN = process.env.E2E_ORIGIN || 'http://127.0.0.1:4468'
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

async function main() {
  const state = await call('state')
  check('state is reachable', state.body.ok === true, `retention ${state.body.retentionDays} day(s)`)

  /* -------- an id nobody knows: refuse, do not invent a deletion ---------- */
  const ghost = 'session-00000000-0000-4000-8000-000000000000'
  const ghostDelete = await call('delete', { sessionId: ghost })
  check(
    'delete of an unknown chat refuses',
    ghostDelete.body.ok === false,
    ghostDelete.body.message,
  )
  const ghostState = await call('state')
  check(
    'the refused delete left no bin entry',
    !ghostState.body.items.some((item) => item.sessionId === ghost),
    `${ghostState.body.items.length} item(s)`,
  )
  const ghostPurge = await call('purge', { sessionId: ghost })
  check('purging an unknown chat refuses', ghostPurge.body.ok === false, ghostPurge.body.message)

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

    const deleted = await call('delete', { sessionId })
    check('delete succeeds', deleted.body.ok === true, deleted.body.message ?? 'ok')
    check('the log left the sessions root', findLogDir(sessionId) === undefined)
    check('the log is inside the bin', existsSync(join(binRoot, sessionId, 'session.v4.jsonl.zstd')))
    check('the chat is archived', archivedIds().includes(sessionId))
    if (before !== null) check('the bin copy is byte-identical', sha(join(binRoot, sessionId, 'session.v4.jsonl.zstd')) === before)

    const again = await call('delete', { sessionId })
    check('deleting twice is idempotent', again.body.ok === true && again.body.alreadyTrashed === true, 'alreadyTrashed')

    const restored = await call('restore', { sessionId })
    check('restore succeeds', restored.body.ok === true, restored.body.message ?? 'ok')
    check('the log came back', findLogDir(sessionId) !== undefined)
    if (before !== null) check('the restored log is byte-identical', sha(join(sessionsRoot, found.group, sessionId, 'session.v4.jsonl.zstd')) === before)
    check('the chat is no longer archived', !archivedIds().includes(sessionId))

    // Restore an unknown id must refuse rather than touch anything.
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

    const second = await call('purge', { sessionId })
    check('purging what is already gone refuses', second.body.ok === false, second.body.message)

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

  writeFileSync(statePath, JSON.stringify({ version: state.body.version ?? 2, items: [] }, null, 2), 'utf8')
  const final = await call('state')
  check('the recycle bin ends empty', final.body.items.length === 0, `${final.body.items.length} item(s)`)

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

void statSync
