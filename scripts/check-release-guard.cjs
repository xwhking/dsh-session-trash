/**
 * Test the hide-guard decision table against the shipped implementation.
 *
 * The release path only runs after the platform drops a chat's Agent, which
 * nothing outside the process can force, so the decision is exported as a pure
 * function and tested here directly instead of by poking live state.
 */
const cases = [
  { name: 'a live chat keeps its flag set', live: true, archived: true, expect: 'leave' },
  { name: 'a live chat is re-hidden after the platform undo', live: true, archived: false, expect: 'archive' },
  { name: 'a chat the platform dropped releases its flag', live: false, archived: true, expect: 'release' },
  { name: 'a chat already released only drops the marker', live: false, archived: false, expect: 'clear-marker' },
]

async function main() {
  const { decideHideAction } = await import('../index.js')
  if (typeof decideHideAction !== 'function') {
    console.error('FAIL  index.js does not export decideHideAction')
    process.exit(1)
  }
  let failed = 0
  for (const entry of cases) {
    const actual = decideHideAction(entry)
    const ok = actual === entry.expect
    if (!ok) failed += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${entry.name} — ${actual}`)
  }
  console.log(`\n${cases.length - failed}/${cases.length} checks passed`)
  if (failed > 0) process.exit(1)
}

void main()
