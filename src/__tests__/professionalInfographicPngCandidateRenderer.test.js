import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { deflateSync } from 'node:zlib'
import { describe, expect, jest, test } from '@jest/globals'
import {
  PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES,
  PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_PROFILE,
  __testables,
  renderProfessionalInfographicPngCandidate,
  validateProfessionalInfographicPngCandidate,
} from '../services/professionalInfographicPngCandidateRenderer.js'
import {
  OUTCOME_RENDERER_ENGINEERING_CANDIDATES,
  listOutcomeRendererCapabilities,
  resolveOutcomeRendererCapability,
} from '../services/outcomeRendererCapabilityRegistryService.js'
import { professionalInfographicSvgCandidateFixture } from '../testFixtures/professionalInfographicSvgCandidateFixture.js'

jest.setTimeout(120_000)

const {
  ENGINE_INVALID,
  INPUT_INVALID,
  LIMIT_EXCEEDED,
  RENDER_FAILED,
  VALIDATION_FAILED,
} = PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES

const EXPECTED_MESSAGE = 'The professional infographic PNG engineering candidate could not complete this render.'
const EXPECTED_ENGINE = {
  key: 'NAPI_RS_CANVAS_SVG_RASTER_ENGINEERING_CANDIDATE',
  version: '@napi-rs/canvas@1.0.0',
  canvasPackageIntegrity: 'sha512-Jqxcy1XOIqj+lH9sl1GT+il6GR3uQv13vI2mrwubP3uT8Olak2ClDrK2RnxlQKjwv8BRr4b3ug0YR7c6hBX8wg==',
  platform: 'win32',
  architecture: 'x64',
  nativePackage: '@napi-rs/canvas-win32-x64-msvc',
  nativePackageVersion: '1.0.0',
  nativePackageIntegrity: 'sha512-qwdhh9N6Gge/hC4pL9S1tQp0iKwhSl/dYjg7+RGp9k26iRGRi5MqqUyKGOXIWli0zOcuy5Y2wIH/jk2ry6i/jA==',
  nativeBinaryName: 'skia.win32-x64-msvc.node',
  nativeBinaryBytes: 27_246_592,
  nativeBinarySha256: 'f65bfb4c598dec157414a1435f74a71fbaba8f3406b0446f20f2df8a4fe618e4',
  buildFingerprint: 'professional-infographic-png-candidate:napi-rs-canvas-win32-x64-msvc:1.0.0:0.1.0',
}
const EXPECTED_LIMITS = {
  maxOutputBytes: 8_388_608,
  maxCompressedBytes: 8_388_000,
  maxDecompressedBytes: 18_333_746,
  width: 1800,
  height: 2546,
}
const EXPECTED_PROFILE = {
  profileKey: 'outcome-professional-infographic-png-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'governed-deliverable.v1',
  referenceCandidate: 'COR-007-v1.1-NOT-APPROVED',
  templateProfile: 'executive-decision-infographic-neutral.v0.1',
  engine: EXPECTED_ENGINE,
  limits: EXPECTED_LIMITS,
}

const cloneFixture = () => JSON.parse(JSON.stringify(professionalInfographicSvgCandidateFixture))
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

const assertExactFailure = (error, code, reason) => {
  expect(error).toBeInstanceOf(Error)
  expect(error.name).toBe('ProfessionalInfographicPngCandidateError')
  expect(error.message).toBe(EXPECTED_MESSAGE)
  expect(error.code).toBe(code)
  expect(error.reason).toBe(reason)
  expect(error.details).toEqual({ reason, contentIncludedInError: false })
  expect(Object.keys(error).sort()).toEqual(['code', 'details', 'name', 'reason'])
  expect(Object.keys(error.details)).toEqual(['reason', 'contentIncludedInError'])
  expect(Object.isFrozen(error.details)).toBe(true)
  expect(JSON.stringify(error)).not.toContain('customer-secret-marker')
}

