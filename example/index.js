'use strict'

const express = require('express')
const formatsProxy = require('..') // require('http-rdf-formats-proxy')

const app = express()
app.get('/proxy', formatsProxy({
	fetch: require('rdf-fetch-lite'),
    formats: require('rdf-formats-common')()
}))
app.server = app.listen(8000)

/**
 * Then do a HTTP request:
 * curl -H 'Accept: text/n3' 'http://localhost:8000/proxy?uri=<uri>'
 */
