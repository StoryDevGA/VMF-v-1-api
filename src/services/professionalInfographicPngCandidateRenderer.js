import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, lstat, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import {
  renderProfessionalInfographicSvgCandidate,
  validateProfessionalInfographicSvgCandidate,
} from './professionalInfographicSvgCandidateRenderer.js'

const require = createRequire(import.meta.url)

const WIDTH = 1800
const HEIGHT = 2546
const MAX_OUTPUT_BYTES = 8_388_608
const MAX_COMPRESSED_BYTES = 8_388_000
const MAX_DECOMPRESSED_BYTES = 18_333_746
const PIXEL_COUNT = WIDTH * HEIGHT
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const GENERIC_MESSAGE = 'The professional infographic PNG engineering candidate could not complete this render.'

const PNG_CANVAS_PACKAGE_VERSION = '1.0.0'
const PNG_CANVAS_PACKAGE_INTEGRITY = 'sha512-Jqxcy1XOIqj+lH9sl1GT+il6GR3uQv13vI2mrwubP3uT8Olak2ClDrK2RnxlQKjwv8BRr4b3ug0YR7c6hBX8wg=='
const PNG_NATIVE_PACKAGE_NAME = '@napi-rs/canvas-win32-x64-msvc'
const PNG_NATIVE_PACKAGE_VERSION = '1.0.0'
const PNG_NATIVE_PACKAGE_INTEGRITY = 'sha512-qwdhh9N6Gge/hC4pL9S1tQp0iKwhSl/dYjg7+RGp9k26iRGRi5MqqUyKGOXIWli0zOcuy5Y2wIH/jk2ry6i/jA=='
const PNG_NATIVE_BINARY_NAME = 'skia.win32-x64-msvc.node'
const PNG_NATIVE_BINARY_BYTES = 27_246_592
const PNG_NATIVE_BINARY_SHA256 = 'f65bfb4c598dec157414a1435f74a71fbaba8f3406b0446f20f2df8a4fe618e4'
const BUILD_FINGERPRINT = 'professional-infographic-png-candidate:napi-rs-canvas-win32-x64-msvc:1.0.0:0.1.0'

const ENGINE = Object.freeze({
  key: 'NAPI_RS_CANVAS_SVG_RASTER_ENGINEERING_CANDIDATE',
  version: '@napi-rs/canvas@1.0.0',
  canvasPackageIntegrity: PNG_CANVAS_PACKAGE_INTEGRITY,
  platform: 'win32',
  architecture: 'x64',
  nativePackage: PNG_NATIVE_PACKAGE_NAME,
  nativePackageVersion: PNG_NATIVE_PACKAGE_VERSION,
  nativePackageIntegrity: PNG_NATIVE_PACKAGE_INTEGRITY,
  nativeBinaryName: PNG_NATIVE_BINARY_NAME,
  nativeBinaryBytes: PNG_NATIVE_BINARY_BYTES,
  nativeBinarySha256: PNG_NATIVE_BINARY_SHA256,
  buildFingerprint: BUILD_FINGERPRINT,
})

export const PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_PROFILE = Object.freeze({
  profileKey: 'outcome-professional-infographic-png-engineering-candidate',
  profileVersion: '0.1.0',
  lifecycleStatus: 'ENGINEERING_CANDIDATE',
  sourceModelVersion: 'governed-deliverable.v1',
  referenceCandidate: 'COR-007-v1.1-NOT-APPROVED',
  templateProfile: 'executive-decision-infographic-neutral.v0.1',
  engine: ENGINE,
  limits: Object.freeze({
    maxOutputBytes: MAX_OUTPUT_BYTES,
    maxCompressedBytes: MAX_COMPRESSED_BYTES,
    maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
    width: WIDTH,
    height: HEIGHT,
  }),
})

export const PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES = Object.freeze({
  INPUT_INVALID: 'PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_INPUT_INVALID',
  ENGINE_INVALID: 'PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ENGINE_INVALID',
  LIMIT_EXCEEDED: 'PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_LIMIT_EXCEEDED',
  RENDER_FAILED: 'PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_RENDER_FAILED',
  VALIDATION_FAILED: 'PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_VALIDATION_FAILED',
})

const createCandidateError = (code, reason) => {
  const error = new Error(GENERIC_MESSAGE)
  error.name = 'ProfessionalInfographicPngCandidateError'
  error.code = code
  error.reason = reason
  error.details = Object.freeze({ reason, contentIncludedInError: false })
  return error
}

const fail = (code, reason) => {
  throw createCandidateError(code, reason)
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let value = 0; value < 256; value += 1) {
    let crc = value
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    table[value] = crc >>> 0
  }
  return table
})()

const crc32 = (buffer) => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const readJson = async (filePath) => JSON.parse(await readFile(filePath, 'utf8'))

