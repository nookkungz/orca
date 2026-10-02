const path = require('node:path')
process.env.PATH = __dirname + path.delimiter + process.env.PATH
require(path.resolve(__dirname, '../../../../out/cli/index.js')).main([
  'codex-team',
  ...process.argv.slice(2)
])
