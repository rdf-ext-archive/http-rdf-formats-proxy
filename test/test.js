/* global describe, it, before, after */
'use strict'

const debug = require('debug')('test')
const expect = require('chai').expect
const http = require('http')
const express = require('express')
const nock = require('nock')
const streamToString = require('stream-to-string')
const rdfFetch = require('rdf-fetch')
const formats = require('rdf-formats-common')()
const bodyParser = require('rdf-body-parser')

const formatsProxy = require('..')
const OldApiParserWrapper = formatsProxy.OldApiParserWrapper
formats.parsers['application/rdf+xml'] = new OldApiParserWrapper({ parser: require('rdf-parser-rdfxml') })

const nocksFile = './test/nock-rec.json'
const nockActive = true
const nockRecord = false

const proxyUrlHost = 'http://localhost'
const proxyPort = 8000
const proxyServer = proxyUrlHost + ':' + proxyPort
const proxyUrl = proxyServer + '/proxy'

const serverPort = 8001
const server = http.createServer((req, res) => {
  debug(req.headers)
  bodyParser.attach(req, res).then(() => {
    debug('forward request')
    res.writeHead(200, { 'Content-type': 'application/n-triples' })
    res.end(req.graph.toString())
  })
})
const app = express()
app.use('/proxy', formatsProxy({ formats: formats }))

function proxyRequest (uri, accept, options) {
  options = options || {}
  options.method = options.method || 'GET'
  options.headers = options.headers || {}
  options.headers['accept'] = accept
  if (!uri) {
    return rdfFetch(proxyUrl, options)
  }
  return rdfFetch(proxyUrl + '?uri=' + uri, options)
}

describe('http-rdf-formats-proxy', () => {
  before(() => {
    server.listen(serverPort)
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
    server.close()
    app.server.close()
    if (nockRecord) {
      require('fs').writeFileSync(nocksFile, JSON.stringify(
        nock.recorder.play().filter((nock) => {
          return (nock.scope !== proxyServer && nock.scope !== 'http://localhost:' + serverPort)
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
    proxyRequest('http://notexistingserver/resource.ttl', 'text/n3').then((res) => {
      expect(res.status).to.be.equal(502)
      expect(res.headers.get('content-type')).to.be.equal('application/json; charset=utf-8')
      return res.json()
    }).then((data) => {
      expect(data.name).to.equal('FetchError')
      done()
    }).catch(done)
  })
  it('forward convert json+ld to n3 and response convert n-triples to n3', (done) => {
    const body = `{
  "@context": "http://schema.org",
  "@type": "Blog",
  "name": "Blog name",
  "url": "https://example.com",
  "description": "Same as meta description",
  "sameAs": [
    "https://facebook.com/BlogPage",
    "https://plus.google/BlogPage"
  ],
  "publisher": {
    "@type": "Organization",
    "name": "Blog Name"
  }
}
`
    proxyRequest('http://localhost:' + serverPort + '/&produce=text/n3', 'text/n3', {
      method: 'POST',
      headers: {
        'content-type': 'application/ld+json'
      },
      body: body
    }).then((res) => {
      expect(res.status).to.be.equal(200)
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(9)
      done()
    }).catch(done)
  })

  it('convert mode - json+ld to n-triples', (done) => {
    const body = `{
  "@context": "http://schema.org",
  "@type": "Blog",
  "name": "Blog name",
  "url": "https://example.com",
  "description": "Same as meta description",
  "sameAs": [
    "https://facebook.com/BlogPage",
    "https://plus.google/BlogPage"
  ],
  "publisher": {
    "@type": "Organization",
    "name": "Blog Name"
  }
}
`
    proxyRequest(null, 'application/n-triples', {
      method: 'POST',
      headers: {
        'content-type': 'application/ld+json'
      },
      body: body
    }).then((res) => {
      expect(res.status).to.be.equal(200)
      return res.dataset()
    }).then((data) => {
      expect(data.length).to.be.equal(9)
      done()
    }).catch(done)
  })
})