const hashNativeBinary = async (filePath, {
  createStream = createReadStream,
  expectedBytes = PNG_NATIVE_BINARY_BYTES,
} = {}) => {
  const hash = createHash('sha256')
  let bytes = 0
  const stream = createStream(filePath, { highWaterMark: 1_048_576 })
  try {
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > expectedBytes) {
        stream.destroy()
        throw new Error('identity')
      }
      hash.update(chunk)
    }
  } catch {
    stream.destroy()
    throw new Error('identity')
  }
  if (bytes !== expectedBytes) throw new Error('identity')
  return Object.freeze({ bytes, sha256: hash.digest('hex') })
}

const assertRegularCanonicalFile = async (filePath) => {
  const normalizedPath = filePath instanceof URL ? fileURLToPath(filePath) : filePath
  const [stat, canonical] = await Promise.all([lstat(normalizedPath), realpath(normalizedPath)])
  if (!stat.isFile() || path.resolve(normalizedPath) !== path.resolve(canonical)) throw new Error('identity')
  return stat
}

const verifyEngineIdentity = async ({
  resolve = require.resolve,
  platform = process.platform,
  architecture = process.arch,
  packageLockPath = new URL('../../package-lock.json', import.meta.url),
  readJsonFile = readJson,
  statFile = assertRegularCanonicalFile,
  hashBinary = hashNativeBinary,
} = {}) => {
  try {
    if (platform !== 'win32' || architecture !== 'x64') throw new Error('identity')
    const canvasPackagePath = resolve('@napi-rs/canvas/package.json')
    const nativePackagePath = resolve(`${PNG_NATIVE_PACKAGE_NAME}/package.json`)
    const nativeBinaryPath = resolve(PNG_NATIVE_PACKAGE_NAME)
    if (path.basename(nativeBinaryPath) !== PNG_NATIVE_BINARY_NAME
      || path.dirname(nativeBinaryPath) !== path.dirname(nativePackagePath)) throw new Error('identity')
    const [canvasPackage, nativePackage, packageLock, nativeStat] = await Promise.all([
      readJsonFile(canvasPackagePath),
      readJsonFile(nativePackagePath),
      readJsonFile(packageLockPath),
      statFile(nativeBinaryPath),
      statFile(canvasPackagePath),
      statFile(nativePackagePath),
      statFile(new URL('../../package-lock.json', import.meta.url)),
    ])
    const canvasLock = packageLock?.packages?.['node_modules/@napi-rs/canvas']
    const nativeLock = packageLock?.packages?.[`node_modules/${PNG_NATIVE_PACKAGE_NAME}`]
    if (canvasPackage?.name !== '@napi-rs/canvas'
      || canvasPackage?.version !== PNG_CANVAS_PACKAGE_VERSION
      || nativePackage?.name !== PNG_NATIVE_PACKAGE_NAME
      || nativePackage?.version !== PNG_NATIVE_PACKAGE_VERSION
      || canvasLock?.version !== PNG_CANVAS_PACKAGE_VERSION
      || canvasLock?.integrity !== PNG_CANVAS_PACKAGE_INTEGRITY
      || nativeLock?.version !== PNG_NATIVE_PACKAGE_VERSION
      || nativeLock?.integrity !== PNG_NATIVE_PACKAGE_INTEGRITY
      || nativeStat.size !== PNG_NATIVE_BINARY_BYTES) throw new Error('identity')
    const binaryIdentity = await hashBinary(nativeBinaryPath)
    if (binaryIdentity?.bytes !== PNG_NATIVE_BINARY_BYTES
      || binaryIdentity?.sha256 !== PNG_NATIVE_BINARY_SHA256) throw new Error('identity')
    return ENGINE
  } catch {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.ENGINE_INVALID, 'PNG_ENGINE_IDENTITY_MISMATCH')
  }
}

const parseChunks = (buffer) => {
  if (buffer.length > MAX_OUTPUT_BYTES) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PNG_OUTPUT_LIMIT_EXCEEDED')
  }
  if (buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_SIGNATURE_INVALID')
  }
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_CHUNK_TRUNCATED')
    }
    const length = buffer.readUInt32BE(offset)
    const end = offset + 12 + length
    if (!Number.isSafeInteger(end) || end > buffer.length) {
      fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_CHUNK_TRUNCATED')
    }
    const typeBuffer = buffer.subarray(offset + 4, offset + 8)
    const type = typeBuffer.toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length)
    if (crc32(Buffer.concat([typeBuffer, data])) !== expectedCrc) {
      fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_CHUNK_CRC_INVALID')
    }
    chunks.push({ type, length, data })
    offset = end
    if (type === 'IEND') break
  }
  if (offset !== buffer.length) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_IEND_INVALID')
  }
  return chunks
}

