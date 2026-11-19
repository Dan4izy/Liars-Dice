import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Fastify from 'fastify'
import staticFiles from '@fastify/static'
import { auth, origin, pool } from './auth.ts'

const app = Fastify({ bodyLimit: 32 * 1024 })
app.addHook('onClose', async () => pool.end())
app.get('/health/live', async () => ({ status: 'ok' }))
app.get('/health/ready', async (_, reply) => {
  try {
    await pool.query('SELECT 1')
    return { status: 'ok' }
  } catch {
    return reply.code(503).send({ status: 'unavailable' })
  }
})

app.route({
  method: ['GET', 'POST'],
  url: '/api/auth/*',
  handler: async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (request.method === 'POST' && request.headers.origin !== origin) {
      return reply.code(403).send({ code: 'INVALID_ORIGIN' })
    }
    const headers = new Headers()
    for (const [key, value] of Object.entries(request.headers)) {
      if (key !== 'content-length' && value !== undefined) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
    }
    const response = await auth.handler(new Request(new URL(origin + request.url), {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    }))
    reply.code(response.status)
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') reply.header(key, value)
    })
    const cookies = response.headers.getSetCookie()
    if (cookies.length) reply.header('Set-Cookie', cookies)
    return reply.send(response.body ? await response.text() : undefined)
  },
})

app.get('/api/me', async (request, reply) => {
  reply.header('Cache-Control', 'no-store')
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: request.headers.cookie ?? '' }),
    query: { disableRefresh: true },
  })
  if (!session?.user.emailVerified) return reply.code(401).send({ code: 'UNAUTHENTICATED' })
  const { id, name, email, emailVerified } = session.user
  return { profile: { id, name, email, emailVerified }, activeRoom: null, activeMatch: null }
})

await app.register(staticFiles, {
  root: fileURLToPath(new URL('../../web/dist/', import.meta.url)),
  wildcard: false,
})
app.setNotFoundHandler((request, reply) => {
  if (request.method === 'GET' && /^\/(?:reset|r\/[A-Za-z0-9]{8})(?:\?|$)/.test(request.url)) {
    return reply.sendFile('index.html')
  }
  return reply.code(404).send({ code: 'NOT_FOUND' })
})

const { values } = parseArgs({
  options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } },
})
await app.listen({
  port: Number(values.port ?? process.env.PORT ?? 3000),
  host: values.host ?? process.env.BIND_HOST ?? '127.0.0.1',
})
console.log('Liar’s Dice listening on', origin)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void app.close())
}
