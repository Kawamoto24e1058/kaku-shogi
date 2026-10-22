import type { PieceData } from './types';
import { AREA_SHAPES, normalizeActions } from '../shared/abilityCatalog';
import { buildOfflinePiece } from './offlineGenerator';
import { wordKey } from '../shared/wordKey';
import { containsNgWord } from '../shared/moderation';
import { normalizeAbilityPrograms, describeAbilities, normalizeAppearance } from '../shared/abilityProgram';
import { normalizeFusionWord } from '../shared/challenge';

const AREA_SHAPE_SET = new Set<string>(AREA_SHAPES);
// 対象マスではなく発動した駒自身に作用するアクション（範囲が自分のマスだけでも効果が出る）
const SELF_ACTIONS = new Set<string>([
  'STEALTH_ON', 'SHIELD_GAIN', 'GUARD_STANCE', 'OVERDRIVE_BOOST', 'GRAVITY_PULL', 'STEAL_HAND', 'BOOMERANG',
  'EVOLUTION', 'EVOLUTION_CHECK', 'CLEAR_DEBUFF', 'LUCKY_DODGE', 'RE_ACTION', 'LEAVE_TRAIL_FIRE', 'CHARGE_TURN',
  'SACRIFICE_COST', 'SELF_STUN', 'DELAYED_BURST',
]);

// キャッシュ用インメモリマップおよび localStorage との連携
const memoryCache = new Map<string, PieceData>();

// バージョン管理されたワンタイムキャッシュクリーンアップ（v4にアップデートして古いキャッシュを全消去）
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const CURRENT_VERSION = 'v9';
    const activeVersion = localStorage.getItem('shogi_cache_version');
    if (activeVersion !== CURRENT_VERSION) {
      localStorage.removeItem('shogi_piece_cache');
      localStorage.setItem('shogi_cache_version', CURRENT_VERSION);
      console.info('Successfully cleared outdated localStorage piece cache to align with new system prompt safeguards.');
    }
  }
} catch (e) {
  console.warn('Failed to clean up localStorage cache:', e);
}

function getCacheKey(word: string): string {
  return wordKey(word);
}

function saveToCache(word: string, data: PieceData) {
  const key = getCacheKey(word);
  memoryCache.set(key, data);
  try {
    const cachedData = localStorage.getItem('shogi_piece_cache');
    const cacheObj = cachedData ? JSON.parse(cachedData) : {};
    cacheObj[key] = data;
    localStorage.setItem('shogi_piece_cache', JSON.stringify(cacheObj));
  } catch (e) {
    console.warn('Failed to save piece to localStorage cache:', e);
  }
}

/** この端末のキャッシュから単語の駒を消す（報告した駒を二度と出さないため） */
export function forgetCachedPiece(word: string): void {
  const key = getCacheKey(normalizeFusionWord(word.trim()));
  memoryCache.delete(key);
  try {
    const cachedData = localStorage.getItem('shogi_piece_cache');
    if (!cachedData) return;
    const cacheObj = JSON.parse(cachedData);
    delete cacheObj[key];
    localStorage.setItem('shogi_piece_cache', JSON.stringify(cacheObj));
  } catch (e) {
    console.warn('Failed to remove piece from localStorage cache:', e);
  }
}

function getFromCache(word: string): PieceData | null {
  const key = getCacheKey(word);
  if (memoryCache.has(key)) {
    const raw = memoryCache.get(key);
    return raw ? sanitizePieceData(raw, word) : null;
  }
  try {
    const cachedData = localStorage.getItem('shogi_piece_cache');
    if (cachedData) {
      const cacheObj = JSON.parse(cachedData);
      if (cacheObj[key]) {
        const sanitized = sanitizePieceData(cacheObj[key], word);
        memoryCache.set(key, sanitized);
        return sanitized;
      }
    }
  } catch (e) {
    console.warn('Failed to read piece from localStorage cache:', e);
  }
  return null;
}

export async function decrementCacheUses(word: string): Promise<void> {
  const piece = getFromCache(word);
  if (piece) {
    const nextUses = Math.max(0, (piece.remaining_uses !== undefined ? piece.remaining_uses : 3) - 1);
    piece.remaining_uses = nextUses;
    if (piece.custom_ability) {
      piece.custom_ability.remaining_uses = nextUses;
    }
    saveToCache(word, piece);
  }
}

/**
 * この端末のローカルキャッシュを消去する。
 * 共有キャッシュ（Supabase）はサーバーのみが書き込めるため、クライアントからは消去しない
 * （以前は誰でも全員分の駒データを削除できてしまっていた）。
 */
export async function clearAllCustomPieceCache(): Promise<number> {
  let count = memoryCache.size;
  memoryCache.clear();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem('shogi_piece_cache');
      if (raw) count = Math.max(count, Object.keys(JSON.parse(raw)).length);
      localStorage.removeItem('shogi_piece_cache');
    }
  } catch (e) {
    console.warn('Failed to clear localStorage piece cache:', e);
  }
  return count;
}

