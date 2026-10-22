import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run dev` でも /api/* (Vercel Functions) をそのまま動かすための開発用ミドルウェア。
// 本番では Vercel が api/ ディレクトリを関数としてデプロイするので、このプラグインは使われない。
function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/([\w-]+)/);
        if (!match) return next();
        try {
          const mod = await server.ssrLoadModule(`/api/${match[1]}.ts`);
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v);
          }
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          });
          const response: Response = await mod.default.fetch(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.ssrFixStacktrace(err as Error);
          next(err);
        }
      });
    },
  }
}

// ビルド時に HTML へ埋め込む値。
// - __SITE_URL__ : OGP の画像URLは絶対URLでないと X に表示されないため、公開URLを埋め込む
//                  （VITE_SITE_URL > Vercel が自動で渡す本番ドメイン の順）
// - __CONTACT_URL__ / __OPERATOR_NAME__ / __LEGAL_UPDATED__ : 利用規約・プライバシーポリシー用
function htmlPlaceholders(values: Record<string, string>): Plugin {
  return {
    name: 'html-placeholders',
    transformIndexHtml: html =>
      Object.entries(values).reduce((out, [key, value]) => out.replaceAll(key, value), html),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // サーバー用の秘密値（GEMINI_API_KEY 等）を開発時だけ process.env に流し込む。
  // VITE_ 接頭辞が無いのでクライアントのバンドルには含まれない。
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
  const siteUrl = (process.env.VITE_SITE_URL || (vercelHost ? `https://${vercelHost}` : '')).replace(/\/$/, '')
  const contactUrl = process.env.VITE_CONTACT_URL || ''
  if (mode === 'production' && !contactUrl) {
    console.warn('[kaku-shogi] VITE_CONTACT_URL が未設定です。利用規約・プライバシーポリシーの問い合わせ先が空になります。')
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      devApi(),
      htmlPlaceholders({
        __SITE_URL__: siteUrl,
        __CONTACT_URL__: contactUrl || '#',
        __OPERATOR_NAME__: process.env.VITE_OPERATOR_NAME || '架空将棋 運営者',
        __LEGAL_UPDATED__: process.env.VITE_LEGAL_UPDATED || '2026年10月22日',
      }),
    ],
    build: {
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          main: 'index.html',
          terms: 'terms.html',
          privacy: 'privacy.html',
        },
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'react-vendor';
            }
          },
        },
      },
    },
  }
})
