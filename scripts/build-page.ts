/** Bundle Galactica's own browser modules at build time; analyze no repository code. */

import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
mkdirSync(new URL('../dist/page/', import.meta.url), { recursive: true })
cpSync(
  new URL('../src/page/page.html', import.meta.url),
  new URL('../dist/page/page.html', import.meta.url)
)
for (const extension of ['js', 'css']) {
  buildSync({
    absWorkingDir: root,
    entryPoints: [`src/page/page.${extension}`],
    outfile: `dist/page/page.${extension}`,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    // CSS syntax transforms round color alpha; whitespace minification preserves the pixels.
    minify: extension === 'js',
    minifyWhitespace: true,
    legalComments: 'none',
    target: 'es2022',
    charset: 'utf8'
  })
}
