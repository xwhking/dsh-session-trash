/**
 * Dump the code around a UTF-8 string inside the packed Electron asar.
 *
 * The UI packages ship only inside `app.asar`, so when the question is "what
 * does the sidebar actually read", this shows the shipped bytes.
 */
const { readFileSync } = require('node:fs')

const asar = process.argv[2]
const needle = Buffer.from(process.argv[3], 'utf8')
const before = Number(process.argv[4] ?? 700)
const after = Number(process.argv[5] ?? 700)
const limit = Number(process.argv[6] ?? 3)

const bytes = readFileSync(asar)
let index = 0
let found = 0
while (found < limit) {
  index = bytes.indexOf(needle, index)
  if (index === -1) break
  found += 1
  const start = Math.max(0, index - before)
  const end = Math.min(bytes.length, index + needle.length + after)
  console.log(`\n===== hit ${found} at ${index} =====`)
  console.log(bytes.subarray(start, end).toString('utf8'))
  index += needle.length
}
if (found === 0) console.log(`no hit for ${JSON.stringify(process.argv[3])}`)
