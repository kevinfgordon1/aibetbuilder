import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function betstampLocalApi() {
  return {
    name: 'betstamp-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        const path = url.split('?')[0]
        if (path !== '/api/betstamp-markets' && path !== '/api/betstamp-stream') return next()
        try {
          const handler = path === '/api/betstamp-stream'
            ? require('./api/betstamp-stream.js')
            : require('./api/betstamp-markets.js')
          if (typeof res.status !== 'function') {
            res.status = (code) => {
              res.statusCode = code
              return res
            }
          }
          if (typeof res.json !== 'function') {
            res.json = (obj) => {
              if (!res.headersSent) res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(obj))
              return res
            }
          }
          await handler(req, res)
        } catch (err) {
          if (res.headersSent) return
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: String(err && err.message || err) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] == null) process.env[k] = v
  }
  return {
    plugins: [react(), betstampLocalApi()],
  }
})
