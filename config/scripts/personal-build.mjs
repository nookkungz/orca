import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { getLocalBuildIdentity } from './build-mac-local.mjs'
import { resolvePnpmCliInvocation } from './pnpm-cli-invocation.mjs'

if (!['darwin', 'win32'].includes(process.platform)) {
  throw new Error('Personal packaging supports macOS and Windows.')
}
const pnpm = resolvePnpmCliInvocation()
const identity = process.platform === 'win32' ? getLocalBuildIdentity() : null
execFileSync(
  pnpm.command,
  [...pnpm.prefixArgs, process.platform === 'win32' ? 'build:win' : 'build:mac'],
  {
    cwd: resolve(import.meta.dirname, '../..'),
    stdio: 'inherit',
    shell: pnpm.shell,
    windowsHide: true,
    env: {
      ...process.env,
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_PERSONAL_BUILD: '1',
      ...(identity
        ? { ORCA_BUILD_COMMIT: identity.commit, ORCA_LOCAL_BUILD_VERSION: identity.version }
        : {}),
      ...(process.platform === 'darwin'
        ? { SWIFT_EXEC: resolve(import.meta.dirname, 'personal-swiftc.mjs') }
        : {})
    }
  }
)
