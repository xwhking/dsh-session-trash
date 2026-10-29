/**
 * Recover a profile whose `link:` install left a junction pnpm cannot replace.
 *
 * Symptom: installing or updating the plugin fails with
 *
 *   [ERR_PNPM_EPERM] [importPackage ...\node_modules\dsh-session-trash]
 *   EPERM: operation not permitted, rename '..._tmp_1234_1' -> '...\dsh-session-trash'
 *
 * Cause: a `link:` dependency is materialised as a Windows junction. pnpm
 * replaces a package by renaming a temp directory over the old one, and NTFS
 * refuses to replace a reparse point that way, so every attempt fails and the
 * temp directory gets parked under node_modules\.ignored.
 *
 * Fix: delete ONLY the junction (never recursing into its target, which is your
 * source checkout), drop pnpm's leftovers, then install again.
 *
 *   node scripts/fix-link-install.cjs <profileDir>          # dry run
 *   node scripts/fix-link-install.cjs <profileDir> --yes    # repair
 *
 * It refuses to delete anything that is not a junction, and confirms the source
 * directory still exists afterwards.
 */
const { existsSync, lstatSync, readdirSync, readlinkSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const PACKAGE = 'dsh-session-trash'

function main() {
  const profileDir = process.argv[2]
  const confirmed = process.argv.includes('--yes')
  if (profileDir === undefined || profileDir === '') {
    console.error('usage: node scripts/fix-link-install.cjs <profileDir> [--yes]')
    process.exit(2)
  }

  const nodeModules = join(profileDir, 'node_modules')
  if (!existsSync(nodeModules)) {
    console.error(`not a profile directory (no node_modules): ${profileDir}`)
    process.exit(2)
  }

  const target = join(nodeModules, PACKAGE)
  let sourcePath = undefined

  if (existsSync(target)) {
    const stats = lstatSync(target)
    if (!stats.isSymbolicLink()) {
      console.error(
        `${target} is a real directory, not a link — refusing to delete it.\n` +
          'Remove it by hand, or reinstall the plugin from the DSH UI.',
      )
      process.exit(1)
    }
    sourcePath = readlinkSync(target)
    console.log(`junction: ${target}`)
    console.log(`      -> ${sourcePath}`)
    if (!confirmed) {
      console.log('\nDry run. Re-run with --yes to delete the junction and clean pnpm leftovers.')
      return
    }
    // recursive: false deletes the reparse point only; the checkout it points at
    // is never walked into.
    rmSync(target, { recursive: false, force: false })
    console.log('removed the junction (its target was not touched)')
    if (!existsSync(sourcePath)) {
      console.error(`WARNING: the link target is gone: ${sourcePath}`)
      process.exit(1)
    }
    console.log(`source still present: ${sourcePath}`)
  } else {
    console.log(`${PACKAGE} is not installed here; no junction to remove.`)
  }

  const ignored = join(nodeModules, '.ignored')
  if (existsSync(ignored)) {
    if (!confirmed) {
      console.log('would remove: node_modules/.ignored')
    } else {
      rmSync(ignored, { recursive: true, force: true })
      console.log('removed pnpm leftovers: node_modules/.ignored')
    }
  }

  for (const entry of readdirSync(nodeModules)) {
    if (!entry.startsWith(`${PACKAGE}_tmp_`)) continue
    if (!confirmed) {
      console.log(`would remove: node_modules/${entry}`)
    } else {
      rmSync(join(nodeModules, entry), { recursive: true, force: true })
      console.log(`removed stale temp: node_modules/${entry}`)
    }
  }

  if (!confirmed) return
  console.log('\nRepaired. Install the plugin again from the DSH UI (or:')
  console.log('  plugin_manager  action: install_bundle  target: <plugin directory>)')
}

main()
