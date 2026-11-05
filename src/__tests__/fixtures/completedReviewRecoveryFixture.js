import { describe, expect, jest, test } from '@jest/globals'
import mongoose from 'mongoose'

// Unit-only schedule: a pre-saved bundle is hidden from three reads. Native
// unconnected sessions retry two injected write conflicts, then the store's
// real attempt guard fires. No database contention or persistence is claimed.
export const arrangeCompletedReviewRecovery = (fixture, createSession, { afterClose, closeError, failure, readError } = {}) => {
  const execution = fixture.deps.Execution, writer = fixture.deps.auditService
  const findOne = execution.findOne, key = fixture.executions.find(r => r.status === 'MASTER_DOCX_REVIEW_COMPLETED').idempotencyKey
  const trace = { callbacks: 0, auditAttempts: 0, starts: 0, transactions: 0, ends: 0, closed: false, resultReads: 0, afterCloseReads: 0 }
  let session, nativeEnd
  execution.findOne = filter => {
    const query = findOne(filter)
    if (filter.idempotencyKey === key) {
      const lean = query.lean
      query.lean = async () => {
        if (++trace.resultReads <= 3) return null
        if (!trace.closed) throw Error('RECOVERY_BEFORE_SESSION_CLOSE')
        trace.afterCloseReads++
        if (readError) throw readError
        return lean.call(query)
      }
    }
    return query
  }
  execution.db.startSession = async () => {
    trace.starts++; session = createSession(); nativeEnd = session.endSession.bind(session)
    const nativeTransaction = session.withTransaction.bind(session)
    session.withTransaction = async (callback, options) => {
      trace.transactions++
      return nativeTransaction(async s => { trace.callbacks++; return callback(s) }, options)
    }
    session.endSession = async () => {
      trace.ends++
      if (closeError) throw closeError
      await nativeEnd(); trace.closed = true
      if (afterClose) await afterClose(fixture)
    }
    return session
  }
  writer.log = jest.fn(async () => {
    trace.auditAttempts++
    if (failure) throw failure
    throw new mongoose.mongo.MongoServerError({ code: 112, errmsg: 'Unit-only write conflict', errorLabels: ['TransientTransactionError'] })
  })
  const writes = ['Execution', 'Artifact', 'Stage'].map(kind => jest.spyOn(fixture.deps[kind], 'create'))
  return { trace, writes,
    dispose: async () => { if (nativeEnd && !session.hasEnded) await nativeEnd() } }
}

export const completedReviewRecoveryCases = (name, setup, createSession) => describe(name, () => {
  const exercise = async (options, check) => {
    const f = await setup(), saved = await f.store.persist(f.args), fetches = f.fetch.mock.calls.length
    const r = arrangeCompletedReviewRecovery(f, createSession, options)
    try { await check(f, r, saved) } finally {
      await r.dispose()
      expect(r.trace.starts).toBe(1); expect(r.trace.transactions).toBe(1); expect(r.trace.ends).toBe(1)
      for (const write of r.writes) { expect(write).not.toHaveBeenCalled(); write.mockRestore() }
      expect(f.fetch).toHaveBeenCalledTimes(fetches)
    }
  }
  test('attempt exhaustion returns the exact verified winner after closure with no new writes', async () => {
    await exercise({}, async (f, r, saved) => {
      await expect(f.store.persist(f.args)).resolves.toMatchObject({ ...saved, idempotent: true })
      expect(r.trace).toMatchObject({ callbacks: 3, auditAttempts: 2, closed: true, resultReads: 4, afterCloseReads: 1 })
    })
  })
  test('attempt exhaustion without a winner preserves the original held refusal', async () => {
    await exercise({ afterClose: f => { f.executions.splice(f.executions.findIndex(r => r.status === 'MASTER_DOCX_REVIEW_COMPLETED'), 1) } }, async (f, r) => {
      await expect(f.store.persist(f.args)).rejects.toMatchObject({ code: 'MASTER_LINKED_COMPLETED_REVIEW_HELD', status: 409, details: { reason: 'COMPLETION_TRANSACTION_ATTEMPTS', completionConfirmed: false } })
      expect(r.trace.callbacks).toBe(3); expect(r.trace.afterCloseReads).toBe(1)
    })
  })
  test.each(['artifact', 'stage', 'audit'])('attempt exhaustion cannot accept a missing %s', async kind => {
    await exercise({ afterClose: f => {
      if (kind === 'artifact') f.artifacts.length = 0
      if (kind === 'stage') f.stages.length = 0
      if (kind === 'audit') f.audits.pop()
    } }, async f => {
      await expect(f.store.persist(f.args)).rejects.toMatchObject({ details: { completionConfirmed: false } })
    })
  })
  test.each(['receipt', 'findings', 'source', 'signature'])('attempt exhaustion refuses changed %s', async kind => {
    await exercise({ afterClose: f => {
      if (kind === 'receipt') f.executions.find(r => r.status === 'MASTER_DOCX_REVIEW_COMPLETED').executionEvidence.masterLinkedCompletedReview.body.input.receipt.postRequestId = 'req_changed'
      if (kind === 'findings') f.artifacts[0].generatedOutput.findings[0].finding = 'Changed after completion'
      if (kind === 'source') f.changeSource()
      if (kind === 'signature') f.audits.at(-1).signature = 'invalid'
    } }, async f => {
      await expect(f.store.persist(f.args)).rejects.toMatchObject({ details: { completionConfirmed: false } })
    })
  })
  test('attempt exhaustion with an unavailable read remains unconfirmed', async () => {
    await exercise({ readError: Error('READ_UNAVAILABLE') }, async f => {
      await expect(f.store.persist(f.args)).rejects.toMatchObject({ status: 503, details: { reason: 'COMPLETION_UNCONFIRMED', completionConfirmed: false } })
    })
  })
  test('attempt exhaustion does not extend the original deadline', async () => {
    let clock
    try {
      await exercise({ afterClose: () => { const late = Date.now() + 100000; clock = jest.spyOn(Date, 'now').mockReturnValue(late) } }, async (f, r) => {
        await expect(f.store.persist(f.args)).rejects.toMatchObject({ details: { reason: 'COMPLETION_DEADLINE', completionConfirmed: false } })
        expect(r.trace.afterCloseReads).toBe(0)
      })
    } finally { clock?.mockRestore() }
  })
  test('failed session closure prevents all winner lookups', async () => {
    const failure = Error('SESSION_CLOSE_UNCONFIRMED')
    await exercise({ closeError: failure }, async (f, r) => {
      await expect(f.store.persist(f.args)).rejects.toBe(failure)
      expect(r.trace.closed).toBe(false); expect(r.trace.afterCloseReads).toBe(0)
    })
  })
  test('a foreign error with the same code and reason cannot claim owned exhaustion', async () => {
    const failure = Object.assign(Error('FOREIGN_ERROR'), { code: 'MASTER_LINKED_COMPLETED_REVIEW_HELD', details: { reason: 'COMPLETION_TRANSACTION_ATTEMPTS' } })
    await exercise({ failure }, async (f, r) => {
      await expect(f.store.persist(f.args)).rejects.toBe(failure)
      expect(r.trace).toMatchObject({ callbacks: 1, auditAttempts: 1, afterCloseReads: 0 })
    })
  })
})
