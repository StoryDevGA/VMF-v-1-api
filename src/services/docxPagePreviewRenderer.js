import { fork } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, lstat, realpath, rm, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateProfessionalDocumentCandidatePackage } from './professionalDocumentCandidateRenderer.js'
import { DOCX_PAGE_LIMITS, previewHash, pagePreviewFailure, validateDocxPreviewRuntime, validatePreviewPng } from './docxPagePreviewRuntime.js'
import { previewChildEnvironment, runPreviewConversionProcess, terminatePreviewChild, trackPreviewChildClosure } from './docxPagePreviewProcesses.js'

const workerEntry = fileURLToPath(new URL('./docxPagePreviewWorker.js', import.meta.url))
const fail = reason => { throw pagePreviewFailure(reason) }
const boundedFile = async (filename, limit) => {
  const stat = await lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) fail('PREVIEW_FILE_INVALID')
  const bytes = await readFile(filename)
  if (bytes.length !== stat.size) fail('PREVIEW_FILE_CHANGED')
  return bytes
}

export const cleanupDocxPreviewDirectory = async (directory, tempRoot) => {
  const absolute = path.resolve(directory), parent = await realpath(tempRoot)
  if (path.dirname(absolute) !== parent || !path.basename(absolute).startsWith('storylineos-docx-pages-')) fail('JOB_CLEANUP_PATH_INVALID')
  const stat = await lstat(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(absolute) !== absolute) fail('JOB_CLEANUP_PATH_INVALID')
  await rm(absolute, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 })
}

