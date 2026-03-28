import { Hono } from 'hono'

const health = new Hono()

health.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default health
