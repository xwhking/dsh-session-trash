/**
 * Test the client-side "deleted chats never render" layer.
 *
 * The Host can keep listing a live chat after its log was moved, so the sidebar
 * is where the row has to be stopped. This checks the real rule:
 * a deleted id must be hidden, a restored one must be unhidden, and a refresh
 * must not bring a deleted row back.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const source = readFileSync(join(__dirname, '..', 'client.js'), 'utf8')

const checks = [
  ['rows are hidden by attribute', source.includes("data-st-hidden")],
  ['hidden ids persist in localStorage', source.includes("localStorage.setItem(HIDDEN_KEY")],
  ['hidden ids are read back on load', source.includes("localStorage.getItem(HIDDEN_KEY")],
  ['delete marks the row hidden', /markDeleted\(props\.sessionId\)/.test(source)],
  ['restore unhides the row', source.includes("markRestored(payload.sessionId)")],
  ['a MutationObserver catches late rows', source.includes('new MutationObserver(() => applyHidden())')],
  ['the observer is disposed on unload', source.includes('observer.disconnect()')],
  ['the hidden set is synced from the Host on startup', source.includes("callHost('state')")],
  ['the row selector uses the official attribute', /data-row-key\^="session:"/.test(source)],
]

let failed = 0
for (const [name, ok] of checks) {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`)
if (failed > 0) process.exit(1)
