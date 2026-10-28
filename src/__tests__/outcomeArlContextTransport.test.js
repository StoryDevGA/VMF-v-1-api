import { createHash } from 'node:crypto'
import { encodeOutcomeArlContext, decodeOutcomeArlContext } from '../services/outcomeArlContextTransport.js'

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8')
const clone = value => JSON.parse(JSON.stringify(value))
const source = () => {
  const restriction = 'A fictional trial may be considered.\nAccess review remains required.\nExecution is not authorised.'
  const claim = { claimKey: 'claim-one', restriction, evidence: ['An exact source-attributed passage.'] }
  return { candidate: { claims: [claim, clone(claim)], sections: [{ title: 'Evidence', claim: clone(claim) }] },
    truth: [restriction, restriction], unicode: 'Névé — 漢字', number: 3, flag: false, absent: null }
}
const decode = (wire, original) => decodeOutcomeArlContext(wire, { expectedBytes: bytes(original) })

test('losslessly shares repeated structures and strings with deterministic wire and exact Unicode/newline preservation', () => {
  const original = source(), before = JSON.stringify(original), wire = encodeOutcomeArlContext(original)
  expect(wire.values.length).toBeGreaterThan(0)
  expect(encodeOutcomeArlContext(original)).toEqual(wire)
  expect(JSON.stringify(decode(wire, original))).toBe(before)
  expect(wire.contextHash).toBe(createHash('sha256').update(before).digest('hex'))
  expect(JSON.stringify(original)).toBe(before)
  expect(Object.isFrozen(decode(wire, original).candidate)).toBe(true)
})

test.each([
  ['changed hash', wire => { wire.contextHash = 'a'.repeat(64) }],
  ['extra envelope field', wire => { wire.extra = true }],
  ['wrong version', wire => { wire.transportVersion = 'unknown' }],
  ['negative reference', wire => { wire.context = { $ref: -1 } }],
  ['out of range reference', wire => { wire.context = { $ref: wire.values.length } }],
  ['noninteger reference', wire => { wire.context = { $ref: 0.5 } }],
  ['extra reference key', wire => { wire.context = { $ref: 0, extra: true } }],
  ['cycle/forward reference', wire => { wire.values[0] = { $ref: 0 } }],
  ['unused entry', wire => { wire.values.push('unused dictionary entry') }],
  ['changed dictionary content', wire => { wire.values[0] = 'different text' }],
])('rejects %s rather than altering the restored context', (_label, mutate) => {
  const original = source(), wire = clone(encodeOutcomeArlContext(original)); mutate(wire)
  expect(() => decode(wire, original)).toThrow()
})

test('bounds expanded bytes before serializing a compact exponential reference graph', () => {
  const values = ['a'.repeat(20)]
  for (let index = 0; index < 50; index += 1) values.push([{ $ref: index }, { $ref: index }])
  const wire = { transportVersion: 'arl-context-values.v1', contextHash: 'a'.repeat(64), values, context: { $ref: 50 } }
  expect(() => decodeOutcomeArlContext(wire, { expectedBytes: 1000 })).toThrow()
})

test('rejects authored reserved keys, nonplain prototypes and unbounded decoding', () => {
  expect(() => encodeOutcomeArlContext({ nested: { $ref: 'authored content' } })).toThrow()
  expect(() => encodeOutcomeArlContext(Object.create({ inherited: true }))).toThrow()
  const original = source(), wire = encodeOutcomeArlContext(original)
  expect(() => decodeOutcomeArlContext(wire)).toThrow()
  expect(() => decodeOutcomeArlContext(wire, { expectedBytes: 1 })).toThrow()
})

test('shares known long text inside paragraphs without changing quotes, Unicode or line breaks', () => {
  const phrase = 'An attributed Névé source statement with explicit limits.\n'.repeat(3)
  const original = { phrase, paragraph: `Read only: ${phrase} Keep these limits: ${phrase}` }
  const wire = encodeOutcomeArlContext(original)
  expect(wire.transportVersion).toBe('arl-context-values.v3')
  expect(JSON.stringify(wire)).toContain('$t')
  expect(JSON.stringify(decode(wire, original))).toBe(JSON.stringify(original))
  expect(encodeOutcomeArlContext(original)).toEqual(wire)
})

test('keeps v1 decoding compatible and rejects v2 text forms in v1', () => {
  const original = { text: 'legacy' }, contextHash = createHash('sha256').update(JSON.stringify(original)).digest('hex')
  expect(decode({ transportVersion: 'arl-context-values.v1', contextHash, values: [], context: original }, original)).toEqual(original)
  expect(() => decode({ transportVersion: 'arl-context-values.v1', contextHash, values: [], context: { text: { $text: ['leg', 'acy'] } } }, original)).toThrow()
})

test.each([
  { $text: ['x', {}] }, { $text: ['x', 1] }, { $text: ['x'] }, { $text: ['x', 'y'], extra: true },
  { $text: [{ $ref: 0 }, 'x'] },
])('rejects malformed/nonstring text references %j', text => {
  const wire = { transportVersion: 'arl-context-values.v2', contextHash: 'a'.repeat(64), values: [{ not: 'a string' }], context: text }
  expect(() => decodeOutcomeArlContext(wire, { expectedBytes: 1000 })).toThrow()
})

test('bounds exponential text expansion before allocating the final string', () => {
  const values = ['x'.repeat(80)]
  for (let index = 0; index < 40; index++) values.push({ $text: [{ $ref: index }, { $ref: index }] })
  expect(() => decodeOutcomeArlContext({ transportVersion: 'arl-context-values.v2', contextHash: 'a'.repeat(64), values, context: { $ref: 40 } }, { expectedBytes: 1000 })).toThrow()
  expect(() => encodeOutcomeArlContext({ nested: { $text: ['authored', 'content'] } })).toThrow()
})

// Compact markers never permit cross-version aliases or authored control keys.
test.each(['$r', '$t'])('rejects authored compact marker %s', key => {
  expect(() => encodeOutcomeArlContext({ nested: { [key]: 0 } })).toThrow()
})
test('retains exact property ordering across semantically equivalent duplicate objects', () => {
  const original = { first: { qualification: 'Preserve this exact restriction and source attribution.', value: 'Névé' }, second: { value: 'Névé', qualification: 'Preserve this exact restriction and source attribution.' } }
  expect(JSON.stringify(decode(encodeOutcomeArlContext(original), original))).toBe(JSON.stringify(original))
})
test('decodes historical v2 reference and text dictionary without accepting v3 markers', () => {
  const original = { text: 'legacy reference and text' }, contextHash = createHash('sha256').update(JSON.stringify(original)).digest('hex')
  const wire = { transportVersion: 'arl-context-values.v2', contextHash, values: ['legacy reference'], context: { text: { $text: [{ $ref: 0 }, ' and text'] } } }
  expect(decode(wire, original)).toEqual(original)
  wire.context.text = { $t: [{ $r: 0 }, ' and text'] }
  expect(() => decode(wire, original)).toThrow()
})
test.each([{ $r: -1 }, { $r: 0.5 }, { $r: 0, extra: true }, { $t: ['x'] }, { $t: ['x', {}] }, { $ref: 0 }])('rejects malformed v3 form %j', context => {
  expect(() => decodeOutcomeArlContext({ transportVersion: 'arl-context-values.v3', contextHash: 'a'.repeat(64), values: [], context }, { expectedBytes: 1000 })).toThrow()
})
