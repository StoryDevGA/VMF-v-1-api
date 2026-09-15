import { beforeAll, afterEach, expect, jest, test } from '@jest/globals'

let User, UIContract, buildBulkUserReader, controllers
beforeAll(async () => {
  process.env.NODE_ENV = 'test'
  User = (await import('../models/User.js')).default
  UIContract = (await import('../models/UIContract.js')).default
  ;({ buildBulkUserReader } = await import('../services/bulkUserReadService.js'))
  controllers = await import('../controllers/uiContract.controller.js')
})
afterEach(() => jest.restoreAllMocks())

test('bulk reads batch first occurrences and refetch duplicates after prior changes', async () => {
  const a = { _id: 'a' }, b = { _id: 'b' }, later = { _id: 'a', updated: true }
  const find = jest.spyOn(User, 'find').mockResolvedValue([a, b])
  const byId = jest.spyOn(User, 'findById').mockResolvedValue(later)
  const read = await buildBulkUserReader(['a', 'b', 'a', 'missing'])
  expect(find).toHaveBeenCalledWith({ _id: { $in: ['a', 'b', 'missing'] } })
  expect(await read('a')).toBe(a)
  expect(await read('b')).toBe(b)
  expect(await read('missing')).toBeNull()
  expect(byId).not.toHaveBeenCalled()
  expect(await read('a')).toBe(later)
  expect(byId).toHaveBeenCalledTimes(1)
})

test('failed bulk read preserves genuine per-item successes and failures', async () => {
  jest.spyOn(User, 'find').mockRejectedValue(new Error('batch failure'))
  jest.spyOn(User, 'findById').mockResolvedValueOnce({ _id: 'a' }).mockRejectedValueOnce(new Error('item failure'))
  const read = await buildBulkUserReader(['a', 'b'])
  expect(await read('a')).toEqual({ _id: 'a' })
  await expect(read('b')).rejects.toThrow('item failure')
})

test.each(['activateUIContract', 'deprecateUIContract', 'archiveUIContract'])(
  '%s leaves request payload and audit context intact when target is missing', async (name) => {
    jest.spyOn(UIContract, 'findById').mockResolvedValue(null)
    const req = { params: { uiContractId: 'missing' }, body: { name: 'original' }, requestId: 'test' }
    const before = structuredClone(req)
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() }, next = jest.fn()
    await controllers[name](req, res, next)
    expect(req).toEqual(before)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(next).not.toHaveBeenCalled()
  },
)
