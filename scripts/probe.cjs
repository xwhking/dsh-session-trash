/**
 * Call one action on the plugin's HTTP surface and print the JSON answer.
 *
 * PowerShell mangles JSON quoting, so this builds the request body itself:
 *   node scripts/probe.cjs inspect [comma,separated,sessionIds]
 *   node scripts/probe.cjs delete <sessionId>
 *   node scripts/probe.cjs purge <sessionId> [dryRun]
 */
const { argv } = process

const origin = process.env.ST_ORIGIN || 'http://127.0.0.1:4468'
const action = argv[2] ?? 'state'
const argument = argv[3]

const body = { action }
if (action === 'purge' && argument !== undefined && argv[4] === 'dryRun') body.dryRun = true
if (argument !== undefined && argument !== 'dryRun' && !action.includes('inspect')) body.sessionId = argument

async function main() {
  const response = await fetch(`${origin}/session-trash/api`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    console.log(`HTTP ${response.status} (not JSON): ${text.slice(0, 400)}`)
    return
  }
  if (action === 'inspect' && argument !== undefined && Array.isArray(parsed.sessions)) {
    const ids = argument.split(',')
    const picked = parsed.sessions.filter((entry) => ids.includes(entry.sessionId))
    console.log(JSON.stringify({ ...parsed, sessions: picked, listedSessions: picked.length }, null, 2))
    return
  }
  console.log(JSON.stringify(parsed, null, 2))
}

void main()
