/**
 * The repositories and tasks of the agent benchmark. Each repository is
 * pinned to one commit. Each task's ground truth was established by reading
 * the code at that commit with rg, never from Galactica's output; the README
 * beside this file says how.
 */

export interface Repository {
  readonly name: string
  readonly url: string
  readonly commit: string
}

export const repositories = {
  hono: {
    name: 'hono',
    url: 'https://github.com/honojs/hono',
    commit: 'eb754bd5ef22c63f1634a4c374a86be086f85710'
  },
  vite: {
    name: 'vite',
    url: 'https://github.com/vitejs/vite',
    commit: '483512809bbdb399d66be59af0f5aeb01ccb7181'
  },
  nest: {
    name: 'nest',
    url: 'https://github.com/nestjs/nest',
    commit: '6e83cc83c99cbac0108384392902e7230ed94843'
  }
} as const satisfies Record<string, Repository>

export type RepositoryName = keyof typeof repositories

/** A list the answer must end with, and the paths it must contain. */
export interface AnswerList {
  readonly heading: 'FILES' | 'TESTS'
  readonly required: readonly string[]
}

/**
 * How a run is graded. `lists` reads the lists that end the answer. `rename`
 * parses every changed file and counts identifiers. `edit` checks that the
 * named file changed and still parses, and then grades the lists.
 */
export type Grading =
  | { readonly kind: 'lists'; readonly lists: readonly AnswerList[] }
  | { readonly kind: 'rename'; readonly from: string; readonly to: string }
  | { readonly kind: 'edit'; readonly file: string; readonly lists: readonly AnswerList[] }

export interface Task {
  readonly id: string
  readonly repository: RepositoryName
  readonly kind: 'impact' | 'rename' | 'edit-and-name-tests'
  readonly prompt: string
  readonly grading: Grading
}

const testsList = (required: readonly string[]): AnswerList => ({ heading: 'TESTS', required })

const testsEnding =
  'Do not run tests, builds or package managers. End your reply with a line `TESTS:` followed by the test files to run, one repository-relative path per line, most relevant first.'

