// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  const instances: Array<{
    status: string
    connect: ReturnType<typeof vi.fn>
    incr: ReturnType<typeof vi.fn>
  }> = []
  class FakeRedis {
    status = 'wait'
    on = vi.fn()
    connect = vi.fn(async () => {
      if (fake.failConnect.value) throw new Error('no route to host')
      this.status = 'ready'
      return 'OK'
    })
    incr = vi.fn(async () => {
      if (fake.failIncr.value) throw new Error('socket hang up')
      return 1
    })
    disconnect = vi.fn()
    constructor() {
      instances.push(this)
    }
  }
  return {
    FakeRedis,
    instances,
    failConnect: { value: false },
    failIncr: { value: false },
  }
})

vi.mock('ioredis', () => ({ default: fake.FakeRedis }))

describe('withRedis', () => {
  beforeEach(() => {
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379')
    fake.instances.length = 0
    fake.failConnect.value = false
    fake.failIncr.value = false
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('awaits the lazy connection before running the command', async () => {
    const { withRedis } = await import('@/lib/cache/client')
    const result = await withRedis(
      async (redis) => {
        await redis.incr('probe')
        return 'ran'
      },
      async () => 'fell-back',
    )

    const client = fake.instances[0]
    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.incr).toHaveBeenCalledTimes(1)
    expect(result).toBe('ran')
  })

  it('does not connect again on an already-ready client', async () => {
    const { withRedis } = await import('@/lib/cache/client')
    await withRedis(
      async (redis) => redis.incr('a'),
      async () => 'fb',
    )
    await withRedis(
      async (redis) => redis.incr('b'),
      async () => 'fb',
    )

    const client = fake.instances[0]
    expect(client.connect).toHaveBeenCalledTimes(1)
    expect(client.incr).toHaveBeenCalledTimes(2)
  })

  it('runs the fallback when connect fails', async () => {
    fake.failConnect.value = true
    const { withRedis } = await import('@/lib/cache/client')
    const result = await withRedis(
      async () => 'ran',
      async () => 'fell-back',
    )

    expect(result).toBe('fell-back')
    expect(fake.instances[0].connect).toHaveBeenCalledTimes(1)
  })

  it('runs the fallback when the command fails', async () => {
    fake.failIncr.value = true
    const { withRedis } = await import('@/lib/cache/client')
    const result = await withRedis(
      async (redis) => redis.incr('a'),
      async () => 'fell-back',
    )

    expect(result).toBe('fell-back')
    expect(fake.instances[0].connect).toHaveBeenCalledTimes(1)
  })
})
