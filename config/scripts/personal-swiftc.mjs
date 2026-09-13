#!/usr/bin/env node
// CLT upgrades can leave a Swift 5 private manifest interface beside a Swift 6 library.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const compiler = execFileSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).trim()
const args = process.argv.slice(2)
let staging
try {
  if (args.includes('-package-description-version')) {
    const source = resolve(
      dirname(compiler),
      '../lib/swift/pm/ManifestAPI/PackageDescription.swiftmodule'
    )
    staging = mkdtempSync(join(tmpdir(), 'orca-personal-swift-'))
    const target = join(staging, 'PackageDescription.swiftmodule')
    mkdirSync(target)
    for (const name of readdirSync(source)) {
      if (name.endsWith('.swiftinterface') && !name.includes('.private.')) {
        copyFileSync(join(source, name), join(target, name))
      }
    }
    args.unshift('-I', staging)
  }
  const result = spawnSync(compiler, args, { stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  process.exitCode = result.status ?? 1
} finally {
  if (staging) {
    rmSync(staging, { recursive: true, force: true })
  }
}
