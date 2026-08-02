import { defineConfig, type Plugin } from 'vite'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))
// 変換パイプラインの成果物（tileset.json と GLB）はリポジトリ直下 3dtiles/ にある。
const TILES_DIR = resolve(rootDir, '..', '3dtiles')

const MIME: Record<string, string> = {
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.b3dm': 'application/octet-stream',
  '.pnts': 'application/octet-stream',
}

/**
 * 開発サーバーで ../3dtiles を /3dtiles として配信するミドルウェア。
 * 数 GB になりうる成果物を viewer/public/ に複製したくないため、参照だけで済ませる。
 * 本番では tileset を任意の静的ホストへ置き、VITE_TILESET_URL か ?tileset= で差す。
 */
function tilesDevServer(): Plugin {
  return {
    name: '3dtiles-dev-server',
    configureServer(server) {
      server.middlewares.use('/3dtiles', (req, res, next) => {
        try {
          const urlPath = decodeURIComponent((req.url ?? '').split('?')[0])
          const rel = normalize(urlPath).replace(/^([/\\]|\.\.[/\\])+/, '')
          const file = join(TILES_DIR, rel)
          // ディレクトリトラバーサル防止
          if (!file.startsWith(TILES_DIR) || !existsSync(file) || !statSync(file).isFile()) {
            res.statusCode = 404
            res.end('Not found')
            return
          }
          res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
          res.setHeader('Content-Length', String(statSync(file).size))
          res.setHeader('Access-Control-Allow-Origin', '*')
          createReadStream(file).pipe(res)
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [tilesDevServer()],
  server: {
    port: 8080,
    watch: {
      // WSL2 から Windows 側（/mnt/c）のファイルを開くと inotify が発火せず、
      // ファイルを保存しても HMR が走らないうえ変換結果のキャッシュも更新されない。
      // 監視対象は viewer/ 配下だけなのでポーリングでも負荷は小さい。
      // 不要な環境では VITE_NO_POLL=1 で無効化する。
      usePolling: !process.env.VITE_NO_POLL,
      interval: 300,
    },
  },
})
