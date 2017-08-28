const Sink = require('rdf-sink')

const debug = require('debug')('rdf-parser-oldapi-wrapper')
const rdf = require('rdf-ext')
const Readable = require('readable-stream')
const streamToString = require('stream-to-string')

class ParserStream extends Readable {
  constructor (input, options) {
    super({
      objectMode: true,
      read: () => {}
    })

    options = options || {}
    this.baseIRI = options.baseIRI || ''
    this.factory = options.factory || rdf
    this.parser = options.parser // required option

    const onError = (err) => { this.emit('error', err) }

    if (!this.parser) {
      onError(new Error('oldapi parser option missing'))
    }

    input.on('error', onError)

    const translate = (triple) => {
      this.push(this.factory.quad(
        this.term(triple.subject),
        this.term(triple.predicate),
        this.term(triple.object)
      ))
    }

    streamToString(input).then((inputString) => {
      debug('Input stream loaded... length: ' + inputString.length)
      this.parser.process(inputString, translate, this.baseIRI)
      .then(() => { this.push(null) })
      .catch(onError)
    }).catch(onError)
  }

  term (term) {
    if (term.interfaceName === 'NamedNode') {
      return this.factory.namedNode(term.nominalValue)
    }
    if (term.interfaceName === 'Literal') {
      return this.factory.literal(term.nominalValue,
        term.language || term.datatype.nominalValue)
    }
    if (term.interfaceName === 'BlankNode') {
      return this.factory.blankNode(term.nominalValue)
    }
  }
}

class Parser extends Sink {
  constructor (options) {
    super(ParserStream, options)
  }

  static import (input, options) {
    return new ParserStream(input, options)
  }
}

module.exports = Parser
module.exports.ParserStream = ParserStream
