import 'reflect-metadata'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { network } from './msw-server'

// Any request without a handler fails the test rather than reaching the real
// service — the tests carry credentials that would be rejected upstream.
network.configure({ onUnhandledFrame: 'error' })

beforeAll(() => network.enable())
afterEach(() => network.resetHandlers())
afterAll(() => network.disable())