/**
 * AIが使えないときの簡易生成（src/offlineGenerator.ts）。
 * 説明文と実際の効果が一致する、エンジンで動作確認済みの能力型から組み立てる。
 * 簡易生成の結果はキャッシュしない（後でAI生成が使えるようになったときに上書きを妨げないため）。
 */
export function generateOfflinePiece(word: string): PieceData {
  const cached = getFromCache(word);
  if (cached) return cached;
  return sanitizePieceData(buildOfflinePiece(word), word);
}

export type PieceSource = 'cache' | 'ai' | 'similar' | 'offline' | 'blocked';

export interface GeneratedPiece {
  piece: PieceData;
  source: PieceSource;
  notice?: string;
}

const API_ENDPOINT = '/api/generate-piece';

/** 駒作成画面を開いた時点でサーバー関数を起こしておき、最初の生成のコールドスタートを隠す */
export function warmUpGenerator(): void {
  fetch(API_ENDPOINT, { method: 'GET' }).catch(() => undefined);
}

/**
 * 単語から駒を生成する。
 * AIサービスのキーはサーバー (api/generate-piece.ts) だけが保持し、ブラウザには一切渡さない。
 * 失敗時（上限到達・サーバー未設定など）はオフライン簡易生成にフォールバックする。
 */
export class BlockedWordError extends Error {}

export async function generatePieceWithSource(word: string): Promise<GeneratedPiece> {
  // 「猫+新幹線」などは「猫×新幹線」にそろえ、合体駒として同じキャッシュを使う
  const trimmed = normalizeFusionWord(word.trim());
  if (containsNgWord(trimmed)) throw new BlockedWordError('その単語は使えません。別の単語を入力してください。');

  // ① メモリ / localStorage キャッシュ（最速）
  const localCached = getFromCache(trimmed);
  if (localCached) return { piece: localCached, source: 'cache' };

  // ② 共有キャッシュを GET で参照。CDN にキャッシュされるので、人気の単語は関数も DB も使わずに返る
  try {
    const res = await fetch(`${API_ENDPOINT}?k=${encodeURIComponent(wordKey(trimmed))}`);
    if (res.ok) {
      const body = await res.json();
      if (body?.piece) {
        const piece = sanitizePieceData({ ...body.piece, word: trimmed }, trimmed);
        saveToCache(trimmed, piece);
        return { piece, source: 'cache' };
      }
    }
  } catch {
    // 参照に失敗しても生成リクエストへ進む
  }

  // ③ サーバーで生成（共有キャッシュ → AI → 近い単語の流用 の順に処理される）
  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: trimmed }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.piece) {
      const piece = sanitizePieceData(body.piece, trimmed);
      if (body.source === 'similar') {
        // 近い単語の流用は仮のもの。後でAI版が登録されるので端末にはキャッシュしない
        return { piece, source: 'similar', notice: body.notice };
      }
      saveToCache(trimmed, piece);
      return { piece, source: body.source === 'cache' ? 'cache' : 'ai' };
    }
    if (body?.blocked) throw new BlockedWordError(body.error);
    const notice = body?.error || `AI生成サーバーが応答しませんでした (${res.status})`;
    return { piece: generateOfflinePiece(trimmed), source: 'offline', notice };
  } catch (error) {
    if (error instanceof BlockedWordError) throw error;
    console.error('[generate-piece] request failed:', error);
    return {
      piece: generateOfflinePiece(trimmed),
      source: 'offline',
      notice: 'AI生成サーバーに接続できなかったため、簡易生成で作成しました。',
    };
  }
}

/** 互換用: 駒データだけを返す */
export async function generatePieceFromWord(word: string): Promise<PieceData> {
  return (await generatePieceWithSource(word)).piece;
}

// localStorage のキャッシュをメモリに一括ロード
function loadCacheFromStorage(): PieceData[] {
  try {
    const raw = localStorage.getItem('shogi_piece_cache');
    if (!raw) return [];
    const obj = JSON.parse(raw) as Record<string, PieceData>;
    const pieces = Object.values(obj);
    // メモリキャッシュにも同期
    Object.entries(obj).forEach(([k, v]) => memoryCache.set(k, v));
    return pieces;
  } catch {
    return [];
  }
}

// フォールバック用ワードリスト（キャッシュが足りないとき用）
const FALLBACK_AI_WORDS = [
  '賢い人間', '訓練された猟犬', '防護プレート', '延焼ダイナマイト',
  '鉄の意志', '幻の刃', '黒い霧', '雷の速度',
  '鋼の盾', '魔法使い', '炎の矢', '時間の歪み',
  '暗殺者', '聖騎士', '毒蜘蛛', '嵐の使者',
];

/**
 * キャッシュ済み駒からランダムに count 枚取得する。
 * キャッシュが足りない場合はオフライン生成でフォールバック。
 */
