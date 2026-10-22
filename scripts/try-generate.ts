// 本物のAIで駒を生成して品質を確認するスクリプト（キャッシュには保存しない）
// 実行: npm run try:generate -- 猫 新幹線 ラーメン
//   .env.local の CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（または他のプロバイダ設定）を読む。
// 表示するもの: 使ったモデル・所要時間・能力名・説明文・実行されるアクション・
//               補正後の駒を実際の盤面で発動させたときに効果が出るか
import { readFileSync, existsSync } from 'node:fs';
import { configuredProviders, generatePieces } from '../api/_lib/generator.js';
import { pieceHasNgText } from '../shared/moderation.js';
import { SUPPORTED_ACTIONS, AREA_SHAPES } from '../shared/abilityCatalog.js';

// src 側（ゲームエンジン）はブラウザ前提なので、localStorage を用意してから読み込む
(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { sanitizePieceData } = await import('../src/aiGenerator');
const { initializeBoard, applyAutomatedEffect } = await import('../src/gameLogic');

/** 補正後の駒を盤の中央に置き、周りに敵味方を並べて能力を発動させ、盤面が変わるかを見る */
function simulate(raw: Record<string, unknown>, word: string): string {
  const template = initializeBoard();
  const pawn = template[6][0]!;
  const piece = { ...sanitizePieceData(structuredClone(raw), word), id: 'me', owner: 'sente', isKing: false, isPawn: false, originalPosition: null, coolDownTurnsRemaining: 0, isRevealed: true, isPromoted: false } as any;
  const board: any[][] = Array.from({ length: 9 }, () => Array(9).fill(null));
  board[8][0] = { ...template[8][4], id: 'sk' };
  board[0][8] = { ...template[0][4], id: 'gk' };
  board[4][4] = piece;
  for (const [y, x] of [[3, 3], [3, 4], [3, 5], [4, 3], [4, 5], [2, 4], [1, 4], [7, 7]]) board[y][x] = { ...pawn, id: `e${y}${x}`, owner: 'gote', isPawn: false };
  board[5][4] = { ...pawn, id: 'ally', owner: 'sente', isPawn: false };
  const trigger = piece.custom_ability?.triggers?.[0] === 'ALWAYS' ? 'TURN_START' : (piece.custom_ability?.triggers?.[0] ?? 'ON_MOVE');
  const isTrap = trigger === 'ON_TAKEN';
  if (isTrap) board[4][4] = { ...pawn, id: 'attacker', owner: 'gote', isPawn: false };
  const before = JSON.stringify(board);
  const res = applyAutomatedEffect(board, [4, 4], trigger, 'sente', [], [5, 4], undefined, [], [], undefined, isTrap ? piece : undefined, [{ ...pawn, id: 'h1', owner: 'gote' }]);
  const changed = JSON.stringify(res.board) !== before || res.capturedPieces.length > 0 || (res.opponentCapturedPieces?.length ?? 1) !== 1;
  return res.triggered && changed ? `✓ 盤面で効果あり（${trigger}）` : `⚠ 盤面で効果なし（${trigger} / ${piece.custom_ability?.targets} / ${piece.custom_ability?.actions}）`;
}

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
  console.log(`  ${problems.length ? '⚠ ' + problems.join(', ') : '✓ 対応アクションのみ'} / ${simulate(piece, words[i])}\n`);
}
