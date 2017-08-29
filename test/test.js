/* global describe, it, before, after */
'use strict'

const debug = require('debug')('test')
debug('test')
console.log('test')
const expect = require('chai').expect
const express = require('express')
const nock = require('nock')
const streamToString = require('stream-to-string')
const rdfFetch = require('rdf-fetch')
const formats = require('rdf-formats-common')()

const formatsProxy = require('..')
const OldApiParserWrapper = formatsProxy.OldApiParserWrapper
formats.parsers['application/rdf+xml'] = new OldApiParserWrapper({ parser: require('rdf-parser-rdfxml') })

const nocksFile = './nock-rec.json'
const nockActive = true
const nockRecord = false

const proxyUrlHost = 'http://localhost'
const proxyPort = 8000
const proxyServer = proxyUrlHost + ':' + proxyPort
const proxyUrl = proxyServer + '/proxy'

const app = express()
app.get('/proxy', formatsProxy({ formats: formats }))

function proxyRequest (uri, accept) {
  return rdfFetch(proxyUrl + '?uri=' + uri, { headers: { 'Accept': accept } })
}

describe('http-rdf-formats-proxy', () => {
  before(() => {
    app.server = app.listen(proxyPort)
    if (nockRecord) {
      nock.recorder.rec({
        dont_print: true,
        output_objects: true
      })
    } else {
      if (nockActive) {
        nock.load(nocksFile)
      }
    }
  })
  after(() => {
    app.server.close()
    if (nockRecord) {
      require('fs').writeFileSync(nocksFile, JSON.stringify(
        nock.recorder.play().filter((nock) => {
          return (nock.scope !== proxyServer)
        })
      ))
    }
  })
  it('no uri specified -> 400 Bad Request', (done) => {
    rdfFetch(proxyUrl, { headers: { 'Accept': 'text/n3' } }).then((res) => {
      expect(res.status).to.be.equal(400)
      return streamToString(res.body)
    }).then((data) => {
      expect(data).to.be.equal('\'uri\' query parameter missing. ' +
        'Use ?uri=http://requested.example.com/file.rdf')
      done()
    }).catch(done)
  })
  it('convert json+ld to n3', (done) => {
    proxyRequest('http://xmlns.com/foaf/spec/index.jsonld', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(200)
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(620)
      done()
    }).catch(done)
  })
  it('convert rdf+xml to n3', (done) => {
    proxyRequest('http://xmlns.com/foaf/spec/index.rdf', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(200)
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(620)
      done()
    }).catch(done)
  })
  it('convert to unsupported/type should pass data through(?)', (done) => {
    proxyRequest('http://xmlns.com/foaf/spec/index.jsonld', 'unsupported/type').then((res) => {
      expect(res.status).to.be.equal(200)
      expect(res.headers.get('content-type')).to.be.equal('application/ld+json; charset=utf-8')
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(620)
      done()
    }).catch(done)
  })
  it('pass non-rdf page data through(?)', (done) => {
    proxyRequest('http://xmlns.com/foaf/foafsig', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(200)
      expect(res.headers.get('content-type')).to.be.equal('text/html; charset=utf-8')
      return streamToString(res.body)
    }).then((data) => {
      expect(data.length).to.be.equal(186)
      done()
    }).catch(done)
  })
  it('fetching a not existing page should pass 404 through', (done) => {
    proxyRequest('http://xmlns.com/404', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(404)
      expect(res.headers.get('content-type')).to.be.equal('text/html; charset=utf-8')
      done()
    }).catch(done)
  })
  it('fetching from a not existing server should yield 502(?)', (done) => {
    proxyRequest('http://example.com/resource.ttl', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(502)
      expect(res.headers.get('content-type')).to.be.equal('application/json; charset=utf-8')
      return res.json()
    }).then((data) => {
      expect(data.name).to.equal('FetchError')
      done()
    }).catch(done)
  })
})
