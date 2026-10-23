// ビルド後に、ブラウザへ配信するファイル（dist/）に秘密の値が紛れ込んでいないかを調べる。
// 見つかったらビルドを失敗させる（Vercel でもデプロイが止まる）。npm run build の最後に実行される。
// 1. Google の API キーの形（AIza で始まる39文字）
// 2. その他よくある秘密の形（OpenAI 風の sk-、秘密鍵の PEM）と、ブラウザから Gemini を直接呼ぶコード
// 3. ビルド時の環境変数にあるサーバー専用の値そのもの（GEMINI_API_KEY など。値が8文字以上のときだけ）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const SERVER_ONLY_VARS = [
  'GEMINI_API_KEY', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_SERVER_TOKEN', 'CRON_SECRET', 'FALLBACK_LLM_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'FIREBASE_SERVICE_ACCOUNT',
];
const PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'secret key (sk-...)', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  // キーを分割して埋め込むと形では見つけられないので、「ブラウザから Gemini を直接呼んでいる」こと自体を禁止する
  { name: 'ブラウザから Gemini API を直接呼ぶコード（キーが必要になるので必ず漏れる）', re: /generativelanguage\.googleapis\.com/ },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(js|mjs|css|html|json|map|txt|webmanifest)$/.test(name)) yield path;
  }
}

const secrets = SERVER_ONLY_VARS
  .map(name => [name, process.env[name]])
  .filter(([, value]) => typeof value === 'string' && value.length >= 8);

const problems = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  for (const { name, re } of PATTERNS) if (re.test(text)) problems.push(`${file}: ${name} のような文字列`);
  for (const [name, value] of secrets) if (text.includes(value)) problems.push(`${file}: 環境変数 ${name} の値`);
}

if (problems.length > 0) {
  console.error('\n[check-bundle-secrets] ブラウザに配信するファイルに秘密の値が含まれています。デプロイを中止します。');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('サーバー専用の値は VITE_ を付けない環境変数に置き、api/ の関数からだけ読んでください。\n');
  process.exit(1);
}
console.log(`[check-bundle-secrets] OK（${DIST}/ に秘密の値は見つかりませんでした）`);