export function getRandomCachedPieces(count: number): PieceData[] {
  const allCached = loadCacheFromStorage();

  // Fisher–Yates シャッフルして先頭 count 枚を取る
  const shuffled = [...allCached];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const result: PieceData[] = shuffled.slice(0, count);

  // 足りない分はフォールバックワードリストから補充
  if (result.length < count) {
    const remainingWords = [...FALLBACK_AI_WORDS].sort(() => Math.random() - 0.5);
    let wi = 0;
    while (result.length < count && wi < remainingWords.length) {
      result.push(generateOfflinePiece(remainingWords[wi++]));
    }
  }

  return result;
}

export function sanitizePieceData(parsed: any, word: string): PieceData {
  // Repair word
  if (!parsed.word || typeof parsed.word !== 'string') {
    parsed.word = word;
  }

  // Repair mechanics_type: map new 10-genre names to internal legacy names
  const mechanicsTypeMap: Record<string, string> = {
    'FORCE_CRUSH':     'MOVEMENT_HACK',
    'HACK_AND_STEAL':  'DYNAMICS_HACK',
    'STEALTH_GHOST':   'STEALTH_TRAP',
    'SUPPORT_BUFF':    'RULE_BREAK',
    'SPAWNER_BUILD':   'RULE_BREAK',
    'TRAP_MINE':       'STEALTH_TRAP',
    'AUTOMATIC_DRIVE': 'AUTOMATIC_DRIVE',
    'VIRUS_INFECT':    'DYNAMICS_HACK',
    'SPACE_WARP':      'DYNAMICS_HACK',
    'NECROMANCY':      'DYNAMICS_HACK',
    'UNKNOWN_HERESY':  'DYNAMICS_HACK'
  };
  if (parsed.mechanics_type && mechanicsTypeMap[parsed.mechanics_type]) {
    parsed.mechanics_type = mechanicsTypeMap[parsed.mechanics_type];
  }
  if (!parsed.mechanics_type || !['MOVEMENT_HACK', 'STEALTH_TRAP', 'RULE_BREAK', 'DYNAMICS_HACK', 'AUTOMATIC_DRIVE'].includes(parsed.mechanics_type)) {
    parsed.mechanics_type = 'MOVEMENT_HACK';
  }

  // Repair trigger
  if (!parsed.trigger || !['ALWAYS', 'ON_MOVE', 'TURN_START', 'ON_TAKEN', 'ON_APPROACH'].includes(parsed.trigger)) {
    parsed.trigger = 'ALWAYS';
  }

  // Repair string fields
  if (!parsed.effect_name || typeof parsed.effect_name !== 'string') {
    parsed.effect_name = '神秘の力';
  }
  if (!parsed.description || typeof parsed.description !== 'string') {
    parsed.description = '神秘の効果。';
  }
  if (!parsed.deep_search_analysis || typeof parsed.deep_search_analysis !== 'string') {
    parsed.deep_search_analysis = '神秘の能力。';
  }

  // --- Safeguard 1: Prevent unintended invisibility ---
  // If a piece is categorized as STEALTH_TRAP but has no stealth/trap keywords in its description,
  // downgrade its mechanics_type to DYNAMICS_HACK.
  if (parsed.mechanics_type === 'STEALTH_TRAP') {
    const desc = parsed.description || '';
    const hasStealthKeywords = [
      'ステルス', '隠密', '罠', '地雷', '落とし穴', '裏向き', '潜伏', 
      '気配', '透明', '隠れる', '隠蔽', '身代わり'
    ].some(kw => desc.includes(kw));
    
    if (!hasStealthKeywords) {
      parsed.mechanics_type = 'DYNAMICS_HACK';
    }
  }

  // --- Safeguard 2: Align logic_code and trigger for autonomous (AUTOMATIC_DRIVE) pieces ---
  const logicLower = String(parsed.logic_code || '').toLowerCase();
  const descText = parsed.description || '';
  
  // Runaway Drive (Forward Charge)
  if (
    parsed.mechanics_type === 'AUTOMATIC_DRIVE' && 
    (logicLower.includes('runaway') || logicLower.includes('crash') || descText.includes('突進') || descText.includes('暴走') || descText.includes('猛進'))
  ) {
    parsed.logic_code = 'runaway_drive';
    parsed.trigger = 'ON_MOVE';
  } 
  // Random Teleport (Warp at start of turn)
  else if (
    parsed.mechanics_type === 'AUTOMATIC_DRIVE' &&
    (logicLower.includes('teleport') || logicLower.includes('random') || logicLower.includes('warp') || descText.includes('ワープ') || descText.includes('瞬間移動'))
  ) {
    parsed.logic_code = 'random_teleport';
    parsed.trigger = 'TURN_START';
  }

  // Repair logic_code
  if (!parsed.logic_code || typeof parsed.logic_code !== 'string') {
    if (parsed.mechanics_type === 'STEALTH_TRAP') {
      parsed.logic_code = parsed.trigger === 'ON_TAKEN' ? 'self_destruct_trap' : 'stun_approach_trap';
    } else if (parsed.mechanics_type === 'RULE_BREAK') {
      parsed.logic_code = parsed.trigger === 'TURN_START' ? 'spawn_clone' : 'slowdown_aura';
    } else if (parsed.mechanics_type === 'AUTOMATIC_DRIVE') {
      parsed.logic_code = 'runaway_drive';
      parsed.trigger = 'ON_MOVE';
    } else {
      parsed.logic_code = parsed.trigger === 'ON_MOVE' ? 'linear_charge' : 'leap_move';
    }
  }

  // --- Safeguard 2.5: Align triggers for specific automated abilities ---
  const specificLogic = parsed.logic_code;
  if (specificLogic === 'recycle_dead' || specificLogic === 'recycle' || specificLogic === 'remote_snipe' || specificLogic === 'sniper' || specificLogic === 'stun_mist' || specificLogic === 'poison_mist') {
    parsed.trigger = 'ON_MOVE';
  } else if (specificLogic === 'spawn_clone' || specificLogic === 'time_bomb' || specificLogic === 'timer' || specificLogic === 'egg' || specificLogic === 'hatch') {
    parsed.trigger = 'TURN_START';
  }

  // --- Safeguard 3: Apply safety brakes to Queen movement pattern ---
  if (parsed.logic_code === 'queen' || parsed.logic_code === 'move_like_queen') {
    if (!parsed.is_once_per_game) {
      // If it is not a once-per-game ability, limit it to maximum 3 steps to balance the game
      parsed.logic_code = 'queen_limit_3';
    }
  }

  // Repair ability_genre
  if (!parsed.ability_genre || typeof parsed.ability_genre !== 'string') {
    const genreMap: Record<string, string> = {
      'MOVEMENT_HACK': '武力・突撃',
      'STEALTH_TRAP': 'ステルス・隠密',
      'RULE_BREAK': '支援・強化',
      'DYNAMICS_HACK': '擬態・洗脳',
      'AUTOMATIC_DRIVE': '自律暴走'
    };
    parsed.ability_genre = genreMap[parsed.mechanics_type] || '未知の能力';
  } else {
    // If mechanics_type was downgraded to DYNAMICS_HACK, also update ability_genre
    if (parsed.mechanics_type === 'DYNAMICS_HACK' && parsed.ability_genre === 'ステルス・隠密') {
      parsed.ability_genre = '擬態・洗脳';
    }
  }

  // Repair visual_theme
  const validThemes = ['WARRIOR_IRON', 'MYSTIC_MIST', 'SHADOW_NIGHT', 'NATURE_STONE'];
  if (!parsed.visual_theme || !validThemes.includes(parsed.visual_theme)) {
    const defaultThemeMap: Record<string, 'WARRIOR_IRON' | 'MYSTIC_MIST' | 'SHADOW_NIGHT' | 'NATURE_STONE'> = {
      'MOVEMENT_HACK': 'WARRIOR_IRON',
      'STEALTH_TRAP': 'SHADOW_NIGHT',
      'RULE_BREAK': 'MYSTIC_MIST',
      'DYNAMICS_HACK': 'NATURE_STONE',
      'AUTOMATIC_DRIVE': 'NATURE_STONE'
    };
    parsed.visual_theme = defaultThemeMap[parsed.mechanics_type] || 'NATURE_STONE';
  }

  // For AUTOMATIC_DRIVE pieces, ensure cool_down_turns is 0 and is_once_per_game is false
  if (parsed.mechanics_type === 'AUTOMATIC_DRIVE') {
    parsed.is_once_per_game = false;
    parsed.cool_down_turns = 0;
  }

  // Repair is_once_per_game → convert to cool_down_turns=99 (永続歩兵化)
  if (parsed.is_once_per_game === true) {
    parsed.cool_down_turns = 99;
  }

  // Repair cool_down_turns
  if (typeof parsed.cool_down_turns !== 'number') {
    parsed.cool_down_turns = parseInt(parsed.cool_down_turns as any) || 0;
  }
  // Allow 99 for once-per-game, otherwise cap at 4
  if (parsed.cool_down_turns !== 99) {
    parsed.cool_down_turns = Math.max(0, Math.min(4, parsed.cool_down_turns));
  }

  // Repair spawn_config and spawn_piece_name
  if (parsed.spawn_config && typeof parsed.spawn_config === 'object') {
    const config = parsed.spawn_config;
    let spName = config.spawn_piece_name;
    if (spName === undefined || spName === null) {
      spName = parsed.spawn_piece_name || null;
    } else {
      spName = String(spName);
    }
    
    let maxLimit = parseInt(config.max_limit) ?? 2;
    if (isNaN(maxLimit) || maxLimit > 2) maxLimit = 2;
    if (maxLimit < 0) maxLimit = 0;

    let geom = config.spawn_range_geometry;
    if (geom === undefined) {
      geom = null;
    } else if (geom !== null) {
      geom = String(geom).replace(/[^012]/g, '');
      if (geom.length !== 25) {
        geom = '0000001110012100111000000';
      }
    }

    parsed.spawn_config = {
      spawn_piece_name: spName,
      max_limit: maxLimit,
      spawn_range_geometry: geom
    };
    parsed.spawn_piece_name = spName;
  } else {
    let spName = parsed.spawn_piece_name;
    if (spName === undefined) {
      spName = null;
    } else if (spName !== null) {
      spName = String(spName);
    }

    if (spName) {
      parsed.spawn_config = {
        spawn_piece_name: spName,
        max_limit: 2,
        spawn_range_geometry: '0000001110012100111000000'
      };
      parsed.spawn_piece_name = spName;
    } else {
      parsed.spawn_config = {
        spawn_piece_name: null,
        max_limit: 0,
        spawn_range_geometry: null
      };
      parsed.spawn_piece_name = null;
    }
  }

  // Repair promoted_effect
  if (!parsed.promoted_effect || typeof parsed.promoted_effect !== 'object') {
    parsed.promoted_effect = {
      effect_name: parsed.effect_name + '・醒',
      description: '覚醒によって効果が強化されます。'
    };
  } else {
    if (!parsed.promoted_effect.effect_name || typeof parsed.promoted_effect.effect_name !== 'string') {
      parsed.promoted_effect.effect_name = parsed.effect_name + '・醒';
    }
    if (!parsed.promoted_effect.description || typeof parsed.promoted_effect.description !== 'string') {
      parsed.promoted_effect.description = '覚醒によって効果が強化されます。';
    }
  }

  // Repair range_geometry
  if (!parsed.range_geometry || typeof parsed.range_geometry !== 'object') {
    parsed.range_geometry = {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000',
      promoted_grid: '0000001110012100111000000'
    };
  } else {
    let norm = parsed.range_geometry.normal_grid;
    let chg = parsed.range_geometry.charging_grid;
    let prom = parsed.range_geometry.promoted_grid;

    if (norm === undefined || norm === null) {
      norm = '0000001110012100111000000';
    } else {
      norm = String(norm).replace(/[^012]/g, '');
      if (norm.length !== 25) {
        norm = '0000001110012100111000000';
      }
    }

    if (chg === undefined || chg === null) {
      chg = '0000000100012100010000000';
    } else {
      chg = String(chg).replace(/[^012]/g, '');
      if (chg.length !== 25) {
        chg = '0000000100012100010000000';
      }
    }

    if (prom === undefined || prom === null) {
      prom = mergeGrids(norm, '0000001110012100111000000');
    } else {
      prom = String(prom).replace(/[^012]/g, '');
      if (prom.length !== 25) {
        prom = mergeGrids(norm, '0000001110012100111000000');
      }
    }

    // 中央（13文字目）は自分自身。AIが中央以外に2を書いたり中央を0にしたりするので正規化する
    const fixCenter = (g: string) => g.split('').map((c, i) => (i === 12 ? '2' : c === '2' ? '1' : c)).join('');
    // 通常時の移動範囲が広すぎる（全方向2マスの24マス等）と1駒で盤面を制圧できてしまうため、
    // 動けるマスが12を超える場合は「歩数2以内（ひし形12マス）」に絞る。成った後の範囲は広いままでよい。
    const capMobility = (g: string) => {
      const movable = g.split('').filter(c => c === '1').length;
      if (movable <= 12) return g;
      return g.split('').map((c, i) => {
        const dy = Math.floor(i / 5) - 2;
        const dx = (i % 5) - 2;
        return c === '1' && Math.abs(dy) + Math.abs(dx) > 2 ? '0' : c;
      }).join('');
    };
    parsed.range_geometry = {
      normal_grid: capMobility(fixCenter(norm)),
      charging_grid: fixCenter(chg),
      promoted_grid: fixCenter(prom)
    };
  }

  // 移動パターンの表記ゆれ（knight_jump 等）を、エンジンが解釈できる値へ寄せる
  if (typeof parsed.logic_code === 'string') {
    const lc = parsed.logic_code.toLowerCase();
    const aliases: [RegExp, string][] = [
      [/knight|keima|桂/, 'move_like_knight'], [/lance|kyosha|香/, 'move_like_lance'],
      [/rook|hisha|飛/, 'move_like_rook'], [/bishop|kaku|角/, 'move_like_bishop'],
      [/gold|kin|金/, 'move_like_gold'], [/cannon|砲/, 'move_like_cannon'],
    ];
    if (!lc.startsWith('move_like_')) {
      const hit = aliases.find(([re]) => re.test(lc));
      if (hit) parsed.logic_code = hit[1];
    }
  }

  // Safeguard: Check if custom_moves is empty or undefined
  if (!parsed.custom_moves || parsed.custom_moves.length === 0) {
    if (parsed.custom_ability && parsed.custom_ability.custom_moves && parsed.custom_ability.custom_moves.length > 0) {
      parsed.custom_moves = parsed.custom_ability.custom_moves;
    }
  }

  // Force minimum movement range fallback if the piece has no custom moves AND has no grid moves
  const normGrid = parsed.range_geometry?.normal_grid || '0000000000002000000000000';
  const isImmobileGrid = !normGrid.includes('1') && !normGrid.includes('3');
  const hasNoCustomMoves = !parsed.custom_moves || parsed.custom_moves.length === 0;

  // Beam/Battery/Cannon word triggers
  const nameOrDesc = ((parsed.word || '') + ' ' + (parsed.description || '')).toLowerCase();
  const isBeamPiece = nameOrDesc.includes('砲台') || nameOrDesc.includes('大砲') || nameOrDesc.includes('レーザー') || nameOrDesc.includes('ビーム') || nameOrDesc.includes('キャノン') || nameOrDesc.includes('砲');

  if (hasNoCustomMoves && (isImmobileGrid || isBeamPiece)) {
    // Default 8-direction King-like step moves
    parsed.custom_moves = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
      { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 }
    ];
    if (parsed.custom_ability) {
      parsed.custom_ability.custom_moves = parsed.custom_moves;
    }
    // Also make sure normal_grid has at least gold/silver equivalent step moves
    if (parsed.range_geometry) {
      parsed.range_geometry.normal_grid = '0000001110012100111000000';
    }
  }

  // Also safeguard charging_grid from being completely immobile (0 moves)
  if (parsed.range_geometry && parsed.range_geometry.charging_grid) {
    const chgGrid = parsed.range_geometry.charging_grid;
    if (!chgGrid.includes('1') && !chgGrid.includes('3')) {
      parsed.range_geometry.charging_grid = '0000000100012100010000000'; // Default 4 directions
    }
  }

  // ─── Safeguard: アクションキーの正規化 ───────────────────────
  // エンジン (ActionRegistry) に存在しないキーは何も起きずに握りつぶされるため、
  // shared/abilityCatalog.ts の実装済みリストへ読み替え・除去する。
  const normalizeSpecActions = (spec: any) => {
    if (!spec || typeof spec !== 'object') return;
    const acts = normalizeActions(spec.actions && spec.actions.length > 0 ? spec.actions : spec.effect_type);
    spec.actions = acts.length > 0 ? acts : ['DESTROY'];
    spec.effect_type = spec.actions[0];
    if (!spec.area_shape || (!AREA_SHAPE_SET.has(spec.area_shape) && spec.area_shape !== 'DYNAMIC_OFFSETS')) {
      spec.area_shape = 'POINT';
    }
    const range = Number(spec.range);
    spec.range = Number.isFinite(range) ? Math.min(9, Math.max(1, Math.round(range))) : 2;
    const cd = Number(spec.cooldown_turns);
    spec.cooldown_turns = Number.isFinite(cd) ? Math.min(99, Math.max(0, Math.round(cd))) : 2;
  };
  normalizeSpecActions(parsed.ability_spec);
  normalizeSpecActions(parsed.promoted_effect?.ability_spec);


  // ─── Safeguard 1: 基礎能力 (ability_spec) の優先割り当て保護 ───────────────────────
  if (!parsed.ability_spec || typeof parsed.ability_spec !== 'object' || Object.keys(parsed.ability_spec).length === 0) {
    if (parsed.promoted_effect && parsed.promoted_effect.ability_spec) {
      parsed.ability_spec = { ...parsed.promoted_effect.ability_spec };
    } else {
      parsed.ability_spec = {
        activation_trigger: parsed.trigger || 'ON_MOVE',
        range: 2,
        target_selection: 'AUTOMATIC',
        area_shape: 'POINT',
        effect_type: 'DESTROY',
        actions: ['DESTROY'],
        affects_who: 'ENEMY_ONLY',
        cooldown_turns: 2
      };
    }
  }

  // ─── Safeguard: 確率・ギャンブル・回避キーワ―ドの自動検知 ───────────────────
  const fullDesc = String(parsed.description || '') + String(parsed.effect_name || '') + String(parsed.word || '');
  const isGambleKeyword = fullDesc.includes('ギャンブル') || fullDesc.includes('運任せ') || fullDesc.includes('幸運') || fullDesc.includes('気まぐれ') || fullDesc.includes('確率') || fullDesc.includes('コイン') || fullDesc.includes('スロット') || fullDesc.includes('サイコロ') || fullDesc.includes('ダイス');
  const isDodgeKeyword = fullDesc.includes('回避') || fullDesc.includes('見切り') || fullDesc.includes('身軽') || fullDesc.includes('かわす');

  if (isGambleKeyword || isDodgeKeyword) {
    const spec = parsed.ability_spec;
    if (spec) {
      spec.success_rate = spec.success_rate || (isDodgeKeyword ? 0.35 : 0.5);
      const acts = spec.actions || [spec.effect_type];
      if (isDodgeKeyword && !acts.includes('LUCKY_DODGE')) {
        acts.push('LUCKY_DODGE');
      } else if (isGambleKeyword && !acts.includes('PROBABILITY_STRIKE') && !acts.includes('CHAOS_GAMBLE')) {
        acts.push(Math.random() < 0.5 ? 'PROBABILITY_STRIKE' : 'CHAOS_GAMBLE');
      }
      spec.actions = acts;
      if (spec.actions.length > 0) spec.effect_type = spec.actions[0];
    }
  }

  // ─── Safeguard: 地形・新メカニクスキーワード検知 ＆ 強能力バランス抑制 ─────────
  const isFireKw = fullDesc.includes('炎') || fullDesc.includes('火') || fullDesc.includes('燃');
  const isPoisonKw = fullDesc.includes('毒') || fullDesc.includes('沼') || fullDesc.includes('紫煙');
  const isIceKw = fullDesc.includes('氷') || fullDesc.includes('凍') || fullDesc.includes('滑');
  const isBombKw = fullDesc.includes('爆弾') || fullDesc.includes('時限') || fullDesc.includes('タイマー');
  const isEvoKw = fullDesc.includes('進化') || fullDesc.includes('成長') || fullDesc.includes('覚醒');

  if (parsed.ability_spec) {
    const spec = parsed.ability_spec;
    const acts = spec.actions || [spec.effect_type];
    
    if (isFireKw && !acts.includes('SET_TILE_FIRE') && acts.length < 3) acts.push('SET_TILE_FIRE');
    if (isPoisonKw && !acts.includes('SET_TILE_POISON') && acts.length < 3) acts.push('SET_TILE_POISON');
    if (isIceKw && !acts.includes('SET_TILE_ICE') && acts.length < 3) acts.push('SET_TILE_ICE');
    if (isBombKw && !acts.includes('SET_TILE_BOMB') && acts.length < 3) acts.push('SET_TILE_BOMB');
    if (isEvoKw && !acts.includes('EVOLUTION_CHECK') && acts.length < 3) acts.push('EVOLUTION_CHECK');

    // 自動バランス抑制: 広範囲全滅能力（SQUARE_5X5やALL_ENEMY_PIECES等）にはデメリットパーツを付加
    if (spec.area_shape === 'SQUARE_5X5' || spec.area_shape === 'ALL_ENEMY_PIECES' || spec.range >= 5) {
      if (!acts.includes('DELAYED_BURST') && !acts.includes('SACRIFICE_COST') && !acts.includes('SELF_STUN') && acts.length < 3) {
        acts.push('DELAYED_BURST');
      }
      spec.cooldown_turns = Math.max(3, spec.cooldown_turns || 3);
    }
    spec.actions = acts.slice(0, 3);
    if (spec.actions.length > 0) spec.effect_type = spec.actions[0];
  }

  // ─── Safeguard 2: 成り時覚醒効果 (promoted_effect) の強化補完 ────────────────────
  if (!parsed.promoted_effect || !parsed.promoted_effect.ability_spec) {
    const baseSpec = parsed.ability_spec;
    const baseActions = baseSpec.actions || [baseSpec.effect_type || 'DESTROY'];
    const enhancedActions = [...baseActions];
    if (!enhancedActions.includes('OVERDRIVE_BOOST') && enhancedActions.length < 3) {
      enhancedActions.push('OVERDRIVE_BOOST');
    }
    parsed.promoted_effect = {
      effect_name: (parsed.effect_name || parsed.word || '真技') + '・覚醒',
      description: `【覚醒効果】成ることで基礎能力「${parsed.effect_name || parsed.word}」が限界突破・強化。効果範囲と威力が大幅に拡張される。`,
      logic_code: parsed.promoted_effect?.logic_code || null,
      ability_spec: {
        activation_trigger: baseSpec.activation_trigger || 'ON_MOVE',
        range: Math.min(99, (baseSpec.range || 2) + 1),
        target_selection: baseSpec.target_selection || 'AUTOMATIC',
        area_shape: baseSpec.area_shape === 'POINT' ? 'SQUARE_3X3' : (baseSpec.area_shape === 'SQUARE_3X3' ? 'SQUARE_5X5' : baseSpec.area_shape),
        effect_type: baseSpec.effect_type || 'DESTROY',
        actions: enhancedActions,
        affects_who: baseSpec.affects_who || 'ENEMY_ONLY',
        cooldown_turns: Math.max(0, (baseSpec.cooldown_turns || 2) - 1)
      }
    };
  }

  // ─── Safeguard: 何も起きない組み合わせの補正 ───────────────────────
  // 自動発動で範囲が POINT（自分のマスだけ）だと、敵や空きマスに作用するアクションは対象が無く不発になる。
  // 自分に作用するアクションだけなら SELF、それ以外は周囲1マスに広げる。
  const fixDudTargeting = (spec: { actions?: string[]; target_selection?: string; area_shape?: string } | undefined) => {
    if (!spec || !Array.isArray(spec.actions)) return;
    if (spec.actions.every((a: string) => SELF_ACTIONS.has(a))) {
      spec.target_selection = 'SELF';
      spec.area_shape = 'POINT';
    } else if (spec.area_shape === 'POINT' && spec.target_selection !== 'CLICK_ZONE') {
      spec.area_shape = 'SQUARE_3X3';
      if (spec.target_selection === 'SELF') spec.target_selection = 'AUTOMATIC';
    }
  };
  fixDudTargeting(parsed.ability_spec);
  fixDudTargeting(parsed.promoted_effect?.ability_spec);

  // ─── Safeguard 3: custom_ability の自動補正・生成 ────────────────────────
  if (!parsed.custom_ability && parsed.ability_spec) {
    const spec = parsed.ability_spec;
    const actions = (spec.actions && spec.actions.length > 0)
      ? spec.actions
      : (spec.effect_type ? [spec.effect_type] : ['DESTROY']);
    parsed.custom_ability = {
      ability_name: parsed.effect_name || '神秘の力',
      flavor_text: parsed.description || '',
      triggers: [spec.activation_trigger || parsed.trigger || 'ON_MOVE'],
      // 自分に作用する能力はエンジンの 'SELF' 指定でないと自分のマスが対象外になる
      targets: [spec.target_selection === 'SELF' ? 'SELF' : (spec.area_shape || 'POINT')],
      actions: actions,
      constraints: spec.affects_who === 'ALL_PIECES' ? ['MUTUAL_DAMAGE'] : [],
      remaining_uses: 3,
      custom_moves: parsed.custom_moves,
      target_mode: spec.target_mode || 'POINT_CENTERED'
    };
  }

  if (parsed.custom_ability && typeof parsed.custom_ability === 'object') {
    const ca = parsed.custom_ability;
    ca.actions = normalizeActions(Array.isArray(ca.actions) && ca.actions.length > 0 ? ca.actions : ca.effect_type);
    if (ca.actions.length === 0) {
      ca.actions = parsed.ability_spec?.actions?.length ? [...parsed.ability_spec.actions] : ['DESTROY'];
    }
    parsed.custom_ability = ca;
  }

  // ─── Safeguard: isAutonomous の自動同期・補正 ──────────────────────
  const descStr = String(parsed.description || '');
  const wordStr = String(parsed.word || '');
  const isAutoKeyword = descStr.includes('勝手に動く') || descStr.includes('暴れ馬') || descStr.includes('指示を聞かない') || descStr.includes('気まぐれ') || descStr.includes('操作不能') || wordStr.includes('ゴールドシップ');
  if (parsed.isAutonomous === true || parsed.mechanics_type === 'AUTOMATIC_DRIVE' || isAutoKeyword) {
    parsed.isAutonomous = true;
    if (parsed.custom_ability) {
      parsed.custom_ability.isAutonomous = true;
    }
  } else if (parsed.custom_ability && parsed.custom_ability.isAutonomous) {
    parsed.isAutonomous = true;
  }

  // 成り後の演出はAIに出力させていないため、通常時の演出を流用する
  if (parsed.promoted_effect && !parsed.promoted_effect.visual_effect && parsed.visual_effect) {
    parsed.promoted_effect.visual_effect = { ...parsed.visual_effect };
  }

  // ─── 能力プログラム（v2）: 検証・強さの自動調整・説明文の生成 ─────────────
  // 使える部品が1つも無ければ消し、従来の ability_spec / custom_ability で動かす
  const programs = normalizeAbilityPrograms(parsed.abilities);
  if (programs) {
    parsed.abilities = programs;
    parsed.rules_text = describeAbilities(programs);
  } else {
    delete parsed.abilities;
    delete parsed.rules_text;
  }
  parsed.appearance = normalizeAppearance(parsed.appearance, String(parsed.effect_name || parsed.word || ''));

  // ─── Safeguard: カスタム駒のフラグ保護 (標準歩兵成り化防止) ──────────────────────
  parsed.isPawn = false;
  parsed.isKing = false;
  parsed.isHisha = false;
  parsed.isKaku = false;

  return parsed as PieceData;
}

function mergeGrids(gridA: string, gridB: string): string {
  let result = '';
  for (let i = 0; i < 25; i++) {
    if (i === 12) {
      result += '2';
    } else if (gridA[i] === '1' || gridB[i] === '1') {
      result += '1';
    } else {
      result += '0';
    }
  }
  return result;
}
