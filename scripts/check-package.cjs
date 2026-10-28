/**
 * Assert that package.json parses and has no UTF-8 BOM.
 *
 * DSH validates an installed package with a strict JSON parser, and a BOM makes
 * it reject the whole install with "Unexpected token ... is not valid JSON".
 * PowerShell's `Set-Content -Encoding utf8` writes a BOM, so a version bump done
 * that way silently breaks installation for everyone else.
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const path = join(__dirname, '..', 'package.json')
const bytes = readFileSync(path)
const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf

console.log(`package.json bytes: ${bytes.length}`)
console.log(`UTF-8 BOM: ${hasBom ? 'PRESENT' : 'none'}`)
if (hasBom) {
  console.error('FAIL - package.json starts with a UTF-8 BOM; DSH will reject the install')
  process.exit(1)
}
try {
  JSON.parse(bytes.toString('utf8'))
} catch (error) {
  console.error(`FAIL - package.json does not parse: ${String(error)}`)
  process.exit(1)
}
console.log('OK - package.json parses and has no BOM')
