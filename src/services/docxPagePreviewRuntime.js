import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const DOCX_PAGE_LIMITS = Object.freeze({ docx: 8 * 1024 ** 2, pdf: 16 * 1024 ** 2,
  png: 2 * 1024 ** 2, totalPng: 8 * 1024 ** 2, pages: 20, dimension: 2500, pixels: 60_000_000,
  files: 25000, installationBytes: 2 * 1024 ** 3, runtimeMs: 60000, conversionMs: 60000,
  rasterMs: 45000, cleanupMs: 10000, messageBytes: 65536 })
export const pagePreviewFailure = reason => Object.assign(new Error('The document page preview is unavailable.'), {
  status: 409, code: 'DOCX_PAGE_PREVIEW_BLOCKED', details: { reason, contentIncludedInError: false },
})
export const previewHash = value => createHash('sha256').update(value).digest('hex')
export const previewDependencyVersions = () => ({ pdfjs: require('pdfjs-dist/package.json').version,
  canvas: require('@napi-rs/canvas/package.json').version })
const fail = reason => { throw pagePreviewFailure(reason) }
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const isHash = value => /^[a-f0-9]{64}$/.test(value || '')
const checkDeadline = deadline => { if (Date.now() > deadline) fail('RUNTIME_VERIFICATION_TIMEOUT') }
const fileHash = async (filename, deadline) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) { checkDeadline(deadline); hash.update(chunk) }
  return hash.digest('hex')
}

// Also used by a repeatable operator to describe a configured installation.
// The returned fingerprint is an observation, not a lock on executable files.
export const fingerprintDocxPreviewInstallation = async (root, deadline = Date.now() + DOCX_PAGE_LIMITS.runtimeMs) => {
  if (!path.isAbsolute(root)) fail('INSTALLATION_PATH_INVALID')
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('INSTALLATION_PATH_INVALID')
  const rows = []
  let bytes = 0
  const walk = async (directory, depth) => {
    checkDeadline(deadline)
    if (depth > 20) fail('INSTALLATION_LIMIT')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      checkDeadline(deadline)
      const filename = path.join(directory, entry.name), stat = await lstat(filename)
      if (stat.isSymbolicLink()) fail('INSTALLATION_LINK_INVALID')
      if (stat.isDirectory()) { await walk(filename, depth + 1); continue }
      if (!stat.isFile()) fail('INSTALLATION_ENTRY_INVALID')
      bytes += stat.size
      if (rows.length >= DOCX_PAGE_LIMITS.files || bytes > DOCX_PAGE_LIMITS.installationBytes) fail('INSTALLATION_LIMIT')
      const sha256 = await fileHash(filename, deadline)
      const after = await lstat(filename)
      if (after.isSymbolicLink() || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('INSTALLATION_CHANGED')
      rows.push({ relativePath: path.relative(root, filename).split(path.sep).join('/'), size: stat.size, sha256 })
    }
  }
  await walk(root, 0)
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.relativePath), Buffer.from(b.relativePath)))
  return { fingerprint: previewHash(JSON.stringify(rows)), fileCount: rows.length, totalBytes: bytes }
}

