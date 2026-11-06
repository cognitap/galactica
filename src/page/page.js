import { decodePage } from './decode.js'
import { byId } from './dom.js'
import { draw } from './navigation.js'

const data = decodePage(JSON.parse(byId('galactica-data').textContent ?? ''))

draw(data)
