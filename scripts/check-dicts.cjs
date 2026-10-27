/**
 * Assert the zh/en dictionaries in client.js declare exactly the same keys.
 *
 * A missing key is not a crash: it renders as the raw key to the user, which is
 * how a half-translated row ships unnoticed.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const source = readFileSync(join(__dirname, '..', 'client.js'), 'utf8')

function keysOf(name) {
  const start = source.indexOf(`const ${name} = {`)
  if (start < 0) throw new Error(`could not find the ${name} dictionary`)
  const end = source.indexOf('\n    }', start)
  const block = source.slice(start, end)
  return new Set([...block.matchAll(/^\s+'([^']+)':/gm)].map((match) => match[1]))
}

const zh = keysOf('zh')
const en = keysOf('en')
const onlyZh = [...zh].filter((key) => !en.has(key))
const onlyEn = [...en].filter((key) => !zh.has(key))

console.log(`zh keys: ${zh.size}`)
console.log(`en keys: ${en.size}`)
if (onlyZh.length > 0) console.log(`only in zh: ${onlyZh.join(', ')}`)
if (onlyEn.length > 0) console.log(`only in en: ${onlyEn.join(', ')}`)
if (onlyZh.length > 0 || onlyEn.length > 0 || zh.size === 0) {
  console.error('FAIL - dictionaries are not key-parallel')
  process.exit(1)
}
console.log('MATCH - ok')
