import { writeFileSync } from 'node:fs';
// 駒生成の「精度」と「効率」を、決まった単語の組で測るスクリプト（キャッシュには保存しない）
// 実行: npm run eval:generation [-- 単語1 単語2 ...]
//   CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（Workers AI の REST API）を使う。
// 測るもの（1語ずつ）:
//   - 形式: JSON として読めたか / 移動範囲・見た目が正しい形か
//   - 能力: AIが書いた能力・効果のうち、ゲームのルールに合わず捨てられた割合
//   - 発動: 補正後の能力を盤面で発動させて、実際に盤面が変わるか
//   - 一致: 説明文で約束した効果（「消す」「凍らせる」など）が、能力に実際に入っているか
//   - 効率: 入力・出力トークン数と所要時間
import { configuredProviders, generatePieces } from '../api/_lib/generator.js';
import { buildPrompt } from '../api/_lib/prompt.js';
import { normalizeAbilityPrograms } from '../shared/abilityProgram.js';
import type { Board, Piece } from '../src/types';

(globalThis as { localStorage?: unknown }).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { sanitizePieceData } = await import('../src/aiGenerator');
const { initializeBoard, applyAutomatedEffect, drainTilePlacements } = await import('../src/gameLogic');

const DEFAULT_WORDS = [
  '消しゴム', '満員電車', '猫×新幹線', '宿題', '雷', '忍者', '冷蔵庫', '月曜日', 'ブラックホール', '二度寝',
  '借金', '花粉症', '自動ドア', '既読無視', 'クラゲ', '蚊', '鏡', 'ガチャ', '筋肉', '迷子',
  '台風×猫', 'ラスボス', 'Wi-Fi', '天気予報',
];

// 説明文の言葉 → それを実現する効果。説明文に出てきたのに能力に無ければ「不一致」
const PROMISES: { words: RegExp; ops: string[]; label: string }[] = [
  { label: '消す', words: /消し去|消滅させ|敵を消|駒を消|抹消|葬|無へと還|存在を消/, ops: ['DESTROY', 'DOOM', 'CAPTURE'] },
  { label: '奪う', words: /奪い取|持ち駒を奪|寝返|操る|操り|味方にする/, ops: ['CONTROL', 'STEAL_HAND', 'CAPTURE'] },
  { label: '止める', words: /凍|封じ|動けな|止め|麻痺|痺れ|眠ら/, ops: ['FREEZE', 'STUN', 'SILENCE'] },
  { label: '押す', words: /押し|吹き飛|弾き|突き飛/, ops: ['PUSH'] },
  { label: '引く', words: /引き寄せ|吸い込|引きずり/, ops: ['PULL'] },
  { label: '壁', words: /壁|塞/, ops: ['WALL'] },
  { label: '分身', words: /分身|増殖|仲間を呼|召喚/, ops: ['SPAWN'] },
  { label: '地形', words: /罠|地形|炎上|ぬかるみ|水たまり|残す|置き土産/, ops: ['TILE', 'WALL', 'SPAWN'] },
  { label: '守る', words: /守|盾|防ぐ|防御/, ops: ['SHIELD', 'GUARD', 'CLEANSE', 'WALL'] },
  { label: '隠れる', words: /隠れ|姿を消|潜む|透明/, ops: ['STEALTH'] },
  { label: '移動', words: /瞬間移動|ワープ|入れ替/, ops: ['TELEPORT', 'SWAP'] },
  { label: '歩兵化', words: /歩兵に|歩兵へ/, ops: ['TRANSFORM_PAWN'] },
  { label: '連続行動', words: /もう一度|二度動|連続/, ops: ['EXTRA_ACTION'] },
];

function simulate(piece: Piece): boolean[] {
  const template = initializeBoard();
  const pawn = template[6][0]!;
  const board: Board = Array.from({ length: 9 }, () => Array(9).fill(null));
  board[8][0] = { ...template[8][4]!, id: 'sk' };
  board[0][8] = { ...template[0][4]!, id: 'gk' };
  board[4][4] = piece;
  for (const [y, x] of [[3, 3], [3, 4], [3, 5], [4, 3], [4, 5], [2, 4], [1, 4], [7, 7]]) board[y][x] = { ...pawn, id: `e${y}${x}`, owner: 'gote', isPawn: false };
  board[5][4] = { ...pawn, id: 'ally', owner: 'sente', isPawn: false };
  const triggers = [...new Set((piece.abilities ?? []).map(a => (a.trigger === 'EVERY_N_TURNS' ? 'TURN_START' : a.trigger)))];
  return (triggers as Parameters<typeof applyAutomatedEffect>[2][]).map(trigger => {
    const b = board.map(r => [...r]);
    const isTrap = trigger === 'ON_TAKEN';
    if (isTrap) b[4][4] = { ...pawn, id: 'attacker', owner: 'gote', isPawn: false };
    const before = JSON.stringify(b);
    drainTilePlacements();
    const res = applyAutomatedEffect(b, [4, 4], trigger, 'sente', [], [5, 4], undefined, [], [], undefined, isTrap ? piece : undefined, [{ ...pawn, id: 'h1', owner: 'gote' }]);
    return !!res.triggered && (JSON.stringify(res.board) !== before || res.capturedPieces.length > 0
      || (res.opponentCapturedPieces?.length ?? 1) !== 1 || drainTilePlacements().length > 0 || !!res.reAction);
  });
}

