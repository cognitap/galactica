const { add } = require('./math')
const config = require('./config.cjs')

function run() {
  return add(config.port, 1)
}

module.exports = { run }
