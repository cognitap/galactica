import { analyzeRepository } from '../src/analysis.ts'
import { emptyConfig } from '../src/model.ts'
import {
  aspects,
  fixtureCases,
  fixtureRepo,
  readExpected,
  statusOf,
  writeExpected
} from './fixtures.ts'

for (const name of fixtureCases()) {
  const { model } = analyzeRepository(fixtureRepo(name), emptyConfig)
  const files = aspects.reduce((files, aspect) => {
    const status = statusOf(aspect, name)
    return aspect.stated(files) && !('pending' in status) ? status.update(files, model) : files
  }, readExpected(name))
  for (const path of writeExpected(name, files)) console.log(`updated ${path}`)
}