const rasterize = (directory, { entry = workerEntry, timeoutMs = DOCX_PAGE_LIMITS.rasterMs } = {}) => new Promise((resolve, reject) => {
  let result, failure, messages = 0, outputBytes = 0, terminal = false
  const child = trackPreviewChildClosure(fork(entry, [directory], { cwd: directory, execPath: process.execPath,
    execArgv: ['--max-old-space-size=256'], windowsHide: true,
    env: { ...previewChildEnvironment(directory), STORYLINEOS_DOCX_PAGE_WORKER: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json' }))
  const diagnostics = { stdout: '', stderr: '' }
  const stop = async reason => {
    if (terminal) return
    terminal = true; clearTimeout(timer)
    try {
      await terminatePreviewChild(child)
      reject(pagePreviewFailure(reason))
    } catch { reject(pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED')) }
  }
  const timer = setTimeout(() => { void stop('RASTERIZATION_TIMEOUT') }, timeoutMs)
  for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
    outputBytes += bytes.length
    if (outputBytes > DOCX_PAGE_LIMITS.messageBytes) void stop('RASTERIZER_OUTPUT_LIMIT')
    else diagnostics[stream] += bytes.toString('utf8')
  })
  child.on('message', message => {
    messages++
    if (messages !== 1 || Buffer.byteLength(JSON.stringify(message)) > DOCX_PAGE_LIMITS.messageBytes
      || message?.contractVersion !== 'DOCX_PAGE_RASTER_V1') { void stop('RASTERIZER_PROTOCOL_INVALID'); return }
    result = message
    if (message.error) failure = /^[A-Z_]+$/.test(message.error) ? message.error : 'RASTERIZATION_FAILED'
  })
  child.once('error', () => { void stop('RASTERIZER_START_FAILED') })
  child.once('close', (code, signal) => {
    if (terminal) return
    terminal = true; clearTimeout(timer)
    if (code !== 0 || signal || !result || failure) {
      const error = pagePreviewFailure(failure || 'RASTERIZATION_FAILED')
      Object.defineProperty(error, 'operatorDiagnostics', { value: { ...diagnostics, exitCode: code, signal } })
      reject(error)
    }
    else resolve({ result, diagnostics })
  })
})

const createRenderer = ({ runtimeValidator = validateDocxPreviewRuntime, convert = runPreviewConversionProcess,
  rasterOptions, tempRoot = os.tmpdir() } = {}) => async ({ buffer, outputChecksum, runtimeProfile } = {}) => {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > DOCX_PAGE_LIMITS.docx
    || outputChecksum !== `sha256:${previewHash(buffer)}`) fail('CANDIDATE_BYTES_CHANGED')
  await validateProfessionalDocumentCandidatePackage(buffer)
  const runtime = await runtimeValidator(runtimeProfile)
  const parent = await realpath(tempRoot)
  const directory = await mkdtemp(path.join(parent, 'storylineos-docx-pages-'))
  let unsafeProcess = false, result, failure
  try {
    await Promise.all(['profile', 'out', 'pages'].map(name => mkdir(path.join(directory, name))))
    await writeFile(path.join(directory, 'input.docx'), buffer, { flag: 'wx' })
    const conversion = await convert({ executable: runtime.executable, directory,
      args: [`-env:UserInstallation=${pathToFileURL(path.join(directory, 'profile')).href}`, '--headless', '--nologo',
        '--nodefault', '--nofirststartwizard', '--norestore', '--convert-to', 'pdf:writer_pdf_Export',
        '--outdir', path.join(directory, 'out'), path.join(directory, 'input.docx')] })
    if (conversion.exitCode !== 0 || conversion.treeEmpty !== true) fail('PROCESS_CLEANUP_UNVERIFIED')
    const pdf = await boundedFile(path.join(directory, 'out', 'input.pdf'), DOCX_PAGE_LIMITS.pdf)
    const raster = await rasterize(directory, rasterOptions)
    const manifest = raster.result.pages
    if (!Array.isArray(manifest) || !manifest.length || manifest.length > DOCX_PAGE_LIMITS.pages) fail('PAGE_MANIFEST_INVALID')
    const filenames = await readdir(path.join(directory, 'pages'))
    if (filenames.length !== manifest.length) fail('PAGE_MANIFEST_INVALID')
    let totalBytes = 0, totalPixels = 0
    const pages = []
    for (const [index, expected] of manifest.entries()) {
      const number = index + 1, filename = `page-${String(number).padStart(3, '0')}.png`
      if (expected.number !== number || !filenames.includes(filename)) fail('PAGE_MANIFEST_INVALID')
      const bytes = await boundedFile(path.join(directory, 'pages', filename), DOCX_PAGE_LIMITS.png)
      const actual = validatePreviewPng(bytes)
      if (['width', 'height', 'byteLength', 'sha256'].some(key => expected[key] !== actual[key])) fail('PAGE_BYTES_CHANGED')
      totalBytes += bytes.length; totalPixels += actual.width * actual.height
      if (totalBytes > DOCX_PAGE_LIMITS.totalPng || totalPixels > DOCX_PAGE_LIMITS.pixels) fail('PAGE_OUTPUT_LIMIT')
      pages.push({ number, ...actual, buffer: bytes })
    }
    const receipt = { contractVersion: 'DOCX_PAGE_PREVIEW_V1', status: 'PRIVATE_PREVIEW_ONLY',
      authorisesApproval: false, finalisationAvailable: false, deliveryAvailable: false,
      docxChecksum: outputChecksum, pdfChecksum: `sha256:${previewHash(pdf)}`, runtime: runtime.receipt,
      runtimeFingerprint: runtime.fingerprint, pages: pages.map(({ buffer: _buffer, ...metadata }) => metadata) }
    result = { receipt, fingerprint: previewHash(JSON.stringify(receipt)), pages,
      // Internal operator diagnostics; never include these strings in public receipts.
      diagnostics: { conversion: conversion.diagnostics, raster: raster.diagnostics, observedProcesses: conversion.observed } }
  } catch (error) {
    unsafeProcess = ['PROCESS_CLEANUP_UNVERIFIED', 'PROCESS_IDENTITY_CHANGED', 'PROCESS_LINEAGE_UNVERIFIED',
      'PROCESS_LAUNCH_IDENTITY_UNVERIFIED', 'PROCESS_OBSERVATION_FAILED', 'PROCESS_OBSERVATION_INVALID'].includes(error.details?.reason)
    failure = unsafeProcess ? pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED')
      : error.code === 'DOCX_PAGE_PREVIEW_BLOCKED' ? error : pagePreviewFailure('PAGE_CONVERSION_FAILED')
  }
  if (!unsafeProcess) {
    try { await cleanupDocxPreviewDirectory(directory, parent) } catch { failure = pagePreviewFailure('JOB_CLEANUP_FAILED') }
  }
  if (failure) throw failure
  return result
}

export const renderDocxPagePreview = createRenderer()
export const __testables = { createRenderer, rasterize }
