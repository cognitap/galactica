import { Field } from './inject'
import { Service } from './service'

export class Repository {
  @Field()
  owner?: Service
}
