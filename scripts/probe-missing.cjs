/**
 * Diagnostic: list registry-known session ids that have no log directory on disk.
 *
 * A chat like this cannot be moved into the bin, so it is exactly the shape that
 * made `delete` refuse. Prints one line per id with its workspace.
 */
const { readFileSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const sessionsRoot = join(home, 'sessions')
const registry = JSON.parse(readFileSync(join(home, 'storages', 'workspace.json'), 'utf8'))

const known = new Set()
for (const table of Object.values(registry.tables ?? {})) {
  for (const [id, row] of Object.entries(table ?? {})) {
    for (const sessionId of row.sessionIds ?? []) known.add(sessionId)
    void id
  }
}

const present = new Set()
for (const group of readdirSync(sessionsRoot, { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  for (const entry of readdirSync(join(sessionsRoot, group.name), { withFileTypes: true })) {
    if (entry.isDirectory()) present.add(entry.name)
  }
}

const missing = [...known].filter((id) => !present.has(id))
const orphanDirs = [...present].filter((id) => !known.has(id))

console.log(`registry ids: ${known.size}`)
console.log(`log dirs:     ${present.size}`)
console.log(`registry ids with no log dir: ${missing.length}`)
for (const id of missing) console.log(`  MISSING-LOG ${id}`)
console.log(`log dirs not in any workspace list: ${orphanDirs.length}`)
for (const id of orphanDirs.slice(0, 10)) console.log(`  ORPHAN ${id}`)
