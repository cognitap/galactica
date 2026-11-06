import { byId } from './dom.js'
import { draw } from './navigation.js'

/** @type {import('../page-data.ts').PageData} */
const data = JSON.parse(byId('galactica-data').textContent ?? '')

draw(data)
