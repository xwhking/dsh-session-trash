const fs = require('fs')
const path = require('path')

const dir = path.join(process.argv[2], 'package')
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
const client = fs.readFileSync(path.join(dir, 'client.js'), 'utf8')

const idLine = client.split('\n')[1].trim()
const host = fs.readFileSync(path.join(dir, 'index.js'), 'utf8')

console.log('version      =', pkg.version)
console.log('client       =', idLine)
console.log('moves to bin =', host.includes('filesRoot') ? 'yes' : 'NO')
console.log('old gate     =', host.includes('refusing to purge a chat that is still running') ? 'STILL PRESENT' : 'removed')