const validateChunkGrammar = (chunks) => {
  if (chunks[0]?.type !== 'IHDR' || chunks.filter(({ type }) => type === 'IHDR').length !== 1 || chunks[0].length !== 13) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_IHDR_INVALID')
  }
  const ihdr = chunks[0].data
  if (ihdr.readUInt32BE(0) !== WIDTH || ihdr.readUInt32BE(4) !== HEIGHT
    || ihdr[8] !== 8 || ihdr[9] !== 6 || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_IHDR_PROFILE_MISMATCH')
  }
  const sbit = chunks.filter(({ type }) => type === 'sBIT')
  const srgb = chunks.filter(({ type }) => type === 'sRGB')
  if (sbit.length !== 1 || srgb.length !== 1
    || chunks[1]?.type !== 'sBIT' || chunks[2]?.type !== 'sRGB'
    || sbit[0].length !== 4 || !sbit[0].data.equals(Buffer.from([8, 8, 8, 8]))
    || srgb[0].length !== 1 || srgb[0].data[0] !== 0) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_COLOUR_PROFILE_INVALID')
  }
  const allowed = new Set(['IHDR', 'sBIT', 'sRGB', 'IDAT', 'IEND'])
  if (chunks.some(({ type }) => !allowed.has(type))) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_CHUNK_NOT_ALLOWED')
  }
  const idatIndices = chunks.map(({ type }, index) => type === 'IDAT' ? index : -1).filter((index) => index >= 0)
  if (!idatIndices.length
    || idatIndices.some((index) => chunks[index].length === 0)
    || idatIndices.some((index, position) => position > 0 && index !== idatIndices[position - 1] + 1)
    || idatIndices[0] !== 3) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_IDAT_INVALID')
  }
  const iends = chunks.filter(({ type }) => type === 'IEND')
  if (iends.length !== 1 || chunks.at(-1)?.type !== 'IEND' || iends[0].length !== 0) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_IEND_INVALID')
  }
  return idatIndices
}

const paeth = (left, up, upperLeft) => {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

const unfilterScanlines = (inflated) => {
  if (inflated.length !== MAX_DECOMPRESSED_BYTES) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_SCANLINE_LENGTH_INVALID')
  }
  const rowBytes = WIDTH * 4
  const pixels = Buffer.allocUnsafe(PIXEL_COUNT * 4)
  const filterHistogram = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 }
  for (let row = 0; row < HEIGHT; row += 1) {
    const sourceOffset = row * (rowBytes + 1)
    const targetOffset = row * rowBytes
    const filter = inflated[sourceOffset]
    if (filter > 4) {
      fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_FILTER_INVALID')
    }
    filterHistogram[filter] += 1
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = inflated[sourceOffset + 1 + column]
      const left = column >= 4 ? pixels[targetOffset + column - 4] : 0
      const up = row > 0 ? pixels[targetOffset - rowBytes + column] : 0
      const upperLeft = row > 0 && column >= 4 ? pixels[targetOffset - rowBytes + column - 4] : 0
      let predictor = 0
      if (filter === 1) predictor = left
      if (filter === 2) predictor = up
      if (filter === 3) predictor = Math.floor((left + up) / 2)
      if (filter === 4) predictor = paeth(left, up, upperLeft)
      pixels[targetOffset + column] = (raw + predictor) & 0xff
    }
  }
  return { pixels, filterHistogram }
}

const inspectPixels = (pixels) => {
  let alphaViolationCount = 0
  let nonWhiteCount = 0
  let darkCount = 0
  let colouredCount = 0
  const buckets = new Set()
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset]
    const green = pixels[offset + 1]
    const blue = pixels[offset + 2]
    const alpha = pixels[offset + 3]
    if (alpha !== 255) alphaViolationCount += 1
    if (red < 245 || green < 245 || blue < 245) nonWhiteCount += 1
    if (red <= 96 && green <= 96 && blue <= 96) darkCount += 1
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 30) colouredCount += 1
    buckets.add(`${red >> 3}:${green >> 3}:${blue >> 3}`)
  }
  if (alphaViolationCount) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_TRANSPARENCY_NOT_ALLOWED')
  }
  const nonWhiteRatio = nonWhiteCount / PIXEL_COUNT
  const darkRatio = darkCount / PIXEL_COUNT
  const colouredRatio = colouredCount / PIXEL_COUNT
  if (nonWhiteRatio < 0.20 || nonWhiteRatio > 0.65
    || darkRatio < 0.05 || darkRatio > 0.25
    || colouredRatio < 0.05 || colouredRatio > 0.30
    || buckets.size < 8) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_PIXEL_INFORMATION_INSUFFICIENT')
  }
  return {
    alphaViolationCount,
    nonWhiteRatio: Number(nonWhiteRatio.toFixed(4)),
    darkRatio: Number(darkRatio.toFixed(4)),
    colouredRatio: Number(colouredRatio.toFixed(4)),
    colourBucketCount: buckets.size,
  }
}

