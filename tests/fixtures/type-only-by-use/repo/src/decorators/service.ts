import { Injectable } from './inject'
import { Repository } from './repository'

@Injectable()
export class Service {
  constructor(private readonly repository: Repository) {}
}
