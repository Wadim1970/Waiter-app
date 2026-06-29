import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { config } from './config.js'
import { routes } from './routes.js'

const app = Fastify({ logger: true })

// CORS: список доменов фронта из CORS_ORIGIN, иначе разрешаем всё (dev)
if (config.corsOrigin.length > 0) {
  await app.register(cors, { origin: config.corsOrigin })
} else {
  app.log.warn('⚠️  CORS_ORIGIN не задан — разрешены любые источники. Не для прода!')
  await app.register(cors, { origin: true })
}

// Загрузка файлов до 10 МБ
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } })

await app.register(routes)

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
