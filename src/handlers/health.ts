import { Hono } from 'hono'

const health = new Hono<{ Bindings: Env }>()

health.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default health
