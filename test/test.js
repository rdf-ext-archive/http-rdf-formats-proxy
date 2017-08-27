/* global describe, it, before, after */
'use strict'

// const debug = require('debug')('test')
const expect = require('chai').expect
const express = require('express')
const streamToString = require('stream-to-string')
const rdfFetch = require('rdf-fetch')
const formatsProxy = require('..')

const proxyUrlHost = 'http://localhost'
const proxyPort = 8000

const nockInit = require('./nock-init')
nockInit(proxyUrlHost, proxyPort)

const proxyUrl = proxyUrlHost + ':' + proxyPort + '/proxy'

const app = express()
app.get('/proxy', formatsProxy())

function proxyRequest (uri, accept) {
  return rdfFetch(proxyUrl + '?uri=' + uri, { headers: { 'Accept': accept } })
}

describe('rdf-formats-proxy', () => {
  before(() => {
    app.server = app.listen(proxyPort)
  })
  after(() => {
    app.server.close()
  })
  it('no uri specified', (done) => {
    rdfFetch(proxyUrl, { headers: { 'Accept': 'text/n3' } }).then((res) => {
      expect(res.status).to.be.equal(400)
      return streamToString(res.body)
    }).then((data) => {
      expect(data).to.be.equal('\'uri\' query parameter missing. ' +
        'Use ?uri=http://requested.example.com/file.rdf')
      done()
    }).catch(done)
  })
  it('convert json+ld to n3 through a proxy', (done) => {
    proxyRequest('http://xmlns.com/foaf/spec/index.jsonld', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(200)
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(620)
      done()
    }).catch(done)
  })
  it('convert to unsupported/type should pass data through?', (done) => {
    proxyRequest('http://xmlns.com/foaf/spec/index.jsonld', 'unsupported/type').then((res) => {
      expect(res.status).to.be.equal(200)
      expect(res.headers.get('content-type')).to.be.equal('application/ld+json; charset=utf-8')
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(620)
      done()
    }).catch(done)
  })
  it('pass non-rdf page data through?', (done) => {
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
    proxyRequest('http://xmlns.com/foaf/spec/404page.ttl', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(404)
      expect(res.headers.get('content-type')).to.be.equal('text/html; charset=utf-8')
      done()
    }).catch(done)
  })
  it('fetching from a not existing server should yield 502?', (done) => {
    proxyRequest('http://example.com/resource.ttl', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(502)
      expect(res.headers.get('content-type')).to.be.equal('application/json; charset=utf-8')
      return res.json()
    }).then((data) => {
      expect(data).to.deep.equal({
        'name': 'FetchError',
        'message': 'request to http://example.com/resource.ttl failed, reason: connect ECONNREFUSED 127.0.0.1:80',
        'type': 'system',
        'errno': 'ECONNREFUSED',
        'code': 'ECONNREFUSED'
      })
      done()
    }).catch(done)
  })
})
