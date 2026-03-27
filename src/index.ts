import { Hono } from 'hono'

const app = new Hono<{ Bindings: Env }>()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

export default {
  fetch: app.fetch,
  scheduled(controller: ScheduledController) {
    console.log(
      `cron triggered: ${controller.cron} at ${controller.scheduledTime}`,
    )
  },
} satisfies ExportedHandler<Env>
