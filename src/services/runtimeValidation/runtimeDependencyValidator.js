import mongoose from 'mongoose'
import FrameworkPackage from '../../models/FrameworkPackage.js'
import { RUNTIME_VALIDATION_CODES, buildRuntimeValidationIssue } from './runtimeValidationCodes.js'

const leanQuery = async (query) => {
  if (!query) return null
  if (typeof query.lean === 'function') return query.lean()
  return query
}

const normalizeToken = (value) => String(value || '').trim()

const normalizeUpperToken = (value) => normalizeToken(value).toUpperCase()

const buildDependencyIssue = (message, path = 'packageId', extra = {}) => ({
  ...buildRuntimeValidationIssue({
    code: RUNTIME_VALIDATION_CODES.DEPENDENCY_INVALID,
    severity: 'ERROR',
    message,
    path,
    source: 'runtime-dependency-validator',
  }),
  ...extra,
})

const resolveFrameworkPackage = async (packageId) => {
  const normalizedPackageId = normalizeToken(packageId)
  if (!normalizedPackageId) return null

  const query = mongoose.isValidObjectId(normalizedPackageId)
    ? FrameworkPackage.findById(normalizedPackageId)
    : FrameworkPackage.findOne({ packageKey: normalizedPackageId })

  return leanQuery(query)
}

export const validateRuntimeDependencyState = async ({ packageId, frameworkKey }) => {
  const normalizedPackageId = normalizeToken(packageId)
  if (!normalizedPackageId) return []

  const frameworkPackage = await resolveFrameworkPackage(normalizedPackageId)
  if (!frameworkPackage) {
    return [buildDependencyIssue(`Framework package "${normalizedPackageId}" was not found.`, 'packageId', { packageResolved: false })]
  }

  const requestFrameworkKey = normalizeUpperToken(frameworkKey)
  const packageFrameworkKey = normalizeUpperToken(frameworkPackage.frameworkKey)
  if (requestFrameworkKey && packageFrameworkKey && requestFrameworkKey !== packageFrameworkKey) {
    return [buildDependencyIssue(
      `Framework package "${frameworkPackage.packageKey || normalizedPackageId}" belongs to framework "${packageFrameworkKey}", not "${requestFrameworkKey}".`,
      'frameworkKey',
    )]
  }

  const dependencyLock = frameworkPackage.dependencyLock && typeof frameworkPackage.dependencyLock === 'object'
    ? frameworkPackage.dependencyLock
    : null
  if (!dependencyLock) {
    return [buildDependencyIssue(`Framework package "${frameworkPackage.packageKey || normalizedPackageId}" does not have a dependency lock snapshot.`)]
  }

  const lockStatus = String(dependencyLock.status || '').trim().toUpperCase()
  if (lockStatus && lockStatus !== 'PASS' && lockStatus !== 'PASS_WITH_WARNINGS') {
    return [buildDependencyIssue(`Framework package "${frameworkPackage.packageKey || normalizedPackageId}" dependency lock is ${lockStatus}.`)]
  }

  return []
}

export const getRuntimeDependencyLockState = async ({ packageId } = {}) => {
  const frameworkPackage = await resolveFrameworkPackage(packageId)
  const dependencyLock = frameworkPackage?.dependencyLock && typeof frameworkPackage.dependencyLock === 'object'
    ? frameworkPackage.dependencyLock
    : null
  const references = Array.isArray(dependencyLock?.references) ? dependencyLock.references : []
  const lockStatus = normalizeUpperToken(dependencyLock?.status)

  return (lockStatus === 'PASS' || lockStatus === 'PASS_WITH_WARNINGS') && references.length > 0
    ? 'LOCKED'
    : 'NOT_LOCKED'
}
