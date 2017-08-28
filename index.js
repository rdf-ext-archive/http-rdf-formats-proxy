'use strict'

const debug = require('debug')('http-rdf-formats-proxy')
const debugCall = require('debug')('call:http-rdf-formats-proxy')
const rdfFetch = require('rdf-fetch-lite')
const formats = require('rdf-formats-common')()
const streamToString = require('stream-to-string')

class RdfFormatsProxy {
  constructor (req, res, next, options) {
    debugCall('_constructor(req, res, next, options)')
    debugCall(options)
    this.req = req
    this.res = res
    this.next = next
    options = options || {}
    this.fetch = options.fetch || rdfFetch
    this.formats = options.formats ||
      (this.fetch.defaults && this.fetch.defaults.formats
        ? this.fetch.defaults.formats : formats)
  }

  proxy () {
    debugCall('proxy()')
    const badRequest = this._processRequest()
    if (badRequest) {
      this._send(badRequest, 400)
    } else {
      Promise.resolve()
      .then(this._fetch.bind(this))
      .then(this._processFetchResponse.bind(this))
      .then(this._processData.bind(this))
      .then(this._send.bind(this))
      .catch((err) => {
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
    // build fetch options
    this.fetchOptions = {
      method: this.req.method,
      headers: { 'accept': this.req.headers['accept'] },
      formats: this.formats
    }
    // process Accept header
    // TODO: do this properly (with correct priorities)
    if (this.req.headers['accept']) {
      this.accept = this.req.headers['accept']
        .split(/,\s*/)
        .map((type) => {
          return type.split(';').shift()
        })
    } else {
      this.fetchOptions.headers.accept = 'text/n3'
      this.accept = [ this.fetchOptions.headers.accept ]
    }
    return null // No Request error
  }

  _fetch () {
    debugCall('_fetch() // ' + this.req.query.uri)
//    debug(this.fetchOptions)
    return this.fetch(this.req.query.uri, this.fetchOptions)
  }

  _processFetchResponse (res) {
    debugCall('_processResponse(res)')
    this.fetchResponse = res
    // get status and content type from the response
    this.status = res.status
    this.contentType = res.headers.get('content-type')
    if (this.contentType) {
      this.contentType = this.contentType.split(';').shift()
    }
    debug('Content-type: ' + this.contentType)

    // if the response status is ok
    if (res.status >= 200 && res.status < 300) {
      // what we do with that content-type?
      if (this.accept.indexOf(this.contentType) === -1) {
        debug('Content-type not in accepted. Can we serialize?')
        this._findSerializer()
        if (this.serializer) {
          debug('Serializer found, set content-type: ' + this.contentType)
          return res.quadStream()
        } else {
          debug('No serializer found...')
        }
      } else {
        debug('No translation required...')
      }
    } else {
      debug('Status is not ok (' + res.status + ')...')
    }
    debug('Passing data through')
    return streamToString(res.body)
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
      return
    }
    const serializersList = this.formats.serializers.list()
    this.serializer = null
    this.accept.some((acceptMime) => {
      if (serializersList.indexOf(acceptMime) !== -1) {
        if (this.serializer) { return true }
        this.contentType = acceptMime
        this.serializer = this.formats.serializers.find(acceptMime)
      }
    })
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
}

module.exports = function (options) {
  return function (req, res, next) {
    (new RdfFormatsProxy(req, res, next, options)).proxy()
  }
}
module.exports.OldApiParserWrapper = require('./lib/rdf-parser-oldapi-wrapper')
