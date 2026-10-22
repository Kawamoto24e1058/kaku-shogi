// 本物のAIで駒を生成して品質を確認するスクリプト（キャッシュには保存しない）
// 実行: npm run try:generate -- 猫 新幹線 ラーメン
//   .env.local の CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（または他のプロバイダ設定）を読む。
// 表示するもの: 使ったモデル・所要時間・能力名・説明文・実行されるアクション・不発になる要素の有無
import { readFileSync, existsSync } from 'node:fs';
import { configuredProviders, generatePieces } from '../api/_lib/generator.js';
import { pieceHasNgText } from '../shared/moderation.js';
import { SUPPORTED_ACTIONS, AREA_SHAPES } from '../shared/abilityCatalog.js';

for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const words = process.argv.slice(2);
if (words.length === 0) {
  console.error('使い方: npm run try:generate -- 単語1 単語2 ...');
  process.exit(1);
}

const providers = configuredProviders();
console.log(`プロバイダ: ${providers.map(p => p.name).join(' → ') || '(未設定)'}`);

const supported = new Set<string>(SUPPORTED_ACTIONS);
const shapes = new Set<string>(AREA_SHAPES);
const started = Date.now();
const { pieces, provider } = await generatePieces(words, providers);
console.log(`使用モデル: ${provider} / ${((Date.now() - started) / 1000).toFixed(1)}秒 / ${words.length}語\n`);

for (const [i, piece] of pieces.entries()) {
  if (!piece) {
    console.log(`■ ${words[i]}: 生成されませんでした\n`);
    continue;
  }
  const spec = (piece.ability_spec || {}) as Record<string, unknown>;
  const actions = (Array.isArray(spec.actions) ? spec.actions : [spec.effect_type]).map(String);
  const problems = [
    ...actions.filter(a => !supported.has(a)).map(a => `未対応アクション ${a}`),
    ...(spec.area_shape && !shapes.has(String(spec.area_shape)) ? [`未対応の範囲 ${spec.area_shape}`] : []),
    ...(pieceHasNgText(piece) ? ['NGワードを含む'] : []),
  ];
  const grid = (piece.range_geometry as Record<string, unknown> | undefined)?.normal_grid;
  console.log(`■ ${words[i]} 《${piece.effect_name}》 ${piece.ability_genre ?? ''}`);
  console.log(`  ${String(piece.description ?? '').replace(/\n/g, '\n  ')}`);
  console.log(`  発動: ${spec.activation_trigger} / 範囲: ${spec.area_shape} / アクション: ${actions.join(' + ')} / 移動: ${piece.logic_code} ${grid ?? ''}`);
  console.log(`  ${problems.length ? '⚠ ' + problems.join(', ') : '✓ エンジンで実行可能'}\n`);
}
