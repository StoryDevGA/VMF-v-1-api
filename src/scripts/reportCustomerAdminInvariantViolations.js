import { fileURLToPath } from 'url'
import { connectDb, disconnectDb } from '../config/db.js'
import { Customer, User } from '../models/index.js'

const ACTIVE_CUSTOMER_STATUS = 'ACTIVE'
const CUSTOMER_ADMIN_ROLE = 'CUSTOMER_ADMIN'

const ISSUE_CODES = Object.freeze({
  ZERO_ACTIVE_CUSTOMER_ADMINS: 'ZERO_ACTIVE_CUSTOMER_ADMINS',
  MULTIPLE_ACTIVE_CUSTOMER_ADMINS: 'MULTIPLE_ACTIVE_CUSTOMER_ADMINS',
  CANONICAL_ADMIN_MISSING: 'CANONICAL_ADMIN_MISSING',
  CANONICAL_ADMIN_NOT_ACTIVE: 'CANONICAL_ADMIN_NOT_ACTIVE',
  CANONICAL_ADMIN_NOT_CUSTOMER_ADMIN: 'CANONICAL_ADMIN_NOT_CUSTOMER_ADMIN',
  CANONICAL_ADMIN_MISMATCH: 'CANONICAL_ADMIN_MISMATCH',
})

const toIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value.toString === 'function') return value.toString()
  return String(value)
}

const parseArgs = (argv = process.argv.slice(2)) => {
  const args = new Set(argv)
  return {
    json: args.has('--json'),
    failOnViolations: args.has('--fail-on-violations'),
  }
}

const buildActiveAdminMap = (rows) => {
  const map = new Map()
  for (const row of rows) {
    const customerId = toIdString(row.customerId)
    const userId = toIdString(row.userId)
    if (!customerId || !userId) continue
    if (!map.has(customerId)) map.set(customerId, new Set())
    map.get(customerId).add(userId)
  }
  return map
}

const userHasCustomerAdminMembership = (user, customerId) => {
  if (!user || !Array.isArray(user.memberships)) return false
  return user.memberships.some(
    (membership) =>
      toIdString(membership.customerId) === customerId &&
      Array.isArray(membership.roles) &&
      membership.roles.includes(CUSTOMER_ADMIN_ROLE),
  )
}

const evaluateCustomerViolation = ({ customer, activeAdminUserIds, canonicalUser }) => {
  const customerId = toIdString(customer._id)
  const canonicalAdminUserId = toIdString(customer?.governance?.customerAdminUserId)
  const issues = []

  if (activeAdminUserIds.length === 0) {
    issues.push(ISSUE_CODES.ZERO_ACTIVE_CUSTOMER_ADMINS)
  } else if (activeAdminUserIds.length > 1) {
    issues.push(ISSUE_CODES.MULTIPLE_ACTIVE_CUSTOMER_ADMINS)
  }

  if (!canonicalAdminUserId) {
    issues.push(ISSUE_CODES.CANONICAL_ADMIN_MISSING)
  } else {
    if (!canonicalUser || canonicalUser.isActive !== true) {
      issues.push(ISSUE_CODES.CANONICAL_ADMIN_NOT_ACTIVE)
    }

    if (!userHasCustomerAdminMembership(canonicalUser, customerId)) {
      issues.push(ISSUE_CODES.CANONICAL_ADMIN_NOT_CUSTOMER_ADMIN)
    }

    if (activeAdminUserIds.length === 1 && canonicalAdminUserId !== activeAdminUserIds[0]) {
      issues.push(ISSUE_CODES.CANONICAL_ADMIN_MISMATCH)
    }
  }

  return {
    customerId,
    customerName: customer?.name || null,
    canonicalAdminUserId,
    activeAdminUserIds,
    issues,
  }
}

