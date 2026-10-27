const fs = require('fs')

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const src = fs.readFileSync('client.js', 'utf8')
const match = src.match(/id:\s*['"]([^'"]+)['"]/)

console.log('package.name =', pkg.name)
console.log('client id    =', match ? match[1] : '(not found)')
console.log(match && match[1] === pkg.name ? 'MATCH - ok' : 'MISMATCH - broken')

if (!match || match[1] !== pkg.name) process.exit(1)
