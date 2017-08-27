'use strict'

const nock = require('nock')
function nockInit (host, port, record = false) {
  if (record) {
    nock.recorder.rec()
  } else {
    nock.disableNetConnect()
    require('./nock-rec')(nock, host + ':' + port)
  }
}
module.exports = nockInit
