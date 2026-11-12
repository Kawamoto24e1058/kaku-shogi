// 少数の単語で実際に AI に駒を作らせ、移動の型・移動の特徴・性質・能力・総合力がキャラに合っているかを見る（キャッシュには保存しない）
// 実行: npx tsx scripts/try-words.ts 単語1 単語2 ...（Workers AI の REST API: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN）
// AI の利用枠を使うので、少ない単語数で使う
import { configuredProviders, generatePieces } from '../api/_lib/generator.js';
import { MOVE_STYLE_SPECS, MOVE_EXTRA_SPECS, type MoveStyle } from '../shared/moveStyles.js';
import { pieceStrength } from '../shared/pieceBudget.js';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { sanitizePieceData } = await import('../src/aiGenerator');

const words = process.argv.slice(2);
if (!words.length) throw new Error('単語を指定してください');
const providers = configuredProviders();
if (!providers.length) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set');

const grid = (g: string | undefined) => {
  const s = (g ?? '').replace(/\//g, '');
  return [0, 1, 2, 3, 4].map(r => '    ' + [...s.slice(r * 5, r * 5 + 5)].map(c => (c === '2' ? '駒' : c === '1' ? '■' : '・')).join('')).join('\n');
};

for (const word of words) {
  const started = Date.now();
  try {
    const { pieces } = await generatePieces([word], providers);
    const raw = pieces[0] as Record<string, unknown>;
    const p = sanitizePieceData(structuredClone(raw), word);
    const st = pieceStrength(p);
    const rawExtra = raw.move_extra as { kind?: string; range?: number } | null | undefined;
    console.log(`\n■ ${word}（${((Date.now() - started) / 1000).toFixed(1)}秒）《${p.effect_name}》`);
    console.log(`  読み解き: ${String(raw.deep_search_analysis ?? '').slice(0, 90)}`);
    console.log(`  移動の型: ${raw.move_style ?? '（なし）'}${p.move_style ? ` = ${MOVE_STYLE_SPECS[p.move_style as MoveStyle].label}` : ''}`);
    console.log(`  移動の特徴: AI=${rawExtra ? `${rawExtra.kind}:${rawExtra.range ?? ''}` : 'なし'} → 調整後=${p.move_extra ? `${MOVE_EXTRA_SPECS[p.move_extra.kind].label}${p.move_extra.range ? ` 最大${p.move_extra.range}` : ''}` : 'なし'}`);
    console.log(grid(p.range_geometry?.normal_grid));
    console.log(`  性質: ${p.trait?.kind ?? 'なし'}`);
    console.log(`  総合力: 移動${st.move} 能力${st.ability.toFixed(1)} 性質${st.trait} → ${st.total}`);
    console.log(`  ${String(p.rules_text ?? '').replace(/\n/g, '\n  ')}`);
  } catch (err) {
    console.log(`\n■ ${word}: 失敗 ${(err as Error).message.slice(0, 120)}`);
  }
}
