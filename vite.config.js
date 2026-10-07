import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const LOCAL_API_HANDLERS = {
  '/api/betstamp-markets': './api/betstamp-markets.js',
  '/api/betstamp-stream': './api/betstamp-stream.js',
  '/api/underdog-predict': './api/underdog-predict.js',
  '/api/polymarket-stream': './api/polymarket-stream.js',
  '/api/polymarket-board': './api/polymarket-board.js',
  '/api/kalshi-stream': './api/kalshi-stream.js',
  '/api/kalshi-board': './api/kalshi-board.js',
  '/api/novig-stream': './api/novig-stream.js',
  '/api/4casters-stream': './api/4casters-stream.js',
  '/api/live-trading-desk': './api/live-trading-desk.js',
  '/api/player-td-board': './api/player-td-board.js',
  '/api/scan-ev-parlays': './api/scan-ev-parlays.js',
  '/api/fetch-player-props': './api/fetch-player-props.js',
}

function attachLocalApi(middlewares) {
  middlewares.use(async (req, res, next) => {
    const url = req.url || ''
    const path = url.split('?')[0]
    const handlerPath = LOCAL_API_HANDLERS[path]
    if (!handlerPath) return next()
    try {
      if (path === '/api/live-trading-desk' && req.method === 'POST') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks).toString('utf8')
        try { req.body = raw ? JSON.parse(raw) : {} } catch { req.body = {} }
      }
      const handler = require(handlerPath)
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
}

function betstampLocalApi() {
  return {
    name: 'betstamp-local-api',
    configureServer(server) {
      attachLocalApi(server.middlewares)
    },
    configurePreviewServer(server) {
      attachLocalApi(server.middlewares)
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
