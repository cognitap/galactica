import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { pathToFileURL } from 'node:url'

const candidates = [
  process.env['CHROME_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

export const chrome = candidates.find(path => path !== undefined && existsSync(path))

/** Long enough for a cold Chrome on a loaded CI runner, short enough that a hang fails the test instead of the job. */
const patience = 30_000

export interface Page {
  /** Runs `body` as an async function in the page and gives its result, which must be JSON. */
  run<T>(body: string): Promise<T>
  load(html: string, fragment?: string): Promise<void>
}

function within<T>(promise: Promise<T>, what: string, ms = patience): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took over ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** The port Chrome prints once its DevTools endpoint listens, or a rejection with its output if it exits first. */
function devToolsPort(browser: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ''
    browser.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
      const port = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(output)?.[1]
      if (port !== undefined) resolve(port)
    })
    browser.once('exit', code =>
      reject(new Error(`Chrome exited with ${code} before listening:\n${output}`))
    )
  })
}

/**
 * Signals Chrome's process group, which holds the helpers that can outlive the
 * browser process. macOS answers EPERM for a group whose members have all exited.
 */
function signalGroup(browser: ChildProcess, signal: NodeJS.Signals) {
  try {
    process.kill(-browser.pid!, signal)
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException
    if (code !== 'ESRCH' && code !== 'EPERM') throw error
  }
}

/** Ends Chrome and every helper, and removes its profile only once the browser has exited. */
async function stop(browser: ChildProcess, exited: Promise<unknown>, dir: string) {
  signalGroup(browser, 'SIGTERM')
  await within(exited, 'Chrome exiting', 5_000).catch(async () => {
    signalGroup(browser, 'SIGKILL')
    await within(exited, 'Chrome exiting after SIGKILL', 5_000)
  })
  signalGroup(browser, 'SIGKILL')
  browser.stderr?.destroy()
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

export async function openPage(t: TestContext, path: string): Promise<Page> {
  const dir = mkdtempSync(join(tmpdir(), 'galactica-chrome-'))
  const file = join(dir, 'map.html')
  const browser = spawn(
    path,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${join(dir, 'profile')}`,
      '--no-first-run',
      '--window-size=1280,900',
      // GitHub's Linux runners do not allow Chrome's sandbox, and the page is our own.
      ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      'about:blank'
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true }
  )
  const exited = new Promise(resolve => browser.once('exit', resolve))
  t.after(() => stop(browser, exited, dir))

  const port = await within(devToolsPort(browser), 'Chrome starting')
  const targets = (await (
    await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(patience) })
  ).json()) as { type: string; webSocketDebuggerUrl: string }[]
  const socket = new WebSocket(targets.find(({ type }) => type === 'page')!.webSocketDebuggerUrl)
  t.after(() => socket.close())
  await within(
    new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    }),
    'DevTools connecting'
  )

  let id = 0
  const replies = new Map<number, (message: { result?: unknown; error?: unknown }) => void>()
  const events: ((method: string) => void)[] = []
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    if (message.id === undefined) for (const listen of events) listen(message.method)
    else replies.get(message.id)?.(message)
  })
  const send = (method: string, params: object = {}) =>
    within(
      new Promise<any>((resolve, reject) => {
        replies.set(++id, ({ result, error }) =>
          error === undefined ? resolve(result) : reject(new Error(JSON.stringify(error)))
        )
        socket.send(JSON.stringify({ id, method, params }))
      }),
      method
    )
  await send('Page.enable')

  const run = async <T>(body: string): Promise<T> => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true
    })
    if (exceptionDetails !== undefined) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    }
    return result.value as T
  }
  const load = async (html: string, fragment = '') => {
    writeFileSync(file, html)
    const loaded = new Promise<void>(resolve =>
      events.push(method => method === 'Page.loadEventFired' && resolve())
    )
    await send('Page.navigate', { url: `${pathToFileURL(file).href}?${id}${fragment}` })
    await within(loaded, 'the page loading')
    await run('await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))')
  }
  return { run, load }
}