export const validateDocxPreviewRuntime = async profile => {
  if (process.platform !== 'win32') fail('RUNTIME_PLATFORM_UNSUPPORTED')
  if (!exact(profile, ['contractVersion', 'installationRoot', 'installationFingerprint', 'fileCount', 'totalBytes', 'productVersion', 'fonts'])
    || Buffer.byteLength(JSON.stringify(profile)) > 16384 || profile.contractVersion !== 'DOCX_PAGE_RUNTIME_V1'
    || typeof profile.installationRoot !== 'string' || !/^[A-Za-z]:[\\/]/.test(profile.installationRoot)
    || !isHash(profile.installationFingerprint) || !Number.isInteger(profile.fileCount) || profile.fileCount < 1
    || profile.fileCount > DOCX_PAGE_LIMITS.files || !Number.isSafeInteger(profile.totalBytes) || profile.totalBytes < 1
    || profile.totalBytes > DOCX_PAGE_LIMITS.installationBytes || !/^[0-9]+(?:\.[0-9]+){2,3}$/.test(profile.productVersion || '')
    || !Array.isArray(profile.fonts) || profile.fonts.length !== 4) fail('RUNTIME_PROFILE_INVALID')
  const deadline = Date.now() + DOCX_PAGE_LIMITS.runtimeMs
  const actual = await fingerprintDocxPreviewInstallation(profile.installationRoot, deadline)
  if (actual.fingerprint !== profile.installationFingerprint || actual.fileCount !== profile.fileCount
    || actual.totalBytes !== profile.totalBytes) fail('INSTALLATION_FINGERPRINT_CHANGED')
  const expectedFonts = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf']
  for (const [index, font] of profile.fonts.entries()) {
    if (!exact(font, ['path', 'sha256', 'byteLength']) || typeof font.path !== 'string'
      || !/^[A-Za-z]:[\\/]/.test(font.path) || path.basename(font.path).toLowerCase() !== expectedFonts[index]
      || !isHash(font.sha256) || !Number.isInteger(font.byteLength) || font.byteLength < 1 || font.byteLength > 4 * 1024 ** 2) fail('FONT_PROFILE_INVALID')
    const stat = await lstat(font.path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== font.byteLength
      || await fileHash(font.path, deadline) !== font.sha256) fail('FONT_CHANGED')
  }
  const executable = path.join(profile.installationRoot, 'program', 'soffice.com')
  const stat = await lstat(executable)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('EXECUTABLE_INVALID')
  const receipt = { contractVersion: profile.contractVersion, productVersion: profile.productVersion,
    installationFingerprint: actual.fingerprint, fileCount: actual.fileCount, totalBytes: actual.totalBytes,
    fonts: profile.fonts.map((font, index) => ({ name: expectedFonts[index], sha256: font.sha256, byteLength: font.byteLength })),
    dependencies: previewDependencyVersions(), standardFontPolicy: 'PDFJS_BUNDLED_BASE14_V1', dpi: 150, platform: process.platform }
  return { executable, receipt, fingerprint: previewHash(JSON.stringify(receipt)) }
}

export const assertPreviewDimensions = (width, height) => {
  if (![width, height].every(value => Number.isInteger(value) && value > 0 && value <= DOCX_PAGE_LIMITS.dimension)) fail('PAGE_DIMENSION_LIMIT')
}
const crc32 = bytes => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}
// Independently inspect bytes, including CRCs and decompressed scanline length.
export const validatePreviewPng = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || buffer.length > DOCX_PAGE_LIMITS.png
    || !buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) fail('PNG_INVALID')
  let offset = 8, width, height, channels, ended = false
  const data = []
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) fail('PNG_INVALID')
    const length = buffer.readUInt32BE(offset), end = offset + 12 + length
    if (end > buffer.length || length > DOCX_PAGE_LIMITS.png) fail('PNG_INVALID')
    const kind = buffer.toString('ascii', offset + 4, offset + 8)
    if (crc32(buffer.subarray(offset + 4, end - 4)) !== buffer.readUInt32BE(end - 4)) fail('PNG_CRC_INVALID')
    if (offset === 8 && kind !== 'IHDR') fail('PNG_INVALID')
    if (kind === 'IHDR') {
      if (width !== undefined || length !== 13) fail('PNG_INVALID')
      width = buffer.readUInt32BE(offset + 8); height = buffer.readUInt32BE(offset + 12)
      assertPreviewDimensions(width, height)
      channels = buffer[offset + 17] === 6 ? 4 : buffer[offset + 17] === 2 ? 3 : 0
      if (!channels || buffer[offset + 16] !== 8 || buffer[offset + 18] || buffer[offset + 19] || buffer[offset + 20]) fail('PNG_FORMAT_UNSUPPORTED')
    } else if (kind === 'IDAT') data.push(buffer.subarray(offset + 8, end - 4))
    else if (kind === 'IEND') { if (length || end !== buffer.length) fail('PNG_INVALID'); ended = true }
    else if (!['pHYs', 'sRGB', 'gAMA', 'cHRM', 'sBIT'].includes(kind)) fail('PNG_CHUNK_UNSUPPORTED')
    offset = end
  }
  if (!ended || !data.length) fail('PNG_INVALID')
  const expected = (width * channels + 1) * height
  let pixels
  try { pixels = inflateSync(Buffer.concat(data), { maxOutputLength: expected }) } catch { fail('PNG_DATA_INVALID') }
  if (pixels.length !== expected) fail('PNG_DATA_INVALID')
  for (let row = 0; row < height; row++) if (pixels[row * (width * channels + 1)] > 4) fail('PNG_DATA_INVALID')
  return { width, height, byteLength: buffer.length, sha256: previewHash(buffer) }
}
