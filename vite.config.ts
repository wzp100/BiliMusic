import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import { builtinModules } from 'module'
import path from 'path'

// 主进程需外部化的运行时依赖：含动态 require / 读取自身资源，不能被 esbuild 打进 main.js，
// 由 electron-builder 以生产依赖纳入包内。
const electronExternals = [
  'electron',
  'electron-updater',
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]

export default defineConfig({
  plugins: [
    {
      name: 'bili-media-proxy',
      configureServer(server) {
        server.middlewares.use('/bili-media', async (req, res) => {
          try {
            const requestUrl = new URL(req.url || '', 'http://localhost')
            const target = requestUrl.searchParams.get('url')
            if (!target || !/^https:\/\/[^/]+\/.+/.test(target)) {
              res.statusCode = 400
              res.end('Missing media url')
              return
            }

            const upstream = await fetch(target, {
              headers: {
                Referer: 'https://www.bilibili.com',
                Origin: 'https://www.bilibili.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                ...(req.headers.range ? { Range: req.headers.range } : {}),
              },
            })

            res.statusCode = upstream.status
            ;['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach((header) => {
              const value = upstream.headers.get(header)
              if (value) res.setHeader(header, value)
            })

            if (!upstream.body) {
              res.end()
              return
            }

            const reader = upstream.body.getReader()
            const pump = async (): Promise<void> => {
              const { done, value } = await reader.read()
              if (done) {
                res.end()
                return
              }
              res.write(value)
              await pump()
            }
            await pump()
          } catch (error) {
            res.statusCode = 502
            res.end(error instanceof Error ? error.message : 'Media proxy failed')
          }
        })
      },
    },
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: electronExternals,
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/bili-api': {
        target: 'https://api.bilibili.com',
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: '',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'https://www.bilibili.com')
            proxyReq.setHeader('Referer', 'https://www.bilibili.com')
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
          })
        },
        rewrite: (p) => p.replace(/^\/bili-api/, ''),
      },
      '/bili-passport': {
        target: 'https://passport.bilibili.com',
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: '',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'https://passport.bilibili.com')
            proxyReq.setHeader('Referer', 'https://passport.bilibili.com/login')
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
          })
        },
        rewrite: (p) => p.replace(/^\/bili-passport/, ''),
      },
      '/bili-image': {
        target: 'https://i0.hdslb.com',
        changeOrigin: true,
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const rawUrl = req.url || ''
            const upstream = rawUrl.replace(/^\/bili-image\/https?:\/([^/]+)\//, 'https://$1/')
            const parsed = new URL(upstream)
            proxyReq.setHeader('Host', parsed.host)
            proxyReq.setHeader('Origin', 'https://www.bilibili.com')
            proxyReq.setHeader('Referer', 'https://www.bilibili.com')
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
            proxyReq.path = parsed.pathname + parsed.search
          })
        },
        rewrite: (p) => p,
      },
    },
  },
})