interface Row {
  word: string;
  ok: boolean;
  seconds: number;
  abilitiesRaw: number;
  abilitiesKept: number;
  effectsRaw: number;
  effectsKept: number;
  fired: number;
  triggers: number;
  broken: string[];
  name: string;
  /** 盤面を大きく動かす部品（必殺技）を持っているか */
  signature: boolean;
  ops: string[];
}

const SIGNATURE_OPS = new Set(['DESTROY', 'CAPTURE', 'CONTROL', 'SWAP', 'TELEPORT', 'SPAWN', 'WALL', 'EXTRA_ACTION', 'TRANSFORM_PAWN', 'STEAL_HAND']);

const words = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_WORDS;
const providers = configuredProviders();
if (providers.length === 0) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN are not set');
console.log(`モデル: ${providers[0].name} / プロンプト ${buildPrompt(['x']).length} 文字 / ${words.length} 語\n`);

const rows: Row[] = [];
// EVAL_SAVE=ファイル で、生成した駒をそのまま保存する（npm run simulate の EXTRA_POOL で対局させられる）
const saved: Record<string, unknown>[] = [];
const CONCURRENCY = 3;
for (let i = 0; i < words.length; i += CONCURRENCY) {
  await Promise.all(words.slice(i, i + CONCURRENCY).map(async word => {
    const started = Date.now();
    try {
      const { pieces } = await generatePieces([word], providers);
      const raw = pieces[0] as Record<string, unknown>;
      saved.push(structuredClone(raw));
      const seconds = (Date.now() - started) / 1000;
      const rawAbilities = Array.isArray(raw.abilities) ? raw.abilities as { effects?: unknown[] }[] : [];
      const kept = normalizeAbilityPrograms(structuredClone(raw.abilities)) ?? [];
      const piece: Piece = { ...sanitizePieceData(structuredClone(raw), word), id: 'me', owner: 'sente', isKing: false, isPawn: false, originalPosition: null, coolDownTurnsRemaining: 0, isRevealed: true, isPromoted: false };
      const fired = simulate(piece);
      const ops = new Set(kept.flatMap(a => a.effects.map(e => e.op as string)));
      const text = String(raw.description ?? '');
      const broken = PROMISES.filter(p => p.words.test(text) && !p.ops.some(op => ops.has(op))).map(p => p.label);
      rows.push({
        word, ok: true, seconds, name: String(raw.effect_name ?? ''),
        abilitiesRaw: rawAbilities.length, abilitiesKept: kept.length,
        effectsRaw: rawAbilities.reduce((n, a) => n + (Array.isArray(a.effects) ? a.effects.length : 0), 0),
        effectsKept: kept.reduce((n, a) => n + a.effects.length, 0),
        fired: fired.filter(Boolean).length, triggers: fired.length, broken,
        ops: [...ops],
        signature: kept.some(a => a.effects.some(e => SIGNATURE_OPS.has(e.op) || ((e.op === 'PUSH' || e.op === 'PULL') && (e.value ?? 1) >= 2))),
      });
    } catch (err) {
      rows.push({ word, ok: false, seconds: (Date.now() - started) / 1000, name: (err as Error).message.slice(0, 60), abilitiesRaw: 0, abilitiesKept: 0, effectsRaw: 0, effectsKept: 0, fired: 0, triggers: 0, broken: [], ops: [], signature: false });
    }
  }));
}

rows.sort((a, b) => words.indexOf(a.word) - words.indexOf(b.word));
if (process.env.EVAL_SAVE) writeFileSync(process.env.EVAL_SAVE, JSON.stringify(saved));
for (const r of rows) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.word.padEnd(8, '　')} 《${r.name}》 ${r.seconds.toFixed(1)}秒 能力${r.abilitiesKept}/${r.abilitiesRaw} 効果${r.effectsKept}/${r.effectsRaw} 発動${r.fired}/${r.triggers} ${r.signature ? '★' : '　'}${r.ops.join(',')}${r.broken.length ? ' 不一致:' + r.broken.join('・') : ''}`);
}
const ok = rows.filter(r => r.ok);
const sum = (f: (r: Row) => number) => ok.reduce((n, r) => n + f(r), 0);
console.log(`
■ 集計（${ok.length}/${rows.length} 語が生成できた）
  能力が残った割合      ${(100 * sum(r => r.abilitiesKept) / Math.max(1, sum(r => r.abilitiesRaw))).toFixed(0)}%
  効果が残った割合      ${(100 * sum(r => r.effectsKept) / Math.max(1, sum(r => r.effectsRaw))).toFixed(0)}%
  盤面で発動した割合    ${(100 * sum(r => r.fired) / Math.max(1, sum(r => r.triggers))).toFixed(0)}%（条件・確率・対象なしで不発のものを含む）
  説明文と能力の不一致  ${ok.filter(r => r.broken.length).length}/${ok.length} 語
  必殺技（★）がある駒  ${ok.filter(r => r.signature).length}/${ok.length} 語
  STUN を使う駒        ${ok.filter(r => r.ops.includes('STUN')).length}/${ok.length} 語
  使われた部品の種類    ${new Set(ok.flatMap(r => r.ops)).size} 種類
  平均時間              ${(sum(r => r.seconds) / Math.max(1, ok.length)).toFixed(1)}秒`);
