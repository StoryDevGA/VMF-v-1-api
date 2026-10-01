import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'
import mongoose from 'mongoose'

import { OutcomeQualityStageExecution } from '../models/index.js'

const uri = process.env.SS033_TEST_MONGODB_URI
const run = uri ? describe : describe.skip

run('SS-033 real Mongo quality-stage persistence race', () => {
  beforeAll(async () => {
    const databaseName = uri.match(/\/([^/?]+)(?:\?|$)/)?.[1] || ''
    if (!/^ss033_quality_race_[a-z0-9_]+$/.test(databaseName)) {
      throw new Error('An explicitly named isolated SS-033 database is required')
    }
    await mongoose.connect(uri, { autoIndex: false })
    expect(mongoose.connection.name).toBe(databaseName)
    expect(mongoose.connection.client.topology.description.type).toBe('ReplicaSetWithPrimary')
    await OutcomeQualityStageExecution.createCollection()
    await OutcomeQualityStageExecution.collection.createIndex(
      { stageExecutionId: 1 },
      { unique: true, name: 'uniq_outcome_quality_stage_execution_id' },
    )
    await OutcomeQualityStageExecution.collection.createIndex(
      { runtimeInstanceId: 1, planId: 1, stageKey: 1, attemptNumber: 1 },
      { unique: true, name: 'uniq_outcome_quality_stage_attempt' },
    )
  }, 30000)

  afterAll(async () => {
    if (!uri || mongoose.connection.readyState === 0) return
    try {
      await mongoose.connection.dropDatabase()
    } finally {
      await mongoose.disconnect()
    }
  })

  test('commits one concurrent attempt and leaves one exact winner', async () => {
    const runtimeInstanceId = new mongoose.Types.ObjectId()
    const shared = {
      stageExecutionId: 'outcome_quality_stage_ss033_race',
      runtimeInstanceId,
      planId: 'outcome_kcp_ss033_race',
      stageKey: 'FRAMEWORK_GUIDANCE',
      attemptNumber: 1,
    }
    const insertAttempt = async (suffix) => {
      const session = await mongoose.startSession()
      try {
        await session.withTransaction(async () => {
          await OutcomeQualityStageExecution.collection.insertOne(
            { ...shared, _id: new mongoose.Types.ObjectId(), raceWriter: suffix },
            { session },
          )
        })
        return 'COMMITTED'
      } finally {
        await session.endSession()
      }
    }

    const results = await Promise.allSettled([insertAttempt('a'), insertAttempt('b')])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(({ status }) => status === 'rejected')
    expect(rejected.reason).toMatchObject({ code: 11000 })
    expect(await OutcomeQualityStageExecution.collection.countDocuments(shared)).toBe(1)

    const winner = await OutcomeQualityStageExecution.collection.findOne(shared)
    expect(winner).toEqual(expect.objectContaining(shared))
    expect(['a', 'b']).toContain(winner.raceWriter)
  }, 30000)
})
