/** Forward asynchronous middleware failures to Express 4's error handler. */
export const asyncMiddleware = (handler) => (req, res, next) =>
  Promise.resolve()
    .then(() => handler(req, res, next))
    .catch((error) => next(error instanceof Error
      ? error
      : new Error('Middleware failed', { cause: error })))
