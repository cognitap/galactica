import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const candidates = [
  process.env['CHROME_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
]

/** The Chrome the page tests drive, or undefined when the machine has none. */
export const chrome = candidates.find(path => path !== undefined && existsSync(path))

export interface Page {
  /** Runs `body` as an async function in the page and gives its result, which must be JSON. */
  run<T>(body: string): Promise<T>
  /** Loads `html` from a file, with `fragment` in its address, and waits for its first frame. */
  load(html: string, fragment?: string): Promise<void>
}

/** A headless Chrome tab, closed with its profile after the test. */
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
    { stdio: 'ignore' }
  )
  t.after(async () => {
    browser.kill()
    await sleep(100)
    rmSync(dir, { recursive: true, force: true })
  })
  const portFile = join(dir, 'profile', 'DevToolsActivePort')
  for (let tries = 0; !existsSync(portFile); tries++) {
    if (tries > 200) throw new Error('Chrome did not start')
    await sleep(50)
  }
  const port = readFileSync(portFile, 'utf8').split('\n')[0]
  const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as {
    type: string
    webSocketDebuggerUrl: string
  }[]
  const socket = new WebSocket(targets.find(({ type }) => type === 'page')!.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  t.after(() => socket.close())

  let id = 0
  const replies = new Map<number, (message: { result?: unknown; error?: unknown }) => void>()
  const events: ((method: string) => void)[] = []
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data))
    if (message.id === undefined) for (const listen of events) listen(message.method)
    else replies.get(message.id)?.(message)
  })
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve, reject) => {
      replies.set(++id, ({ result, error }) =>
        error === undefined ? resolve(result) : reject(new Error(JSON.stringify(error)))
      )
      socket.send(JSON.stringify({ id, method, params }))
    })
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
    await loaded
    await run('await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve)))')
  }
  return { run, load }
}
