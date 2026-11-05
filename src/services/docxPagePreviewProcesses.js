import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { DOCX_PAGE_LIMITS, pagePreviewFailure } from './docxPagePreviewRuntime.js'

const exec = promisify(execFile)
export const previewChildEnvironment = directory => ({ NODE_ENV: 'production', LANG: 'C', TZ: 'UTC',
  SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: directory, TMP: directory })
const powershell = () => path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const identity = row => `${row.pid}:${row.created}`
const ticksAt = milliseconds => 621355968000000000n + BigInt(milliseconds) * 10000n
const trackedChildren = new WeakSet(), closedChildren = new WeakSet()
export const trackPreviewChildClosure = child => {
  if (!trackedChildren.has(child)) {
    trackedChildren.add(child)
    child.once('close', () => closedChildren.add(child))
  }
  return child
}

const assertObservedLineage = (rows, known) => {
  const previous = new Map(known.map(row => [row.pid, row]))
  if (previous.size !== known.length) throw pagePreviewFailure('PROCESS_IDENTITY_CHANGED')
  const verified = new Map()
  for (const row of rows) {
    if (previous.has(row.pid)) {
      if (identity(previous.get(row.pid)) !== identity(row) || previous.get(row.pid).parent !== row.parent
        || previous.get(row.pid).name !== row.name) throw pagePreviewFailure('PROCESS_IDENTITY_CHANGED')
      verified.set(row.pid, row)
    }
  }
  let pending = rows.filter(row => !verified.has(row.pid))
  while (pending.length) {
    const next = pending.filter(row => {
      // A vanished parent cannot establish ownership of a newly seen child.
      const parent = verified.get(row.parent)
      if (!parent || BigInt(row.created) < BigInt(parent.created)) return true
      verified.set(row.pid, row); return false
    })
    if (next.length === pending.length) throw pagePreviewFailure('PROCESS_LINEAGE_UNVERIFIED')
    pending = next
  }
  return rows
}

const bindInitialProcessIdentity = (rows, child, { before, after, executable, parentPid = process.pid }) => {
  const root = rows.find(row => row.pid === child.pid)
  if (child.exitCode !== null || child.signalCode !== null || !root || root.parent !== parentPid
    || root.name.toLowerCase() !== path.basename(executable).toLowerCase()
    || BigInt(root.created) < ticksAt(before) || BigInt(root.created) >= ticksAt(after + 1)) throw pagePreviewFailure('PROCESS_LAUNCH_IDENTITY_UNVERIFIED')
  return assertObservedLineage(rows, [root])
}

// Uses the launched ChildProcess object, never the current owner of a numeric PID.
export const terminatePreviewChild = async (child, timeoutMs = DOCX_PAGE_LIMITS.cleanupMs) => {
  if (!child?.pid || closedChildren.has(child)) return
  trackPreviewChildClosure(child)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.off('close', closed); reject(pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED')) }, timeoutMs)
    const closed = () => { clearTimeout(timer); resolve() }
    child.once('close', closed)
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    } catch { clearTimeout(timer); child.off('close', closed); reject(pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED')) }
  })
}

// Only identities, never command lines or environment values, leave CIM.
export const inspectPreviewProcessTree = async (rootPid, known = [], timeoutMs = 5000) => {
  const roots = [...new Set([rootPid, ...known.map(row => row.pid)])]
  if (!roots.length || roots.length > 128 || roots.some(pid => !Number.isSafeInteger(pid) || pid < 1)) throw pagePreviewFailure('PROCESS_OBSERVATION_INVALID')
  const script = `$ids=@(${roots.join(',')}); $rows=@(); $all=@(Get-CimInstance Win32_Process -ErrorAction Stop); do {$next=@($all | Where-Object {($_.ProcessId -in $ids -or $_.ParentProcessId -in $ids) -and $_.ProcessId -notin @($rows.ProcessId)}); $rows+=$next; $ids=@($next.ProcessId)} while($next.Count -gt 0); $result=@($rows | ForEach-Object {@{pid=[int]$_.ProcessId; parent=[int]$_.ParentProcessId; name=[string]$_.Name; created=$_.CreationDate.ToUniversalTime().Ticks.ToString()}}); ConvertTo-Json -InputObject $result -Compress`
  let rows
  try {
    const result = await exec(powershell(), ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: Math.max(1, Math.min(timeoutMs, 5000)), maxBuffer: DOCX_PAGE_LIMITS.messageBytes,
      env: previewChildEnvironment(process.env.TEMP),
    })
    rows = JSON.parse(result.stdout)
  } catch { throw pagePreviewFailure('PROCESS_OBSERVATION_FAILED') }
  if (!Array.isArray(rows) || rows.length > 128 || rows.some(row => !Number.isSafeInteger(row.pid)
    || !Number.isSafeInteger(row.parent) || typeof row.name !== 'string' || !/^\d+$/.test(row.created))) throw pagePreviewFailure('PROCESS_OBSERVATION_INVALID')
  return known.length ? assertObservedLineage(rows, known) : rows
}

