import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../dist/bin.js', import.meta.url))

/** Every child uses this Node and a temporary home, including when caching is enabled. */
export function cliRunner(
  cleanup: { after: (fn: () => void) => void } = { after },
  inherited: NodeJS.ProcessEnv = process.env
) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'galactica-cli-')))
  cleanup.after(() => rmSync(home, { recursive: true, force: true }))
  const env = {
    ...inherited,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: join(home, '.cache'),
    LOCALAPPDATA: join(home, 'AppData', 'Local')
  }
  const node = (
    args: readonly string[],
    options: { cwd?: string | URL; timeout?: number; maxBuffer?: number } = {}
  ) =>
    spawnSync(process.execPath, args, {
      timeout: 20_000,
      maxBuffer: 1 << 26,
      ...options,
      env,
      encoding: 'utf8'
    })
  const run = (cwd: string, ...args: string[]) => node([executable, ...args], { cwd })
  return { home, env, node, run }
}