export const buildInvariantViolationReport = ({
  customers = [],
  activeAdminMap = new Map(),
  canonicalUsersById = new Map(),
} = {}) => {
  const issuesByCode = Object.fromEntries(
    Object.values(ISSUE_CODES).map((code) => [code, 0]),
  )
  const violations = []

  for (const customer of customers) {
    const customerId = toIdString(customer._id)
    const activeAdminUserIds = [...(activeAdminMap.get(customerId) || [])]
    const canonicalAdminUserId = toIdString(customer?.governance?.customerAdminUserId)
    const canonicalUser = canonicalAdminUserId
      ? canonicalUsersById.get(canonicalAdminUserId) || null
      : null

    const row = evaluateCustomerViolation({
      customer,
      activeAdminUserIds,
      canonicalUser,
    })

    if (row.issues.length > 0) {
      violations.push(row)
      for (const issue of row.issues) {
        issuesByCode[issue] += 1
      }
    }
  }

  return {
    summary: {
      totalActiveCustomers: customers.length,
      compliantCustomers: customers.length - violations.length,
      violatingCustomers: violations.length,
      issuesByCode,
    },
    violations,
  }
}

const loadActiveCustomers = async () =>
  Customer.find({ status: ACTIVE_CUSTOMER_STATUS })
    .select('_id name governance.customerAdminUserId')
    .lean()

const loadActiveAdminMembershipRows = async () =>
  User.aggregate([
    { $match: { isActive: true } },
    { $unwind: '$memberships' },
    {
      $match: {
        'memberships.customerId': { $ne: null },
        'memberships.roles': CUSTOMER_ADMIN_ROLE,
      },
    },
    {
      $project: {
        userId: '$_id',
        customerId: '$memberships.customerId',
      },
    },
  ])

const loadCanonicalUsers = async (canonicalUserIds) => {
  if (canonicalUserIds.length === 0) return new Map()

  const users = await User.find({ _id: { $in: canonicalUserIds } })
    .select('_id isActive memberships.customerId memberships.roles')
    .lean()

  return new Map(users.map((user) => [toIdString(user._id), user]))
}

const printReport = ({ summary, violations }, logger) => {
  logger('[invariant-report] active customers scanned: ' + summary.totalActiveCustomers)
  logger('[invariant-report] compliant customers: ' + summary.compliantCustomers)
  logger('[invariant-report] violating customers: ' + summary.violatingCustomers)
  logger('[invariant-report] issue counts:')
  for (const [issueCode, count] of Object.entries(summary.issuesByCode)) {
    logger(`  - ${issueCode}: ${count}`)
  }

  if (violations.length === 0) {
    logger('[invariant-report] no violations found.')
    return
  }

  logger('[invariant-report] violations:')
  for (const row of violations) {
    logger(
      `  - customerId=${row.customerId} name=${row.customerName || 'n/a'} issues=${row.issues.join(',')} canonical=${row.canonicalAdminUserId || 'null'} activeAdmins=${row.activeAdminUserIds.join(',') || 'none'}`,
    )
  }
}

export const runCustomerAdminInvariantViolationReport = async ({
  json = false,
  logger = console.log,
} = {}) => {
  await connectDb()

  try {
    const [customers, activeAdminMembershipRows] = await Promise.all([
      loadActiveCustomers(),
      loadActiveAdminMembershipRows(),
    ])

    const activeAdminMap = buildActiveAdminMap(activeAdminMembershipRows)
    const canonicalUserIds = [
      ...new Set(
        customers
          .map((customer) => toIdString(customer?.governance?.customerAdminUserId))
          .filter(Boolean),
      ),
    ]
    const canonicalUsersById = await loadCanonicalUsers(canonicalUserIds)

    const report = buildInvariantViolationReport({
      customers,
      activeAdminMap,
      canonicalUsersById,
    })

    if (json) {
      logger(JSON.stringify(report, null, 2))
    } else {
      printReport(report, logger)
    }

    return report
  } finally {
    try {
      await disconnectDb()
    } catch {
      // ignore disconnect failures in scripts
    }
  }
}

const runFromCli = async () => {
  const { json, failOnViolations } = parseArgs()

  try {
    const report = await runCustomerAdminInvariantViolationReport({ json })
    if (failOnViolations && report.summary.violatingCustomers > 0) {
      process.exit(2)
    }
    process.exit(0)
  } catch (err) {
    console.error('[invariant-report] failed:', err.message)
    process.exit(1)
  }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] === thisFile) {
  runFromCli()
}

export { ISSUE_CODES }
