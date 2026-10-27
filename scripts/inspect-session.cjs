/**
 * Report everything DSH keeps about a set of session ids: projection cache,
 * workspace accounting, archive flag, and whether a log directory exists.
 */
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const sessionsRoot = join(home, 'sessions')
const cacheRoot = join(home, 'storages', 'session_projcache', 'sessions')
const registry = JSON.parse(readFileSync(join(home, 'storages', 'workspace.json'), 'utf8'))

const accounted = new Map()
for (const table of Object.values(registry.tables ?? {})) {
  for (const [workspaceId, row] of Object.entries(table ?? {})) {
    for (const id of row.sessionIds ?? []) accounted.set(id, workspaceId)
  }
}
const archived = new Set(registry.global?.archivedSessionIds ?? [])

const logs = new Map()
for (const group of readdirSync(sessionsRoot, { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  for (const entry of readdirSync(join(sessionsRoot, group.name), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    logs.set(entry.name, {
      group: group.name,
      hasLog: existsSync(join(sessionsRoot, group.name, entry.name, 'session.v4.jsonl.zstd')),
      files: readdirSync(join(sessionsRoot, group.name, entry.name)),
    })
  }
}

function titleOf(id) {
  const path = join(cacheRoot, `${id}.json`)
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed?.title ?? parsed?.snapshot?.title ?? '(cache without title)'
  } catch {
    return '(unreadable cache)'
  }
}

console.log(`workspace.json: ${accounted.size} accounted id(s), ${archived.size} archived`)
console.log(`log dirs: ${logs.size}`)
console.log(`projcache files: ${readdirSync(cacheRoot).length}`)

const ids = process.argv.slice(2)
if (ids.length === 0) {
  console.log('\nsearching projcache titles for 111 / 摸糖果 ...')
  for (const name of readdirSync(cacheRoot)) {
    const id = name.replace(/\.json$/, '')
    const title = titleOf(id)
    if (typeof title !== 'string') continue
    if (title.includes('111') || title.includes('摸糖果')) {
      console.log(`  ${id}  title=${JSON.stringify(title)}  log=${logs.has(id)}  accounted=${accounted.get(id) ?? '-'}  archived=${archived.has(id)}`)
    }
  }
} else {
  for (const id of ids) {
    console.log(`\n=== ${id} ===`)
    console.log(`  log dir:      ${logs.has(id) ? JSON.stringify(logs.get(id)) : 'MISSING'}`)
    console.log(`  projcache:    ${existsSync(join(cacheRoot, `${id}.json`))}  title=${JSON.stringify(titleOf(id))}`)
    console.log(`  workspace:    ${accounted.get(id) ?? 'NOT ACCOUNTED'}`)
    console.log(`  archived:     ${archived.has(id)}`)
  }
}
