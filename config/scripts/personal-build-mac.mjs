import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

execFileSync('pnpm', ['build:mac'], {
  cwd: resolve(import.meta.dirname, '../..'),
  stdio: 'inherit',
  env: {
    ...process.env,
    ORCA_BACKGROUND_LAUNCH: '1',
    SWIFT_EXEC: resolve(import.meta.dirname, 'personal-swiftc.mjs')
  }
})
