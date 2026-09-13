# Orca personal build

Based on `v1.4.200`; branch `personal/automation-models`. `upstream` is
`stablyai/orca`, `origin` is `nookkungz/orca`. Automation changes and personal
maintenance are separate commits.

## Build and update on this Mac

```sh
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm install --frozen-lockfile
pnpm personal:build
# Later, when you want the latest stable upstream release:
pnpm personal:update
```

The updater requires a clean checkout and the personal branch. It fetches the
latest stable release, merges it, checks the code, runs regression tests, and builds
the Mac package including Remote web assets. It stops on conflicts or failed checks.
Resolve conflicts and repeat the checks/build before installing. No automatic push
or installation occurs. Use `git merge --abort` to abandon a conflicting merge.

The personal build wrapper uses the current public Swift package interface while
compiling native helpers. This avoids stale Swift 5 private interfaces left by this
Mac's Command Line Tools upgrade; it does not modify the system toolchain.
Personal packages use ad-hoc signing without Apple notarization.

## Automation model selection

Choose Codex or Antigravity, then a Model. Default leaves the agent's existing
defaults in control. Codex also offers Effort; Antigravity model IDs include their
level, such as `gemini-3.8-flash-high`. Model discovery runs on the selected host.
A discovery failure displays an error and preserves the saved selection.
Every model override starts a fresh session each run.

```sh
orca automations edit <id> --model gpt-5.6-terra --effort low --fresh-session
orca automations edit <id> --clear-effort
orca automations edit <id> --clear-model
```

Omitted edit flags preserve saved fields. Clearing model also clears effort.
Old hosts reject overrides; ordinary default-only automations remain compatible.
Custom agent commands with conflicting model/effort flags must be corrected before
launching. The official mobile app and Relay protocol remain in use.

## Install, verify, and roll back

Wait until active sessions can restart. Quit Orca, then back up `/Applications/Orca.app`
and `~/Library/Application Support/orca` to a dated local folder. Install the built
app directly from `dist/`; the official **Use Local Build** flow requires its signing
identity and cannot import this personal build. First launch may require login or
mobile pairing again because the signature changes.

Before considering an installation verified, connect the user's phone through Relay,
read session output, send a message, restart Orca, reconnect, and run an Automation
with its selected model. A local build/test pass does not prove phone connectivity.

Use `pnpm personal:update` for personal updates. Orca's official updater installs
the official app and removes these patches. To roll back, quit Orca, restore the
backed-up app, and reopen it; restore the data backup only if needed, preserving a
copy of newer data first.
