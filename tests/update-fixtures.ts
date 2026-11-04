import { discover } from '../src/discovery.ts'
import {
  aspects,
  fixtureCases,
  fixtureRepo,
  readExpected,
  statusOf,
  writeExpected
} from './fixtures.ts'

for (const name of fixtureCases()) {
  const discovery = discover(fixtureRepo(name))
  const files = aspects.reduce((files, aspect) => {
    const status = statusOf(aspect, name)
    return aspect.stated(files) && !('pending' in status) ? status.update(files, discovery) : files
  }, readExpected(name))
  for (const path of writeExpected(name, files)) console.log(`updated ${path}`)
}
