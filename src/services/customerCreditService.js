import { Customer } from '../models/index.js'

export const CUSTOMER_CREDIT_PRODUCTS = Object.freeze({
  WEBSITE: Object.freeze({ key: 'WEBSITE', field: 'creditBalances.websiteAnalysis' }),
  DOCUMENTS: Object.freeze({ key: 'DOCUMENTS', field: 'creditBalances.documentImprovement' }),
})

const normalizeProductKey = (value) => String(value ?? '').trim().toUpperCase()

export const normalizeCreditBalances = (creditBalances = {}) => ({
  websiteAnalysis: Number.isInteger(creditBalances?.websiteAnalysis) && creditBalances.websiteAnalysis >= 0
    ? creditBalances.websiteAnalysis
    : 0,
  documentImprovement: Number.isInteger(creditBalances?.documentImprovement) && creditBalances.documentImprovement >= 0
    ? creditBalances.documentImprovement
    : 0,
})

export const adjustCustomerCredit = async ({ customerId, productKey, delta, session }) => {
  const normalizedProductKey = normalizeProductKey(productKey)
  const product = CUSTOMER_CREDIT_PRODUCTS[normalizedProductKey]
  if (!product) {
    const error = new Error('Unsupported credit product.')
    error.status = 422
    error.code = 'VALIDATION_FAILED'
    throw error
  }

  const amount = Number(delta)
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000000000) {
    const error = new Error('Credit adjustment must be a non-zero whole number within the allowed range.')
    error.status = 422
    error.code = 'VALIDATION_FAILED'
    throw error
  }
  const filter = { _id: customerId }
  if (amount < 0) filter[product.field] = { $gte: Math.abs(amount) }

  const query = Customer.findOneAndUpdate(
    filter,
    { $inc: { [product.field]: amount } },
    { new: true, runValidators: true },
  )
  const customer = await (session ? query.session(session) : query)

  if (!customer) {
    const error = new Error(amount < 0 ? 'Credit adjustment would make the balance negative or customer was not found.' : 'Customer not found.')
    error.status = amount < 0 ? 409 : 404
    error.code = amount < 0 ? 'CREDIT_BALANCE_NEGATIVE' : 'NOT_FOUND'
    throw error
  }

  return {
    customer,
    productKey: normalizedProductKey,
    delta: amount,
    balances: normalizeCreditBalances(customer.creditBalances),
  }
}
