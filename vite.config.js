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
        if (path !== '/api/betstamp-markets' && path !== '/api/betstamp-stream' && path !== '/api/underdog-predict' && path !== '/api/polymarket-stream' && path !== '/api/polymarket-board' && path !== '/api/kalshi-stream' && path !== '/api/kalshi-board' && path !== '/api/novig-stream' && path !== '/api/4casters-stream' && path !== '/api/live-trading-desk') return next()
        try {
          if (path === '/api/live-trading-desk' && req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const raw = Buffer.concat(chunks).toString('utf8')
            try { req.body = raw ? JSON.parse(raw) : {} } catch { req.body = {} }
          }
          const handler = path === '/api/betstamp-stream'
            ? require('./api/betstamp-stream.js')
            : path === '/api/underdog-predict'
              ? require('./api/underdog-predict.js')
                : path === '/api/polymarket-stream'
                ? require('./api/polymarket-stream.js')
                : path === '/api/polymarket-board'
                  ? require('./api/polymarket-board.js')
                  : path === '/api/kalshi-stream'
                  ? require('./api/kalshi-stream.js')
                  : path === '/api/kalshi-board'
                    ? require('./api/kalshi-board.js')
                    : path === '/api/novig-stream'
                      ? require('./api/novig-stream.js')
                      : path === '/api/4casters-stream'
                        ? require('./api/4casters-stream.js')
                        : path === '/api/live-trading-desk'
                          ? require('./api/live-trading-desk.js')
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
