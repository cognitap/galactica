const { add } = require('./math')

exports = module.exports = createApp

function createApp() {
  return { total: add(1, 2) }
}

var routes = exports.routes = []
exports.version = '1.0.0'