export const stopPreviewProcessTree = async (rootPid, known) => {
  if (!Array.isArray(known) || !known.some(row => row.pid === rootPid && /^\d+$/.test(row.created))) throw pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED')
  const deadline = Date.now() + DOCX_PAGE_LIMITS.cleanupMs
  try {
    let rows = await inspectPreviewProcessTree(rootPid, known, deadline - Date.now())
    const observed = new Map(known.map(row => [identity(row), row]))
    for (const row of rows) observed.set(identity(row), row)
    // Prefer the still-live root; otherwise stop only observed identities.
    rows.sort((a, b) => (a.pid === rootPid ? -1 : b.pid === rootPid ? 1 : 0))
    for (const row of rows) {
      if (Date.now() >= deadline) throw new Error('deadline')
      const live = await inspectPreviewProcessTree(rootPid, [...observed.values()], deadline - Date.now())
      for (const child of live) observed.set(identity(child), child)
      if (!live.some(item => identity(item) === identity(row))) continue
      await exec(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(row.pid), '/T', '/F'], {
        windowsHide: true, timeout: Math.max(1, deadline - Date.now()), maxBuffer: 8192,
        env: previewChildEnvironment(process.env.TEMP),
      })
    }
    const remaining = await inspectPreviewProcessTree(rootPid, [...observed.values()], deadline - Date.now())
    if (remaining.length) throw new Error('remaining')
    return [...observed.values()]
  } catch { throw pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED') }
}

export const runPreviewConversionProcess = async ({ executable, args, directory, timeoutMs = DOCX_PAGE_LIMITS.conversionMs }) => {
  let child, spawnError, exit, failure
  const known = new Map(), output = { stdout: '', stderr: '' }
  const deadline = Date.now() + timeoutMs
  try {
    const before = Date.now()
    child = spawn(executable, args, { cwd: directory, windowsHide: true, shell: false,
      env: previewChildEnvironment(directory), stdio: ['ignore', 'pipe', 'pipe'] })
    const after = Date.now()
    trackPreviewChildClosure(child)
    const completed = new Promise(resolve => {
      child.once('error', () => { spawnError = true; resolve() })
      child.once('close', (code, signal) => { exit = { code, signal }; resolve() })
    })
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      if (Buffer.byteLength(output[stream]) + chunk.length > DOCX_PAGE_LIMITS.messageBytes) failure = 'CONVERTER_OUTPUT_LIMIT'
      else output[stream] += chunk.toString('utf8')
    })
    if (!child.pid) { await completed; throw pagePreviewFailure('CONVERTER_START_FAILED') }
    while (!exit && !spawnError) {
      if (Date.now() >= deadline) { failure = 'CONVERSION_TIMEOUT'; break }
      if (failure) break
      const rows = await inspectPreviewProcessTree(child.pid, [...known.values()], Math.min(5000, deadline - Date.now()))
      if (!known.size) bindInitialProcessIdentity(rows, child, { before, after, executable })
      for (const row of rows) known.set(identity(row), row)
    }
    if (spawnError) throw pagePreviewFailure('CONVERTER_START_FAILED')
    if (failure) {
      if (!known.size) { await terminatePreviewChild(child); throw pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED') }
      await stopPreviewProcessTree(child.pid, [...known.values()])
      await terminatePreviewChild(child)
      await completed
      throw pagePreviewFailure(failure)
    }
    await completed
    const remaining = await inspectPreviewProcessTree(child.pid, [...known.values()])
    if (!known.size) throw pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED')
    for (const row of remaining) known.set(identity(row), row)
    if (remaining.length) await stopPreviewProcessTree(child.pid, [...known.values()])
    if (exit.code !== 0 || exit.signal || remaining.length) throw pagePreviewFailure('CONVERTER_FAILED')
    return { exitCode: 0, treeEmpty: true, observed: [...known.values()], diagnostics: output }
  } catch (error) {
    const unknownOwnership = ['PROCESS_IDENTITY_CHANGED', 'PROCESS_LINEAGE_UNVERIFIED', 'PROCESS_LAUNCH_IDENTITY_UNVERIFIED',
      'PROCESS_OBSERVATION_FAILED', 'PROCESS_OBSERVATION_INVALID'].includes(error.details?.reason)
    if (child?.pid && (!known.size || unknownOwnership)) { await terminatePreviewChild(child); throw pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED') }
    if (child?.pid && (!exit || error.details?.reason === 'PROCESS_OBSERVATION_FAILED')) {
      try { await stopPreviewProcessTree(child.pid, [...known.values()]) } catch { throw pagePreviewFailure('PROCESS_CLEANUP_UNVERIFIED') }
    }
    if (error.code === 'DOCX_PAGE_PREVIEW_BLOCKED') throw error
    throw pagePreviewFailure('CONVERTER_FAILED')
  }
}

export const __testables = { assertObservedLineage, bindInitialProcessIdentity, ticksAt }