const validatePngInternal = (buffer) => {
  const chunks = parseChunks(buffer)
  const idatIndices = validateChunkGrammar(chunks)
  const compressed = Buffer.concat(idatIndices.map((index) => chunks[index].data))
  if (compressed.length > MAX_COMPRESSED_BYTES) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PNG_DECOMPRESSED_LIMIT_EXCEEDED')
  }
  let result
  try {
    result = inflateSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES, info: true })
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
      fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PNG_DECOMPRESSED_LIMIT_EXCEEDED')
    }
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_DECODE_FAILED')
  }
  if (!result?.buffer || result.engine?.bytesWritten !== compressed.length) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.VALIDATION_FAILED, 'PNG_DECODE_FAILED')
  }
  const { pixels, filterHistogram } = unfilterScanlines(result.buffer)
  const pixelMetrics = inspectPixels(pixels)
  return Object.freeze({
    status: 'PASSED',
    width: WIDTH,
    height: HEIGHT,
    outputBytes: buffer.length,
    chunkCount: chunks.length,
    idatCount: idatIndices.length,
    compressedBytes: compressed.length,
    decompressedBytes: result.buffer.length,
    filterHistogram: Object.freeze(filterHistogram),
    pixelCount: PIXEL_COUNT,
    ...pixelMetrics,
    contentIncludedInValidation: false,
  })
}

export function validateProfessionalInfographicPngCandidate(buffer) {
  if (arguments.length !== 1 || !Buffer.isBuffer(buffer)) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'CANDIDATE_ARGUMENTS_INVALID')
  }
  return validatePngInternal(buffer)
}

const renderWithDependencies = async (input, {
  verifyIdentity = verifyEngineIdentity,
  importCanvas = () => import('@napi-rs/canvas'),
  renderSvg = renderProfessionalInfographicSvgCandidate,
  validateSvg = validateProfessionalInfographicSvgCandidate,
  validatePng = validateProfessionalInfographicPngCandidate,
} = {}) => {
  let svgResult
  try {
    svgResult = renderSvg(input)
    validateSvg(svgResult.buffer)
  } catch {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'SOURCE_INFOGRAPHIC_INVALID')
  }
  await verifyIdentity()
  let canvasApi
  let output
  try {
    canvasApi = await importCanvas()
    const image = await canvasApi.loadImage(svgResult.buffer)
    const canvas = canvasApi.createCanvas(WIDTH, HEIGHT)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, WIDTH, HEIGHT)
    context.drawImage(image, 0, 0, WIDTH, HEIGHT)
    output = canvas.toBuffer('image/png')
  } catch {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.RENDER_FAILED, 'PNG_RENDER_FAILED')
  }
  if (!Buffer.isBuffer(output) || output.length > MAX_OUTPUT_BYTES) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.LIMIT_EXCEEDED, 'PNG_OUTPUT_LIMIT_EXCEEDED')
  }
  validatePng(output)
  return Object.freeze({
    format: 'PNG',
    mimeType: 'image/png',
    extension: 'png',
    buffer: Buffer.from(output),
    checksum: sha256(output),
    width: WIDTH,
    height: HEIGHT,
    profile: PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_PROFILE,
    sourceSvgChecksum: sha256(svgResult.buffer),
  })
}

export async function renderProfessionalInfographicPngCandidate(input = {}) {
  if (arguments.length !== 1) {
    fail(PROFESSIONAL_INFOGRAPHIC_PNG_CANDIDATE_ERROR_CODES.INPUT_INVALID, 'CANDIDATE_ARGUMENTS_INVALID')
  }
  return renderWithDependencies(input)
}

export const __testables = Object.freeze({
  BUILD_FINGERPRINT,
  ENGINE,
  GENERIC_MESSAGE,
  HEIGHT,
  MAX_DECOMPRESSED_BYTES,
  MAX_COMPRESSED_BYTES,
  MAX_OUTPUT_BYTES,
  PIXEL_COUNT,
  PNG_CANVAS_PACKAGE_INTEGRITY,
  PNG_CANVAS_PACKAGE_VERSION,
  PNG_NATIVE_BINARY_BYTES,
  PNG_NATIVE_BINARY_NAME,
  PNG_NATIVE_BINARY_SHA256,
  PNG_NATIVE_PACKAGE_INTEGRITY,
  PNG_NATIVE_PACKAGE_NAME,
  PNG_NATIVE_PACKAGE_VERSION,
  PNG_SIGNATURE,
  WIDTH,
  crc32,
  inspectPixels,
  hashNativeBinary,
  paeth,
  parseChunks,
  renderWithDependencies,
  unfilterScanlines,
  validateChunkGrammar,
  validatePngInternal,
  verifyEngineIdentity,
})
