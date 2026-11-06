import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')
const step = workflow.split('      - name: Publish and verify the prepared archive')[1]!
const script = step.split('        run: |\n')[1]!.replace(/^ {10}/gm, '')

// Run the actual Actions step against an isolated registry simulation. Its version URL
// keeps returning the initial 404 while its package document reflects the upload.
function runPublish(t: TestContext, scenario: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'galactica-release-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  mkdirSync(join(cwd, 'release'))
  const archive = Buffer.from('prepared archive')
  const integrity = 'sha512-' + createHash('sha512').update(archive).digest('base64')
  writeFileSync(join(cwd, 'release/galactica.tgz'), archive)
  writeFileSync(
    join(cwd, 'release/release.json'),
    JSON.stringify({ sourceCommit: 'abc', version: '0.2.3', integrity })
  )
  const setup = `
    gh() { echo '{"event":"workflow_dispatch","head_branch":"main","path":".github/workflows/release.yml","head_repository":{"full_name":"cognitap/galactica"},"head_sha":"abc"}'; }
    sleep() { :; }
    npm() {
      [[ "$1" == publish ]] || return 1
      echo publish >> uploads
      [[ "$SCENARIO" != missing ]] || return 1
      touch live
      [[ "$SCENARIO" != lost_response ]]
    }
    curl() {
      local url output=/dev/stdout
      while [[ $# -gt 0 ]]; do
        url=$1
        if [[ "$1" == -o ]]; then output=$2; shift; fi
        shift
      done
      case "$url" in
        *galactica/0.2.3*) return 22 ;;
        *galactica|*galactica\\?*) ;;
        *) return 22 ;;
      esac
      if [[ "$SCENARIO" == unavailable ]]; then echo 503; return; fi
      # A repeated URL retains its pre-upload response.
      if ! grep -Fxq "$url" queried 2>/dev/null; then
        echo "$url" >> queried
        if [[ "$SCENARIO" == conflict ]]; then
          echo '{"versions":{"0.2.3":{"dist":{"integrity":"different"}}}}' > "$output"
          echo 200; return
        elif [[ "$SCENARIO" == existing || -e live ]]; then
          printf '{"versions":{"0.2.3":{"dist":{"integrity":"%s"}}}}\\n' "$INTEGRITY" > "$output"
          echo 200; return
        fi
      fi
      echo '{"versions":{}}' > "$output"
      echo 200
    }
  `
  const result = spawnSync('bash', ['-eu', '-o', 'pipefail', '-c', setup + script], {
    cwd,
    env: {
      ...process.env,
      SCENARIO: scenario,
      INTEGRITY: integrity,
      GITHUB_REPOSITORY: 'cognitap/galactica',
      CANDIDATE_RUN_ID: '123',
      GITHUB_RUN_ID: '456',
      GITHUB_RUN_ATTEMPT: '1'
    },
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  const uploads = join(cwd, 'uploads')
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    attempts: existsSync(uploads) ? readFileSync(uploads, 'utf8').trim().split('\n').length : 0
  }
}

test('a stale version URL does not hide a published archive', t => {
  const run = runPublish(t, 'upload')
  assert.equal(run.status, 0, run.output)
  assert.equal(run.attempts, 1)
})

test('an already-published matching archive skips the upload', t => {
  const run = runPublish(t, 'existing')
  assert.equal(run.status, 0, run.output)
  assert.equal(run.attempts, 0)
})

test('a lost publish response is recovered by verifying the registry', t => {
  const run = runPublish(t, 'lost_response')
  assert.equal(run.status, 0, run.output)
  assert.equal(run.attempts, 1)
})

test('an existing version with different bytes fails without uploading', t => {
  const run = runPublish(t, 'conflict')
  assert.equal(run.status, 1)
  assert.match(run.output, /Registry integrity differs/)
  assert.equal(run.attempts, 0)
})

test('a version that never becomes visible fails without a second upload', t => {
  const run = runPublish(t, 'missing')
  assert.equal(run.status, 1)
  assert.match(run.output, /Could not verify/)
  assert.equal(run.attempts, 1)
})

test('a registry outage fails verification without uploading', t => {
  const run = runPublish(t, 'unavailable')
  assert.equal(run.status, 1)
  assert.match(run.output, /HTTP 503/)
  assert.equal(run.attempts, 0)
})
