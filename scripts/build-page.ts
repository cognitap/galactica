/** Bundle Galactica's own browser modules at build time; analyze no repository code. */

import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
mkdirSync(new URL('../dist/page/', import.meta.url), { recursive: true })
for (const name of ['page.css', 'page.html']) {
  cpSync(
    new URL(`../src/page/${name}`, import.meta.url),
    new URL(`../dist/page/${name}`, import.meta.url)
  )
}
buildSync({
  absWorkingDir: root,
  entryPoints: ['src/page/page.js'],
  outfile: 'dist/page/page.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  charset: 'utf8'
})
