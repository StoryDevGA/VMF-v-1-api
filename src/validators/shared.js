/**
 * Shared validator middleware helpers.
 *
 * Centralizes common Zod -> Express validation response behavior to
 * avoid duplicated `validate(schema)` blocks across validator modules.
 */

/**
 * Create an Express body validator middleware from a Zod schema.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {Object} [options]
 * @param {string} [options.message] - User-facing validation message.
 * @param {string} [options.rootIssueKey] - Key used when issue.path is empty.
 * @param {boolean} [options.includeDetails] - Include field-level validation details.
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void}
 */
export const createBodyValidator = (
  schema,
  {
    message = 'Please check the form for errors.',
    rootIssueKey = '',
    includeDetails = true,
  } = {},
) => (req, res, next) => {
  const result = schema.safeParse(req.body)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || rootIssueKey
      details[key] = issue.message
    }

    const error = {
      code: 'VALIDATION_FAILED',
      message,
      requestId: req.requestId,
    }
    if (includeDetails) error.details = details

    return res.status(422).json({ error })
  }

  req.body = result.data
  return next()
}

/**
 * Create an Express params validator middleware from a Zod schema.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {Object} [options]
 * @param {string} [options.message] - User-facing validation message.
 * @param {string} [options.rootIssueKey] - Key used when issue.path is empty.
 * @param {boolean} [options.includeDetails] - Include field-level validation details.
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void}
 */
export const createParamsValidator = (
  schema,
  {
    message = 'Invalid request parameters.',
    rootIssueKey = '',
    includeDetails = true,
  } = {},
) => (req, res, next) => {
  const result = schema.safeParse(req.params)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || rootIssueKey
      details[key] = issue.message
    }

    const error = {
      code: 'VALIDATION_FAILED',
      message,
      requestId: req.requestId,
    }
    if (includeDetails) error.details = details

    return res.status(422).json({ error })
  }

  req.params = { ...req.params, ...result.data }
  return next()
}

/**
 * Create an Express query validator middleware from a Zod schema.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {Object} [options]
 * @param {string} [options.message] - User-facing validation message.
 * @param {string} [options.rootIssueKey] - Key used when issue.path is empty.
 * @returns {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void}
 */
export const createQueryValidator = (
  schema,
  {
    message = 'Invalid query parameters.',
    rootIssueKey = '',
  } = {},
) => (req, res, next) => {
  const result = schema.safeParse(req.query)

  if (!result.success) {
    const details = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || rootIssueKey
      details[key] = issue.message
    }

    return res.status(422).json({
      error: {
        code: 'VALIDATION_FAILED',
        message,
        details,
        requestId: req.requestId,
      },
    })
  }

  req.query = result.data
  return next()
}