const expectExactFailure = (action, code, reason) => {
  let failure
  try {
    action()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeDefined()
  assertExactFailure(failure, code, reason)
}

const expectExactAsyncFailure = async (action, code, reason) => {
  let failure
  try {
    await action()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeDefined()
  assertExactFailure(failure, code, reason)
}

const makeChunk = (type, data = Buffer.alloc(0)) => {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  crc.writeUInt32BE(__testables.crc32(Buffer.concat([typeBuffer, data])))
  return Buffer.concat([length, typeBuffer, data, crc])
}

const makeIhdrData = () => {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(__testables.WIDTH, 0)
  data.writeUInt32BE(__testables.HEIGHT, 4)
  data[8] = 8
  data[9] = 6
  return data
}

const makePng = (chunks) => Buffer.concat([
  __testables.PNG_SIGNATURE,
  ...chunks.map(([type, data]) => makeChunk(type, data)),
])

const categoryColours = {
  white: [
    [255, 255, 255], [247, 255, 255], [255, 247, 255], [255, 255, 247],
    [247, 247, 255], [247, 255, 247], [255, 247, 247], [247, 247, 247],
  ],
  dark: [[16, 16, 16], [48, 48, 48], [80, 80, 80]],
  coloured: [[200, 24, 24], [24, 200, 24], [24, 24, 200], [180, 80, 20], [20, 160, 180]],
  neutral: [[120, 120, 120], [144, 144, 144], [176, 176, 176], [208, 208, 208], [240, 240, 240]],
}

const makePixels = ({
  white,
  dark,
  coloured,
  neutral,
  limitedBuckets = false,
}) => {
  const cycle = []
  const add = (category, count) => {
    const colours = limitedBuckets ? [categoryColours[category][0]] : categoryColours[category]
    for (let index = 0; index < count; index += 1) cycle.push(colours[index % colours.length])
  }
  add('white', white)
  add('dark', dark)
  add('coloured', coloured)
  add('neutral', neutral)
  const pixels = Buffer.allocUnsafe(__testables.PIXEL_COUNT * 4)
  for (let pixel = 0; pixel < __testables.PIXEL_COUNT; pixel += 1) {
    const colour = cycle[pixel % cycle.length]
    const offset = pixel * 4
    pixels[offset] = colour[0]
    pixels[offset + 1] = colour[1]
    pixels[offset + 2] = colour[2]
    pixels[offset + 3] = 255
  }
  return pixels
}

const predictorFor = (filter, left, up, upperLeft) => {
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return Math.floor((left + up) / 2)
  if (filter === 4) return __testables.paeth(left, up, upperLeft)
  return 0
}

const encodePixels = (pixels, filterForRow = () => 0) => {
  const rowBytes = __testables.WIDTH * 4
  const inflated = Buffer.allocUnsafe(__testables.MAX_DECOMPRESSED_BYTES)
  for (let row = 0; row < __testables.HEIGHT; row += 1) {
    const filter = filterForRow(row)
    const sourceOffset = row * rowBytes
    const targetOffset = row * (rowBytes + 1)
    inflated[targetOffset] = filter
    for (let column = 0; column < rowBytes; column += 1) {
      const value = pixels[sourceOffset + column]
      const left = column >= 4 ? pixels[sourceOffset + column - 4] : 0
      const up = row > 0 ? pixels[sourceOffset - rowBytes + column] : 0
      const upperLeft = row > 0 && column >= 4 ? pixels[sourceOffset - rowBytes + column - 4] : 0
      inflated[targetOffset + 1 + column] = (value - predictorFor(filter, left, up, upperLeft)) & 0xff
    }
  }
  return inflated
}

const VALID_PIXELS = makePixels({ white: 10, dark: 2, coloured: 3, neutral: 5 })
const VALID_INFLATED = encodePixels(VALID_PIXELS)
const VALID_COMPRESSED = deflateSync(VALID_INFLATED, { level: 9 })

const makePngFromIdats = (idats, overrides = {}) => makePng([
  ['IHDR', overrides.ihdr ?? makeIhdrData()],
  ['sBIT', overrides.sbit ?? Buffer.from([8, 8, 8, 8])],
  ['sRGB', overrides.srgb ?? Buffer.from([0])],
  ...idats.map((data) => ['IDAT', data]),
  ['IEND', overrides.iend ?? Buffer.alloc(0)],
])

const VALID_PNG = makePngFromIdats([VALID_COMPRESSED])
const SOURCE_SVG_RESULT = Object.freeze({ buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') })

const makeCanvasApi = ({
  output = VALID_PNG,
  loadImage = async () => ({}),
  toBuffer = () => Buffer.from(output),
} = {}) => ({
  loadImage,
  createCanvas: () => ({
    getContext: () => ({
      fillStyle: '',
      fillRect: jest.fn(),
      drawImage: jest.fn(),
    }),
    toBuffer,
  }),
})

const renderDependencies = (overrides = {}) => ({
  renderSvg: () => SOURCE_SVG_RESULT,
  validateSvg: () => ({ status: 'PASSED' }),
  verifyIdentity: async () => EXPECTED_ENGINE,
  importCanvas: async () => makeCanvasApi(),
  validatePng: () => ({ status: 'PASSED' }),
  ...overrides,
})

const identityPaths = {
  canvasPackage: 'C:\\fixture\\node_modules\\@napi-rs\\canvas\\package.json',
  nativePackage: 'C:\\fixture\\node_modules\\@napi-rs\\canvas-win32-x64-msvc\\package.json',
  nativeBinary: 'C:\\fixture\\node_modules\\@napi-rs\\canvas-win32-x64-msvc\\skia.win32-x64-msvc.node',
  packageLock: 'C:\\fixture\\package-lock.json',
}

const makeIdentityState = () => ({
  canvasPackage: { name: '@napi-rs/canvas', version: '1.0.0' },
  nativePackage: { name: '@napi-rs/canvas-win32-x64-msvc', version: '1.0.0' },
  packageLock: {
    packages: {
      'node_modules/@napi-rs/canvas': {
        version: '1.0.0',
        integrity: EXPECTED_ENGINE.canvasPackageIntegrity,
      },
      'node_modules/@napi-rs/canvas-win32-x64-msvc': {
        version: '1.0.0',
        integrity: EXPECTED_ENGINE.nativePackageIntegrity,
      },
    },
  },
  nativeBinaryBytes: EXPECTED_ENGINE.nativeBinaryBytes,
  streamedBytes: EXPECTED_ENGINE.nativeBinaryBytes,
  streamedSha256: EXPECTED_ENGINE.nativeBinarySha256,
  hashCallCount: 0,
  platform: 'win32',
  architecture: 'x64',
})

const makeIdentityDependencies = (state) => ({
  resolve: (specifier) => ({
    '@napi-rs/canvas/package.json': identityPaths.canvasPackage,
    '@napi-rs/canvas-win32-x64-msvc/package.json': identityPaths.nativePackage,
    '@napi-rs/canvas-win32-x64-msvc': identityPaths.nativeBinary,
  })[specifier],
  platform: state.platform,
  architecture: state.architecture,
  packageLockPath: identityPaths.packageLock,
  readJsonFile: async (filePath) => {
    const normalized = String(filePath)
    if (normalized === identityPaths.canvasPackage) return state.canvasPackage
    if (normalized === identityPaths.nativePackage) return state.nativePackage
    if (normalized === identityPaths.packageLock) return state.packageLock
    throw new Error('unexpected identity JSON path')
  },
  statFile: async (filePath) => ({
    size: String(filePath) === identityPaths.nativeBinary ? state.nativeBinaryBytes : 1,
  }),
  hashBinary: async () => {
    state.hashCallCount += 1
    return {
      bytes: state.streamedBytes,
      sha256: state.streamedSha256,
    }
  },
})

const expectIdentityFailureBeforeImport = async (mutate) => {
  const state = makeIdentityState()
  mutate(state)
  const importCanvas = jest.fn()
  await expectExactAsyncFailure(
    () => __testables.renderWithDependencies(
      professionalInfographicSvgCandidateFixture,
      renderDependencies({
        verifyIdentity: () => __testables.verifyEngineIdentity(makeIdentityDependencies(state)),
        importCanvas,
      }),
    ),
    ENGINE_INVALID,
    'PNG_ENGINE_IDENTITY_MISMATCH',
  )
  expect(importCanvas).not.toHaveBeenCalled()
  return state
}

describe('Professional infographic PNG engineering candidate', () => {
  test('rejects zero renderer arguments', async () => {
    await expectExactAsyncFailure(
      () => renderProfessionalInfographicPngCandidate(),
      INPUT_INVALID,
      'CANDIDATE_ARGUMENTS_INVALID',
    )
  })

  test('rejects a second renderer argument', async () => {
    await expectExactAsyncFailure(
      () => renderProfessionalInfographicPngCandidate(professionalInfographicSvgCandidateFixture, {}),
      INPUT_INVALID,
      'CANDIDATE_ARGUMENTS_INVALID',
    )
  })

  test('rejects malformed source input', async () => {
    await expectExactAsyncFailure(
      () => renderProfessionalInfographicPngCandidate(null),
      INPUT_INVALID,
      'SOURCE_INFOGRAPHIC_INVALID',
    )
  })

  test('rejects unsupported source fields', async () => {
    const fixture = cloneFixture()
    fixture['customer-secret-marker'] = 'customer-secret-marker'
    await expectExactAsyncFailure(
      () => renderProfessionalInfographicPngCandidate(fixture),
      INPUT_INVALID,
      'SOURCE_INFOGRAPHIC_INVALID',
    )
  })

  test('translates source svg compilation failure', async () => {
    const verifyIdentity = jest.fn()
    await expectExactAsyncFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({
          renderSvg: () => { throw new Error('customer-secret-marker') },
          verifyIdentity,
        }),
      ),
      INPUT_INVALID,
      'SOURCE_INFOGRAPHIC_INVALID',
    )
    expect(verifyIdentity).not.toHaveBeenCalled()
  })

  test('translates source svg validation failure', async () => {
    const verifyIdentity = jest.fn()
    await expectExactAsyncFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({
          validateSvg: () => { throw new Error('customer-secret-marker') },
          verifyIdentity,
        }),
      ),
      INPUT_INVALID,
      'SOURCE_INFOGRAPHIC_INVALID',
    )
    expect(verifyIdentity).not.toHaveBeenCalled()
  })

  test('rejects zero validator arguments', () => {
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(),
      INPUT_INVALID,
      'CANDIDATE_ARGUMENTS_INVALID',
    )
  })

  test('rejects a second validator argument', () => {
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(Buffer.alloc(0), {}),
      INPUT_INVALID,
      'CANDIDATE_ARGUMENTS_INVALID',
    )
  })

  test('rejects a non-buffer validator input', () => {
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(new Uint8Array()),
      INPUT_INVALID,
      'CANDIDATE_ARGUMENTS_INVALID',
    )
  })

  test('rejects canvas package identity drift', async () => {
    const mutations = [
      (state) => { state.canvasPackage.name = '@napi-rs/not-canvas' },
      (state) => { state.canvasPackage.version = '1.0.1' },
      (state) => { state.packageLock.packages['node_modules/@napi-rs/canvas'].version = '1.0.1' },
      (state) => { state.packageLock.packages['node_modules/@napi-rs/canvas'].integrity = 'sha512-drift' },
    ]
    for (const mutate of mutations) await expectIdentityFailureBeforeImport(mutate)
  })

  test('rejects platform or architecture drift', async () => {
    await expectIdentityFailureBeforeImport((state) => { state.platform = 'linux' })
    await expectIdentityFailureBeforeImport((state) => { state.architecture = 'arm64' })
  })

  test('rejects native package identity drift', async () => {
    const mutations = [
      (state) => { state.nativePackage.name = '@napi-rs/not-canvas-native' },
      (state) => { state.nativePackage.version = '1.0.1' },
      (state) => { state.packageLock.packages['node_modules/@napi-rs/canvas-win32-x64-msvc'].version = '1.0.1' },
      (state) => { state.packageLock.packages['node_modules/@napi-rs/canvas-win32-x64-msvc'].integrity = 'sha512-drift' },
    ]
    for (const mutate of mutations) await expectIdentityFailureBeforeImport(mutate)
  })

  test('rejects native binary size drift', async () => {
    const state = await expectIdentityFailureBeforeImport((value) => { value.nativeBinaryBytes -= 1 })
    expect(state.hashCallCount).toBe(0)
    const packageState = await expectIdentityFailureBeforeImport((value) => { value.canvasPackage.version = '1.0.1' })
    expect(packageState.hashCallCount).toBe(0)
    let streamOptions
    const successful = await __testables.hashNativeBinary('ignored', {
      expectedBytes: 4,
      createStream: (_filePath, options) => {
        streamOptions = options
        return Readable.from([Buffer.from('12'), Buffer.from('34')])
      },
    })
    expect(streamOptions).toEqual({ highWaterMark: 1_048_576 })
    expect(successful).toEqual({
      bytes: 4,
      sha256: sha256(Buffer.from('1234')),
    })
    const overrunStream = Readable.from([Buffer.from('1234')])
    const destroy = jest.spyOn(overrunStream, 'destroy')
    await expect(__testables.hashNativeBinary('ignored', {
      expectedBytes: 3,
      createStream: () => overrunStream,
    })).rejects.toThrow('identity')
    expect(destroy).toHaveBeenCalled()
    await expect(__testables.hashNativeBinary('ignored', {
      expectedBytes: 4,
      createStream: () => Readable.from([Buffer.from('123')]),
    })).rejects.toThrow('identity')
    await expectIdentityFailureBeforeImport((value) => { value.streamedBytes -= 1 })
    await expectIdentityFailureBeforeImport((value) => { value.streamedBytes += 1 })
  })

  test('rejects native binary hash drift', async () => {
    const state = await expectIdentityFailureBeforeImport((value) => { value.streamedSha256 = sha256(Buffer.from('wrong-native-binary')) })
    expect(state.hashCallCount).toBe(1)
    const streamOpenFailure = () => { throw new Error('open failed') }
    await expect(__testables.hashNativeBinary('ignored', {
      createStream: streamOpenFailure,
    })).rejects.toThrow('open failed')
    const readFailureStream = new Readable({
      read() {
        this.destroy(new Error('read failed'))
      },
    })
    await expect(__testables.hashNativeBinary('ignored', {
      createStream: () => readFailureStream,
    })).rejects.toThrow('identity')
    for (const hashBinary of [
      async () => { throw new Error('open failed') },
      async () => { throw new Error('read failed') },
    ]) {
      const importCanvas = jest.fn()
      const identityState = makeIdentityState()
      await expectExactAsyncFailure(
        () => __testables.renderWithDependencies(
          professionalInfographicSvgCandidateFixture,
          renderDependencies({
            verifyIdentity: () => __testables.verifyEngineIdentity({
              ...makeIdentityDependencies(identityState),
              hashBinary,
            }),
            importCanvas,
          }),
        ),
        ENGINE_INVALID,
        'PNG_ENGINE_IDENTITY_MISMATCH',
      )
      expect(importCanvas).not.toHaveBeenCalled()
    }
  })

  test('translates native svg decode failure', async () => {
    const validatePng = jest.fn()
    await expectExactAsyncFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({
          importCanvas: async () => makeCanvasApi({
            loadImage: async () => { throw new Error('customer-secret-marker') },
          }),
          validatePng,
        }),
      ),
      RENDER_FAILED,
      'PNG_RENDER_FAILED',
    )
    expect(validatePng).not.toHaveBeenCalled()
  })

  test('translates native png encode failure', async () => {
    const validatePng = jest.fn()
    await expectExactAsyncFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({
          importCanvas: async () => makeCanvasApi({
            toBuffer: () => { throw new Error('customer-secret-marker') },
          }),
          validatePng,
        }),
      ),
      RENDER_FAILED,
      'PNG_RENDER_FAILED',
    )
    expect(validatePng).not.toHaveBeenCalled()
  })

  test('rejects png output over the byte limit', async () => {
    const validatePng = jest.fn()
    await expectExactAsyncFailure(
      () => __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        renderDependencies({
          importCanvas: async () => makeCanvasApi({
            output: Buffer.alloc(__testables.MAX_OUTPUT_BYTES + 1),
          }),
          validatePng,
        }),
      ),
      LIMIT_EXCEEDED,
      'PNG_OUTPUT_LIMIT_EXCEEDED',
    )
    expect(validatePng).not.toHaveBeenCalled()
  })

  test('rejects an invalid png signature', () => {
    const mutated = Buffer.from(VALID_PNG)
    mutated[0] ^= 0xff
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_SIGNATURE_INVALID',
    )
  })

  test('rejects a missing ihdr chunk', () => {
    const mutated = makePng([
      ['sBIT', Buffer.from([8, 8, 8, 8])],
      ['sRGB', Buffer.from([0])],
      ['IDAT', VALID_COMPRESSED],
      ['IEND', Buffer.alloc(0)],
    ])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_IHDR_INVALID',
    )
  })

  test('rejects a duplicate ihdr chunk', () => {
    const ihdr = makeIhdrData()
    const mutated = makePng([
      ['IHDR', ihdr],
      ['IHDR', ihdr],
      ['sBIT', Buffer.from([8, 8, 8, 8])],
      ['sRGB', Buffer.from([0])],
      ['IDAT', VALID_COMPRESSED],
      ['IEND', Buffer.alloc(0)],
    ])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_IHDR_INVALID',
    )
  })

  test('rejects a reordered ihdr chunk', () => {
    const mutated = makePng([
      ['sBIT', Buffer.from([8, 8, 8, 8])],
      ['IHDR', makeIhdrData()],
      ['sRGB', Buffer.from([0])],
      ['IDAT', VALID_COMPRESSED],
      ['IEND', Buffer.alloc(0)],
    ])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_IHDR_INVALID',
    )
  })

  test('rejects an invalid ihdr length', () => {
    for (const length of [12, 14]) {
      const mutated = makePng([
        ['IHDR', Buffer.alloc(length)],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sRGB', Buffer.from([0])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ])
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(mutated),
        VALIDATION_FAILED,
        'PNG_IHDR_INVALID',
      )
    }
  })

  test('rejects each mismatched ihdr profile field', () => {
    const mutations = [
      (data) => data.writeUInt32BE(__testables.WIDTH - 1, 0),
      (data) => data.writeUInt32BE(__testables.HEIGHT - 1, 4),
      (data) => { data[8] = 16 },
      (data) => { data[9] = 2 },
      (data) => { data[10] = 1 },
      (data) => { data[11] = 1 },
      (data) => { data[12] = 1 },
    ]
    for (const mutate of mutations) {
      const ihdr = makeIhdrData()
      mutate(ihdr)
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(makePngFromIdats([VALID_COMPRESSED], { ihdr })),
        VALIDATION_FAILED,
        'PNG_IHDR_PROFILE_MISMATCH',
      )
    }
  })

  test('rejects a chunk length crossing the buffer', () => {
    const mutated = Buffer.from(VALID_PNG)
    mutated.writeUInt32BE(0xffff_ffff, __testables.PNG_SIGNATURE.length)
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_CHUNK_TRUNCATED',
    )
  })

  test('rejects an invalid chunk crc', () => {
    const sbit = makeChunk('sBIT', Buffer.from([8, 8, 8, 8]))
    sbit[sbit.length - 1] ^= 0xff
    const mutated = Buffer.concat([
      __testables.PNG_SIGNATURE,
      makeChunk('IHDR', makeIhdrData()),
      sbit,
      makeChunk('sRGB', Buffer.from([0])),
      makeChunk('IDAT', VALID_COMPRESSED),
      makeChunk('IEND'),
    ])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_CHUNK_CRC_INVALID',
    )
  })

  test('rejects each prohibited or unknown chunk with a valid crc', () => {
    for (const type of ['PLTE', 'tEXt', 'iTXt', 'acTL', 'ABCD', 'abcd']) {
      const mutated = makePng([
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sRGB', Buffer.from([0])],
        [type, Buffer.from('customer-secret-marker')],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ])
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(mutated),
        VALIDATION_FAILED,
        'PNG_CHUNK_NOT_ALLOWED',
      )
    }
  })

  test('rejects a missing duplicate reordered or invalid sbit chunk', () => {
    const cases = [
      [
        ['IHDR', makeIhdrData()],
        ['sRGB', Buffer.from([0])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sRGB', Buffer.from([0])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sRGB', Buffer.from([0])],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8])],
        ['sRGB', Buffer.from([0])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 7])],
        ['sRGB', Buffer.from([0])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
    ]
    for (const chunks of cases) {
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(makePng(chunks)),
        VALIDATION_FAILED,
        'PNG_COLOUR_PROFILE_INVALID',
      )
    }
  })

  test('rejects a missing duplicate reordered or invalid srgb chunk', () => {
    const cases = [
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sRGB', Buffer.from([0])],
        ['sRGB', Buffer.from([0])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sRGB', Buffer.from([0])],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sRGB', Buffer.alloc(0)],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
      [
        ['IHDR', makeIhdrData()],
        ['sBIT', Buffer.from([8, 8, 8, 8])],
        ['sRGB', Buffer.from([1])],
        ['IDAT', VALID_COMPRESSED],
        ['IEND', Buffer.alloc(0)],
      ],
    ]
    for (const chunks of cases) {
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(makePng(chunks)),
        VALIDATION_FAILED,
        'PNG_COLOUR_PROFILE_INVALID',
      )
    }
  })

  test('rejects missing empty or noncontiguous idat chunks', () => {
    const missing = makePng([
      ['IHDR', makeIhdrData()],
      ['sBIT', Buffer.from([8, 8, 8, 8])],
      ['sRGB', Buffer.from([0])],
      ['IEND', Buffer.alloc(0)],
    ])
    const empty = makePngFromIdats([Buffer.alloc(0)])
    for (const mutated of [missing, empty]) {
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(mutated),
        VALIDATION_FAILED,
        'PNG_IDAT_INVALID',
      )
    }

    const parsed = __testables.parseChunks(VALID_PNG)
    const noncontiguous = [parsed[0], parsed[1], parsed[2], parsed[3], parsed[4], parsed[3], parsed[4]]
    expectExactFailure(
      () => __testables.validateChunkGrammar(noncontiguous),
      VALIDATION_FAILED,
      'PNG_IDAT_INVALID',
    )
  })

  test('rejects missing duplicate nonzero or nonfinal iend', () => {
    const prefix = [
      ['IHDR', makeIhdrData()],
      ['sBIT', Buffer.from([8, 8, 8, 8])],
      ['sRGB', Buffer.from([0])],
      ['IDAT', VALID_COMPRESSED],
    ]
    const cases = [
      makePng(prefix),
      makePng([...prefix, ['IEND', Buffer.alloc(0)], ['IEND', Buffer.alloc(0)]]),
      makePng([...prefix, ['IEND', Buffer.from([0])]]),
      makePng([...prefix, ['IEND', Buffer.alloc(0)], ['IDAT', VALID_COMPRESSED]]),
    ]
    for (const mutated of cases) {
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(mutated),
        VALIDATION_FAILED,
        'PNG_IEND_INVALID',
      )
    }
  })

  test('rejects trailing bytes after iend', () => {
    const mutated = Buffer.concat([VALID_PNG, Buffer.from('customer-secret-marker')])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      VALIDATION_FAILED,
      'PNG_IEND_INVALID',
    )
  })

  test('rejects aggregate compressed idat overflow', () => {
    const oversizedIdat = Buffer.alloc(__testables.MAX_COMPRESSED_BYTES + 1)
    const mutated = makePngFromIdats([oversizedIdat])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(mutated),
      LIMIT_EXCEEDED,
      'PNG_DECOMPRESSED_LIMIT_EXCEEDED',
    )
  })

  test('rejects bounded inflate overflow', () => {
    const overflow = deflateSync(Buffer.alloc(__testables.MAX_DECOMPRESSED_BYTES + 1))
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(makePngFromIdats([overflow])),
      LIMIT_EXCEEDED,
      'PNG_DECOMPRESSED_LIMIT_EXCEEDED',
    )
  })

  test('rejects malformed or truncated zlib data', () => {
    const cases = [
      Buffer.from([0x78, 0x9c, 0xff, 0xff]),
      VALID_COMPRESSED.subarray(0, VALID_COMPRESSED.length - 1),
    ]
    for (const compressed of cases) {
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(makePngFromIdats([compressed])),
        VALIDATION_FAILED,
        'PNG_DECODE_FAILED',
      )
    }
  })

  test('rejects bytes after a valid zlib stream inside crc-valid idat', () => {
    const compressed = Buffer.concat([VALID_COMPRESSED, Buffer.from([0xde, 0xad, 0xbe, 0xef])])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(makePngFromIdats([compressed])),
      VALIDATION_FAILED,
      'PNG_DECODE_FAILED',
    )
  })

  test('rejects a concatenated second zlib member inside crc-valid idat', () => {
    const compressed = Buffer.concat([VALID_COMPRESSED, deflateSync(Buffer.from('second-member'))])
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(makePngFromIdats([compressed])),
      VALIDATION_FAILED,
      'PNG_DECODE_FAILED',
    )
  })

  test('rejects an invalid decompressed scanline length', () => {
    for (const length of [__testables.MAX_DECOMPRESSED_BYTES - 1, __testables.MAX_DECOMPRESSED_BYTES - 2]) {
      const compressed = deflateSync(Buffer.alloc(length))
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(makePngFromIdats([compressed])),
        VALIDATION_FAILED,
        'PNG_SCANLINE_LENGTH_INVALID',
      )
    }
  })

  test('rejects each scanline filter outside zero through four', () => {
    for (const filter of [5, 255]) {
      const inflated = Buffer.from(VALID_INFLATED)
      inflated[0] = filter
      expectExactFailure(
        () => validateProfessionalInfographicPngCandidate(makePngFromIdats([deflateSync(inflated)])),
        VALIDATION_FAILED,
        'PNG_FILTER_INVALID',
      )
    }
  })

  test('reconstructs filters zero through four with predictor boundary fixtures', () => {
    const rowBytes = __testables.WIDTH * 4
    const pixels = Buffer.alloc(__testables.PIXEL_COUNT * 4)
    const rows = [
      [250, 1, 128, 255, 5, 250, 10, 255, 40, 50, 60, 255],
      [3, 240, 17, 255, 200, 4, 220, 255, 10, 20, 30, 255],
      [250, 250, 250, 255, 5, 5, 5, 255, 100, 120, 140, 255],
      [20, 30, 40, 255, 220, 210, 200, 255, 9, 19, 29, 255],
      [240, 10, 120, 255, 30, 220, 60, 255, 180, 40, 200, 255],
    ]
    rows.forEach((values, row) => Buffer.from(values).copy(pixels, row * rowBytes))
    const filters = [4, 0, 1, 2, 3]
    const encoded = encodePixels(pixels, (row) => filters[row] ?? 0)
    const firstRowOffset = 0
    expect([...encoded.subarray(firstRowOffset + 1, firstRowOffset + 5)]).toEqual(rows[0].slice(0, 4))
    const filterOneOffset = 2 * (rowBytes + 1)
    expect(encoded[filterOneOffset + 1 + 4]).toBe((5 - 250) & 0xff)

    const reconstructed = __testables.unfilterScanlines(encoded)
    rows.forEach((values, row) => {
      expect([...reconstructed.pixels.subarray(row * rowBytes, row * rowBytes + values.length)]).toEqual(values)
    })
    expect(reconstructed.filterHistogram).toEqual({ 0: 2542, 1: 1, 2: 1, 3: 1, 4: 1 })
  })

  test('accepts one and multiple contiguous idat chunks', () => {
    const split = Math.floor(VALID_COMPRESSED.length / 2)
    const one = validateProfessionalInfographicPngCandidate(makePngFromIdats([VALID_COMPRESSED]))
    const multiple = validateProfessionalInfographicPngCandidate(makePngFromIdats([
      VALID_COMPRESSED.subarray(0, split),
      VALID_COMPRESSED.subarray(split),
    ]))
    expect(one).toEqual(expect.objectContaining({ status: 'PASSED', idatCount: 1 }))
    expect(multiple).toEqual(expect.objectContaining({ status: 'PASSED', idatCount: 2 }))
    expect(one.compressedBytes).toBe(multiple.compressedBytes)
    expect(one.decompressedBytes).toBe(multiple.decompressedBytes)
    expect(one.filterHistogram).toEqual(multiple.filterHistogram)
    expect(one.nonWhiteRatio).toBe(multiple.nonWhiteRatio)
    expect(one.darkRatio).toBe(multiple.darkRatio)
    expect(one.colouredRatio).toBe(multiple.colouredRatio)
  })

  test('rejects validator input over the overall png byte limit', () => {
    expectExactFailure(
      () => validateProfessionalInfographicPngCandidate(Buffer.alloc(__testables.MAX_OUTPUT_BYTES + 1)),
      LIMIT_EXCEEDED,
      'PNG_OUTPUT_LIMIT_EXCEEDED',
    )
  })

  test('returns the exact frozen successful validator result', () => {
    const first = validateProfessionalInfographicPngCandidate(VALID_PNG)
    const second = validateProfessionalInfographicPngCandidate(VALID_PNG)
    const expected = {
      status: 'PASSED',
      width: 1800,
      height: 2546,
      outputBytes: VALID_PNG.length,
      chunkCount: 5,
      idatCount: 1,
      compressedBytes: VALID_COMPRESSED.length,
      decompressedBytes: 18_333_746,
      filterHistogram: { 0: 2546, 1: 0, 2: 0, 3: 0, 4: 0 },
      pixelCount: 4_582_800,
      alphaViolationCount: 0,
      nonWhiteRatio: 0.5,
      darkRatio: 0.1,
      colouredRatio: 0.15,
      colourBucketCount: 17,
      contentIncludedInValidation: false,
    }
    expect(first).toEqual(expected)
    expect(second).toEqual(expected)
    expect(second).not.toBe(first)
    expect(second.filterHistogram).not.toBe(first.filterHistogram)
    expect(Object.keys(first)).toEqual(Object.keys(expected))
    expect(Object.keys(first.filterHistogram)).toEqual(['0', '1', '2', '3', '4'])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.filterHistogram)).toBe(true)
  })

  test('rejects any transparent pixel', () => {
    const pixels = Buffer.from(VALID_PIXELS)
    pixels[3] = 254
    expectExactFailure(
      () => __testables.inspectPixels(pixels),
      VALIDATION_FAILED,
      'PNG_TRANSPARENCY_NOT_ALLOWED',
    )
  })

  test('rejects each nonwhite dark coloured and colour-bucket threshold failure', () => {
    const cases = [
      { white: 17, dark: 1, coloured: 1, neutral: 1 },
      { white: 5, dark: 2, coloured: 2, neutral: 11 },
      { white: 10, dark: 0, coloured: 3, neutral: 7 },
      { white: 8, dark: 6, coloured: 2, neutral: 4 },
      { white: 10, dark: 2, coloured: 0, neutral: 8 },
      { white: 8, dark: 2, coloured: 7, neutral: 3 },
      { white: 10, dark: 2, coloured: 3, neutral: 5, limitedBuckets: true },
    ]
    for (const specification of cases) {
      expectExactFailure(
        () => __testables.inspectPixels(makePixels(specification)),
        VALIDATION_FAILED,
        'PNG_PIXEL_INFORMATION_INSUFFICIENT',
      )
    }
    expect(__testables.inspectPixels(makePixels({
      white: 16,
      dark: 2,
      coloured: 2,
      neutral: 0,
    })).nonWhiteRatio).toBe(0.2)
  })

  test('renders three byte-identical fresh immutable envelopes', async () => {
    const dependencies = renderDependencies({
      importCanvas: async () => makeCanvasApi({ output: VALID_PNG }),
    })
    const results = []
    for (let index = 0; index < 3; index += 1) {
      results.push(await __testables.renderWithDependencies(
        professionalInfographicSvgCandidateFixture,
        dependencies,
      ))
    }
    const expectedShape = {
      format: 'PNG',
      mimeType: 'image/png',
      extension: 'png',
      buffer: expect.any(Buffer),
      checksum: sha256(VALID_PNG),
      width: 1800,
      height: 2546,
      profile: EXPECTED_PROFILE,
      sourceSvgChecksum: sha256(SOURCE_SVG_RESULT.buffer),
    }
    results.forEach((result) => {
      expect(result).toEqual(expectedShape)
      expect(Object.keys(result)).toEqual([
        'format', 'mimeType', 'extension', 'buffer', 'checksum',
        'width', 'height', 'profile', 'sourceSvgChecksum',
      ])
      expect(Object.isFrozen(result)).toBe(true)
      expect(result.profile).toBe(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_PROFILE)
      expect(Object.isFrozen(result.profile)).toBe(true)
      expect(Object.isFrozen(result.profile.engine)).toBe(true)
      expect(Object.isFrozen(result.profile.limits)).toBe(true)
    })
    expect(results[0].buffer.equals(results[1].buffer)).toBe(true)
    expect(results[1].buffer.equals(results[2].buffer)).toBe(true)
    expect(results[0].buffer).not.toBe(results[1].buffer)
    expect(results[1].buffer).not.toBe(results[2].buffer)
  })

  test('keeps the png candidate absent from active discovery and resolution', () => {
    const candidate = OUTCOME_RENDERER_ENGINEERING_CANDIDATES.find(
      ({ capabilityKey }) => capabilityKey === EXPECTED_PROFILE.profileKey,
    )
    expect(candidate).toEqual({
      capabilityKey: 'outcome-professional-infographic-png-engineering-candidate',
      capabilityVersion: '0.1.0',
      lifecycleStatus: 'ENGINEERING_CANDIDATE',
      rolloutScopes: [],
      deliverableFamily: 'INFOGRAPHIC',
      sourceModelVersions: ['governed-deliverable.v1'],
      supportedBlockTypes: [
        'INFOGRAPHIC_SECTION',
        'METRIC',
        'PROCESS',
        'OUTCOME_TABLE',
        'ROADMAP',
        'RISK_REGISTER',
        'DECISION_CONDITIONS',
      ],
      engine: EXPECTED_ENGINE,
      profileReferences: {
        templates: ['executive-decision-infographic-neutral.v0.1'],
        styles: ['executive-infographic-neutral.v0.1'],
        brands: [],
        fonts: ['Arial-system-candidate-not-packaged'],
        validation: ['professional-infographic-png-candidate.v0.1'],
        productReferences: ['COR-007-v1.1-NOT-APPROVED'],
      },
      review: {
        security: 'ENGINEERING_REVIEW_ONLY',
        licensing: 'OPEN',
        accessibility: 'RASTER_ALT_TEXT_REQUIRED',
        architecture: 'SPIKE_ONLY_ISOLATED_WORKER_OPEN',
        productReference: 'CANDIDATE_NOT_APPROVED',
      },
      fallbackRule: 'FAIL_CLOSED',
      formats: [{
        format: 'PNG',
        label: 'Infographic PNG engineering candidate',
        mimeType: 'image/png',
        extension: 'png',
      }],
    })
    expect(candidate).not.toHaveProperty('limits')
    expect(Object.keys(candidate.engine)).toEqual(Object.keys(EXPECTED_ENGINE))
    const activeRegistry = listOutcomeRendererCapabilities()
    expect(activeRegistry.capabilities).toHaveLength(1)
    expect(activeRegistry.capabilities).not.toContainEqual(expect.objectContaining({
      capabilityKey: candidate.capabilityKey,
    }))
    expect(resolveOutcomeRendererCapability({
      outputTypeKey: 'infographic',
      outputSchemaKey: 'executive-infographic',
      styleKey: 'executive-style',
      format: 'PNG',
    })).toEqual({
      status: 'UNSUPPORTED',
      reason: 'RENDER_FORMAT_UNSUPPORTED',
      capability: null,
    })
  })
})
