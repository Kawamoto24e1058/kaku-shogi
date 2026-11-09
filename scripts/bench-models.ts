// Workers AI のモデルごとに、1語の駒生成にかかる時間を測る（キャッシュには保存しない）
// 実行: npx tsx scripts/bench-models.ts [モデル名...]
//   CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN を使う。stream: true で最初の文字が届くまでの時間も測る
import { buildPrompt } from '../api/_lib/prompt.js';
import { extractPieces } from '../api/_lib/generator.js';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { sanitizePieceData } = await import('../src/aiGenerator');

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set');

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['@cf/google/gemma-4-26b-a4b-it'];
const words = (process.env.BENCH_WORDS || '消しゴム,満員電車,猫×新幹線').split(',');

for (const model of models) {
  for (const word of words) {
    const started = Date.now();
    let firstAt = 0;
    let text = '';
    let usage: Record<string, number> | undefined;
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPrompt([word]) }],
          response_format: { type: 'json_object' },
          temperature: 0.9,
          max_tokens: 1500,
          stream: true,
          stream_options: { include_usage: true },
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
          const data = JSON.parse(line.slice(5));
          const delta = data.choices?.[0]?.delta?.content ?? '';
          if (delta && !firstAt) firstAt = Date.now();
          text += delta;
          if (data.usage) usage = data.usage;
        }
      }
      const total = (Date.now() - started) / 1000;
      let verdict = 'ok';
      try {
        const raw = extractPieces(text)[0];
        const piece = sanitizePieceData(structuredClone(raw), word);
        verdict = `ok 《${piece.effect_name}》 能力${raw.abilities?.length ?? 0}個 ${String(piece.description ?? '').slice(0, 40)}`;
      } catch (err) {
        verdict = `NG ${(err as Error).message}`;
      }
      console.log(`${model} | ${word} | 最初の文字 ${((firstAt - started) / 1000).toFixed(1)}秒 | 完成 ${total.toFixed(1)}秒 | 入力${usage?.prompt_tokens ?? '?'} 出力${usage?.completion_tokens ?? '?'} | ${verdict}`);
    } catch (err) {
      console.log(`${model} | ${word} | 失敗 ${(err as Error).message}`);
    }
  }
}