export const tasks: readonly Task[] = [
  {
    id: 'hono-rename',
    repository: 'hono',
    kind: 'rename',
    prompt:
      'Rename the exported function `encodeBase64` in src/utils/encode.ts to `bytesToBase64`, and update every reference to it in this repository, in every package and in tests. Do not keep the old name as an alias, and change nothing else. Do not run tests, builds or package managers. End with a one-paragraph summary.',
    grading: { kind: 'rename', from: 'encodeBase64', to: 'bytesToBase64' }
  },
  {
    id: 'hono-tests',
    repository: 'hono',
    kind: 'edit-and-name-tests',
    prompt: `Change \`decodeBase64\` in src/utils/encode.ts so that it throws an \`Error\` with the message \`Invalid base64 input\` when its input is not valid base64, instead of the error \`atob\` throws. Edit only src/utils/encode.ts. Then tell me which test files I should run to check this change. ${testsEnding}`,
    grading: {
      kind: 'edit',
      file: 'src/utils/encode.ts',
      lists: [
        testsList([
          'src/utils/encode.test.ts',
          'src/utils/basic-auth.test.ts',
          'src/middleware/basic-auth/index.test.ts',
          'src/utils/jwt/jwt.test.ts',
          'src/middleware/jwt/index.test.ts',
          'src/middleware/jwk/index.test.ts',
          'src/adapter/aws-lambda/handler.test.ts',
          'src/adapter/lambda-edge/handler.test.ts',
          'adapters/aws-lambda/src/handler.test.ts',
          'adapters/lambda-edge/src/handler.test.ts',
          'adapters/aws-lambda/test/index.test.ts',
          'adapters/lambda-edge/test/index.test.ts'
        ])
      ]
    }
  },
  {
    id: 'vite-tests',
    repository: 'vite',
    kind: 'edit-and-name-tests',
    prompt: `Change \`injectSourcesContent\` in packages/vite/src/node/server/sourcemap.ts so that a source file that cannot be read gets an empty string in \`sourcesContent\` instead of \`null\`. Keep the warning about missing sources. Edit only that file. Then tell me which test files I should run to check this change. ${testsEnding}`,
    grading: {
      kind: 'edit',
      file: 'packages/vite/src/node/server/sourcemap.ts',
      lists: [
        testsList([
          'packages/vite/src/node/server/__tests__/sourcemap.spec.ts',
          'playground/js-sourcemap/__tests__/js-sourcemap.spec.ts',
          'playground/css-sourcemap/__tests__/css-sourcemap.spec.ts'
        ])
      ]
    }
  },
  {
    id: 'nest-impact',
    repository: 'nest',
    kind: 'impact',
    prompt:
      'I want to change the exports of packages/common/utils/cli-colors.util.ts (`clc`, `yellow` and `isColorAllowed`). Which non-test source files use them and would be affected, and which test files should I run afterwards? Do not modify any files. End your reply with a line `FILES:` followed by the affected non-test source files, one repository-relative path per line, then a line `TESTS:` followed by the test files to run, one per line.',
    grading: {
      kind: 'lists',
      lists: [
        {
          heading: 'FILES',
          required: [
            'packages/common/services/console-logger.service.ts',
            'packages/core/injector/instance-wrapper.ts',
            'packages/core/injector/injector.ts',
            'packages/core/repl/native-functions/debug-repl-fn.ts',
            'packages/core/repl/native-functions/help-repl-fn.ts',
            'packages/core/repl/native-functions/methods-repl-fn.ts',
            'packages/core/repl/repl.ts',
            'packages/core/repl/repl-function.ts'
          ]
        },
        testsList([
          'packages/common/test/utils/cli-colors.util.spec.ts',
          'packages/common/test/services/logger.service.spec.ts',
          'packages/core/test/repl/native-functions/debug-repl-fn.spec.ts',
          'packages/core/test/repl/native-functions/help-repl-fn.spec.ts',
          'packages/core/test/repl/native-functions/methods-repl-fn.spec.ts',
          'integration/repl/e2e/repl.spec.ts'
        ])
      ]
    }
  },
  {
    id: 'nest-rename',
    repository: 'nest',
    kind: 'rename',
    prompt:
      'Rename the exported function `randomStringGenerator` in packages/common/utils/random-string-generator.util.ts to `generateRandomId`, and update every reference to it in this repository, in every package and in tests. Do not keep the old name as an alias, and change nothing else. Do not run tests, builds or package managers. End with a one-paragraph summary.',
    grading: { kind: 'rename', from: 'randomStringGenerator', to: 'generateRandomId' }
  },
  {
    id: 'nest-tests',
    repository: 'nest',
    kind: 'edit-and-name-tests',
    prompt: `Change \`selectExceptionFilterMetadata\` in packages/common/utils/select-exception-filter-metadata.util.ts so that when several filters match an exception, a filter that lists the exception's own class wins over one that matches only through a parent class or catches every exception. Among equally specific filters, keep the first. Edit only that file. Then tell me which test files I should run to check this change. ${testsEnding}`,
    grading: {
      kind: 'edit',
      file: 'packages/common/utils/select-exception-filter-metadata.util.ts',
      lists: [
        testsList([
          'packages/common/test/utils/select-exception-filter-metadata.util.spec.ts',
          'packages/core/test/exceptions/exceptions-handler.spec.ts',
          'packages/core/test/exceptions/external-exceptions-handler.spec.ts',
          'packages/microservices/test/exceptions/rpc-exceptions-handler.spec.ts',
          'packages/websockets/test/exceptions/ws-exceptions-handler.spec.ts'
        ])
      ]
    }
  }
]

export const conditions = ['without', 'skill', 'instructed'] as const
export type Condition = (typeof conditions)[number]

/** The short instruction of the `instructed` condition, written to CLAUDE.md. */
export const instruction =
  'This repository has the galactica skill installed. Load it and use its commands for any question about where code lives, what depends on a file, which tests to run, or import cycles.'
