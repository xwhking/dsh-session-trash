/**
 * Test the link-install repair with real junctions and a real source directory.
 *
 * This verifies the important safety property, not just the happy path: the
 * junction must go away while every source file stays intact. It also verifies
 * that a real package directory is never deleted.
 *
 * Windows only: the bug is a junction/NTFS interaction. On other platforms the
 * test reports itself as skipped rather than pretending to cover junctions.
 */
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { repairLinkInstall } = require('./fix-link-install.cjs')

if (process.platform !== 'win32') {
  console.log('SKIP - junction repair is Windows-specific')
  process.exit(0)
}

const root = mkdtempSync(join(tmpdir(), 'session-trash-repair-test-'))
const profile = join(root, 'profile')
const source = join(root, 'source')
const nodeModules = join(profile, 'node_modules')
const link = join(nodeModules, 'dsh-session-trash')

function makeJunction(target, path) {
  // The exact absolute path is always checked by the caller before a junction
  // is made; this test only operates on the mkdtemp sandbox above.
  execFileSync('cmd.exe', ['/d', '/c', 'mklink', '/J', path, target], { stdio: 'pipe' })
}

try {
  mkdirSync(nodeModules, { recursive: true })
  mkdirSync(source, { recursive: true })
  const marker = join(source, 'index.js')
  writeFileSync(marker, 'export const keep = true\n', 'utf8')
  makeJunction(source, link)
  writeFileSync(join(nodeModules, 'dsh-session-trash_tmp_1234_1'), 'leftover', 'utf8')

  const dry = repairLinkInstall(profile, { confirmed: false })
  assert.equal(dry.junctionRemoved, false)
  assert.equal(lstatSync(link).isSymbolicLink(), true, 'dry run must leave the junction in place')

  const result = repairLinkInstall(profile, { confirmed: true })
  assert.equal(result.junctionRemoved, true)
  assert.equal(existsSync(link), false, 'the junction must be removed')
  assert.equal(existsSync(source), true, 'the source directory must survive')
  assert.equal(readFileSync(marker, 'utf8'), 'export const keep = true\n', 'the source file must be unchanged')
  assert.equal(existsSync(join(nodeModules, 'dsh-session-trash_tmp_1234_1')), false, 'pnpm temp leftovers must be removed')
  console.log('PASS  removes a junction without touching its source checkout')

  // Reinstalling after the repair now uses a real directory, which is what makes
  // the next update safe from the same rename failure.
  cpSync(source, link, { recursive: true })
  assert.equal(lstatSync(link).isSymbolicLink(), false)
  assert.throws(
    () => repairLinkInstall(profile, { confirmed: true }),
    /refusing to delete/,
    'a real package directory must never be deleted by this repair',
  )
  assert.equal(existsSync(join(link, 'index.js')), true, 'the real package directory must be untouched')
  console.log('PASS  refuses to delete a real installed package directory')

  // Idempotence: with the package gone entirely, a run is a safe no-op.
  rmSync(link, { recursive: true, force: true })
  const again = repairLinkInstall(profile, { confirmed: true })
  assert.equal(again.junctionRemoved, false)
  console.log('PASS  a run with nothing to repair is a safe no-op')

  console.log('\n3/3 checks passed')
} finally {
  rmSync(root, { recursive: true, force: true })
}
