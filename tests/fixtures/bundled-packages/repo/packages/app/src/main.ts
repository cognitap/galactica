import { createKit } from '@demo/kit'
import { run } from '@demo/kit/runner'
import { gone } from '@demo/kit/gone'
import { mount } from '@demo/widget'
import { probe } from '@demo/probe'

export const app = mount(run(createKit(probe(gone))))
