import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry } from '../../src/services/retry'

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')

    await expect(withRetry(fn)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries until success and returns the result', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom 1'))
      .mockRejectedValueOnce(new Error('boom 2'))
      .mockResolvedValue('ok')

    const promise = withRetry(fn, { baseMs: 10 })
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws the last error after all attempts fail', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValue(new Error('third'))

    const promise = withRetry(fn, { baseMs: 10 })
    const assertion = expect(promise).rejects.toThrow('third')
    await vi.runAllTimersAsync()
    await assertion
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('respects custom attempt count', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'))

    const promise = withRetry(fn, { attempts: 2, baseMs: 5 })
    const assertion = expect(promise).rejects.toThrow('always fails')
    await vi.runAllTimersAsync()
    await assertion
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('invokes onRetry hook for each retryable failure', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok')
    const onRetry = vi.fn()

    const promise = withRetry(fn, { baseMs: 5, onRetry })
    await vi.runAllTimersAsync()

    await promise
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1)
  })

  it('uses exponential backoff between attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('1'))
      .mockRejectedValueOnce(new Error('2'))
      .mockResolvedValue('ok')

    const promise = withRetry(fn, { baseMs: 100 })

    // first call happens synchronously; advance time across the two backoff
    // windows (100ms + 200ms = 300ms total)
    await vi.advanceTimersByTimeAsync(99)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(199)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fn).toHaveBeenCalledTimes(3)

    await expect(promise).resolves.toBe('ok')
  })
})
