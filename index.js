'use strict'

const debug = require('debug')('http-rdf-formats-proxy')
const debugCall = require('debug')('call:http-rdf-formats-proxy')
const rdfFetch = require('rdf-fetch-lite')
const formats = require('rdf-formats-common')()
const streamToString = require('stream-to-string')
const accept = require('accept/lib/mediatype')

class RdfFormatsProxy {
  constructor (req, res, next, options) {
    debugCall('_constructor(req, res, next, options) // options = %o', options)
    this.req = req
    this.res = res
    this.next = next
    options = options || {}

    this.fetch = options.fetch || rdfFetch
    this.formats = options.formats ||
      (this.fetch.defaults && this.fetch.defaults.formats
        ? this.fetch.defaults.formats : formats)

    this.fetchAccepts = this.formats.parsers.list()
    this.fetchProduces = this.formats.serializers.list()
    this.fetchOptions = {
      method: this.req.method,
      headers: {},
      formats: this.formats
    }
  }

  proxy () {
    debugCall('proxy()')
    const badRequest = this._processRequest()
    if (badRequest) {
      this._send(badRequest, 400)
    } else {
      Promise.resolve()
      .then(this._fetch.bind(this))
      .then(this._processResponse.bind(this))
      .then(this._processData.bind(this))
      .then(this._send.bind(this))
      .catch((err) => {
        debug('something failed... %o', err)
        this._send(err, 502)
      })
    }
  }

  _processRequest () {
    debugCall('_processRequest()')
    // uri query parameter required
    if (!this.req.query.uri) {
      return '\'uri\' query parameter missing. ' +
        'Use ?uri=http://requested.example.com/file.rdf'
    }
    if (this.req.headers['content-type']) {
      this.fetchOptions.headers['content-type'] = this.req.headers['content-type']
      this.clientProduces = this.req.headers['content-type'].split(';').shift()
    }
    this.clientAccepts = accept.mediaTypes(this.req.headers['accept'])
    this.fetchOptions.headers.accept = this._uniq(
      this.fetchAccepts.concat(this.clientAccepts))

    this.usableSerializers = this._intersect(this.clientAccepts, this.fetchProduces)
    debug('-----------  Request negotiation  ------------')
    debug('Headers: %o', this.req.headers)
    debug('client produces: %o', this.clientProduces)
    debug('client accepts: %o', this.clientAccepts)
    debug('fetch accepts: %o', this.fetchAccepts)
    debug('fetch produces: %o', this.fetchProduces)
    debug('usable serializers: %o', this.usableSerializers)
    debug('----------- /Request negotiation  ------------')

    return null // No Request error
  }

  _fetch () {
    debugCall('_fetch()')
    debug('fetching "%s" with options: %o', this.req.query.uri, this.fetchOptions)
    return this.fetch(this.req.query.uri, this.fetchOptions)
  }

  _processResponse (res) {
    debugCall('_processResponse(res)')
    // get status and content type from the response
    this.fetchResponse = res
    debug('response: %o', res)
    this.status = res.status
    debug('response status: %d', this.status)
    this.contentType = res.headers.get('content-type')
    if (this.contentType) {
      this.serverProduces = this.contentType.split(';').shift()
    }
    debug('server produces: %o', this.serverProduces)
    // if the response status is not ok
    if (res.status < 200 && res.status > 299) {
      debug('Status is not ok (' + res.status + '). Passing data through...')
      return this._passThrough()
    }
    if (this.clientAccepts.indexOf(this.serverProduces) !== -1) {
      debug('Client accepts what server produces. Passing data through...')
      return this._passThrough()
    }
    // what we do with that content-type?
    if (this.fetchAccepts.indexOf(this.serverProduces) === -1) {
      debug('Server\'s response cannot be accepted for parsing. Passing data through...')
      return this._passThrough()
    }

    debug('Client does not accept. Can we serialize?')
    if (this._findSerializer()) {
      debug('Serializer found, changed content-type: ' + this.contentType + ' and Passing quadStream through...')
      return res.quadStream()
    }

    debug('Passing data through...')
    return this._passThrough()
  }

  _processData (quadStreamOrData) {
    debugCall('_processData()')
    if (!this.serializer) {
      debug('Passing through with status ' + this.status)
      return Promise.resolve(quadStreamOrData)
    } else {
      debug('Serializing')
      return streamToString(this.serializer.import(quadStreamOrData))
    }
  }

  _findSerializer () {
    debugCall('_findSerializer()')
    if (this.contentType === null) {
      debug('no content-type... cannot convert from unknown format')
      return false
    }
    if (this.usableSerializers.length === 0) {
      debug('no usable serializers... cannot convert')
      return false
    }
    this.contentType = this.usableSerializers.shift()
    this.serializer = this.formats.serializers.find(this.contentType)
    return true
  }

  _send (data, status = null) {
    debugCall('_send(data [,status])')
    status = status || this.status
    debug('Sending ' + data.length + ' bytes back as "' + this.contentType + '" with status ' + status)
    if (this.contentType) {
      debug('Setting response content-type: ' + this.contentType)
      this.res.set('content-type', this.contentType)
    }
    return this.res.status(status).send(data)
  }

  _passThrough () {
    return streamToString(this.fetchResponse.body)
  }

  // util methods
  _uniq (array) {
    return [...new Set(array)]
  }
  _intersect (a, b) {
    let t; if (b.length > a.length) { t = b; b = a; a = t }
    return a.filter((e) => { return b.indexOf(e) > -1 })
  }
}

module.exports = function (options) {
  return function (req, res, next) {
    (new RdfFormatsProxy(req, res, next, options)).proxy()
  }
}
module.exports.OldApiParserWrapper = require('./rdf-parser-oldapi-wrapper')
