/**
 * Show how the platform currently sees a set of chat ids: listed, live, and
 * whether a log directory exists. Used to check what a delete actually left.
 */
const { existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const sessionsRoot = join(home, 'sessions')
const origin = process.env.ST_ORIGIN || 'http://127.0.0.1:1349'

async function main() {
  const ids = process.argv.slice(2)
  const response = await fetch(`${origin}/session-trash/api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ action: 'inspect' }),
  })
  const body = await response.json()
  const dirs = new Set()
  for (const group of readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(sessionsRoot, group.name), { withFileTypes: true })) {
      dirs.add(entry.name)
    }
  }
  const archived = new Set(
    JSON.parse(require('node:fs').readFileSync(join(home, 'storages', 'workspace.json'), 'utf8')).global
      ?.archivedSessionIds ?? [],
  )
  for (const id of ids) {
    const summary = (body.sessions ?? []).find((entry) => entry.sessionId === id)
    console.log(
      `${id.slice(0, 22)}  listed=${summary !== undefined}  live=${summary?.agentAvailable ?? '-'}  ` +
        `hasLog=${dirs.has(id)}  archived=${archived.has(id)}  title=${JSON.stringify(summary?.title ?? null)}`,
    )
  }
  void existsSync
}

void main()
