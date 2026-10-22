import type { PieceData, PromotedEffect, RangeGeometry, SpawnConfig } from './types';
import { AREA_SHAPES, normalizeActions } from '../shared/abilityCatalog';

const AREA_SHAPE_SET = new Set<string>(AREA_SHAPES);

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
  return word.trim().toLowerCase();
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
 * 共有キャッシュ（Firestore）はサーバーのみが書き込めるため、クライアントからは消去しない
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

// Offline deterministic generator for 3 Grand Stratagem Gimmicks & Cooldown Turns (9x9 Shogi)
export function generateOfflinePiece(word: string, isApiError?: boolean): PieceData {
  // キャッシュチェック
  const cached = getFromCache(word);
  if (cached) return cached;

  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    hash = word.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  const lowerWord = word.toLowerCase();
  let effect_name = '';
  let mechanics_type: 'MOVEMENT_HACK' | 'STEALTH_TRAP' | 'RULE_BREAK' | 'DYNAMICS_HACK' | 'AUTOMATIC_DRIVE' = 'MOVEMENT_HACK';
  let trigger: 'ALWAYS' | 'ON_MOVE' | 'TURN_START' | 'ON_TAKEN' | 'ON_APPROACH' = 'ALWAYS';
  let cool_down_turns = 0;
  let logic_code = 'normal';
  let description = '';
  let spawn_piece_name: string | null = null;
  let spawn_config: SpawnConfig | undefined = undefined;
  let promoted_effect: PromotedEffect = {
    effect_name: '',
    description: ''
  };

  let range_geometry: RangeGeometry = {
    normal_grid: '0000001110012100111000000',
    charging_grid: '0000000100012100010000000' // Fixed to forward-1-cell during cooldown
  };

  const warningPrefix = isApiError
    ? `⚠️【簡易生成】AI生成が利用できなかったため、簡易判定を適用しました。`
    : `⚠️【簡易生成】オフライン用の簡易判定を適用しました。`;

  // Keywords for "Human" (人間) -> RULE_BREAK, TURN_START (Clone spawn)
  if (lowerWord.includes('人間') || lowerWord.includes('にんげん') || lowerWord.includes('サピエンス') || lowerWord.includes('human')) {
    effect_name = '残業増殖 (ざんぎょうぞうしょく)';
    mechanics_type = 'RULE_BREAK';
    trigger = 'TURN_START';
    cool_down_turns = 3;
    logic_code = 'spawn_clone';
    spawn_piece_name = '複製社員';
    spawn_config = {
      spawn_piece_name: '複製社員',
      max_limit: 2,
      spawn_range_geometry: '0000001110012100111000000'
    };
    description = '【発動条件】自ターン開始時（自動発動）。\n【効果内容】周囲の空きマスに「複製社員」を1体生成する。\n【制限・代償】発動後3手番の間は充填中となり、能力がフリーズし、移動範囲が前後左右の1マス十字移動に制限される。また、盤面への生成上限は最大2体。';
    promoted_effect = {
      effect_name: '定時退社 (ていじたいしゃ)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】能力発動後の充填所要手番（クールダウン）が1手番短縮される。\n【制限・代償】なし。'
    };
    range_geometry = {
      normal_grid: '0010001110112110111000100',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for "Restaurant" (飲食店) -> MOVEMENT_HACK, ALWAYS (Routine runaway)
  else if (lowerWord.includes('飲食店') || lowerWord.includes('レストラン') || lowerWord.includes('食堂') || lowerWord.includes('カフェ') || lowerWord.includes('カフェテラス')) {
    effect_name = '暴食暴走 (ぼうしょくぼうそう)';
    mechanics_type = 'MOVEMENT_HACK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'runaway_buffet';
    description = '【発動条件】手番開始時（自動発動）。\n【効果内容】プレイヤーの指示を受け付けず、自身の周囲1マスの空きマスへ勝手に自動で暴走移動する。\n【制限・代償】プレイヤーが移動先を直接操作することができない。';
    promoted_effect = {
      effect_name: '狂気満腹 (きょうきまんぷく)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】暴走移動の範囲が周囲2マス先に拡大する。\n【制限・代償】プレイヤーによる操作不能は維持される。'
    };
    range_geometry = {
      normal_grid: '0111011111112111111101110',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for "Pudding" (プリン) -> STEALTH_TRAP, ON_TAKEN (Explosion & destroy)
  else if (lowerWord.includes('プリン') || lowerWord.includes('ぷりん') || lowerWord.includes('pudding') || lowerWord.includes('デザート')) {
    effect_name = '自爆分裂 (じばくぶんれつ)';
    mechanics_type = 'STEALTH_TRAP';
    trigger = 'ON_TAKEN';
    cool_down_turns = 0;
    logic_code = 'self_destruct_trap';
    description = '【発動条件】敵駒に重なって捕獲された瞬間（自動発動）。\n【効果内容】裏向き配置された状態から正体が開示され、自身を捕獲した敵駒を道連れに爆破して両者共に消滅する。\n【制限・代償】使い捨て（1回限りの効果）。';
    promoted_effect = {
      effect_name: '甘美魅了 (かんびみりょう)',
      description: '【発動条件】敵陣に入り「成った」瞬間。\n【効果内容】再び裏向きの隠蔽状態（相手から見えない罠状態）に戻る。\n【制限・代償】なし。'
    };
    range_geometry = {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for "Dog" (犬) -> RULE_BREAK, ALWAYS (Reveal stealth)
  else if (lowerWord.includes('犬') || lowerWord.includes('いぬ') || lowerWord.includes('ドッグ')) {
    effect_name = '猟犬嗅覚 (りょうけんきゅうかく)';
    mechanics_type = 'RULE_BREAK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'reveal_stealth';
    description = '【発動条件】盤面に存在中、常時発動。\n【効果内容】自身の周囲2マス以内に潜む、裏向きの敵罠駒（ステルス等）の正体を強制開示（表向き）にする。\n【制限・代償】なし。';
    promoted_effect = {
      effect_name: '神獣威嚇 (しんじゅういかく)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】索敵開示の結界範囲が周囲3マスに拡大する。\n【制限・代償】なし。'
    };
    range_geometry = {
      normal_grid: '0111011111112111111101110',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for "Horse" (馬) -> MOVEMENT_HACK, ALWAYS (Leap jump)
  else if (lowerWord.includes('馬') || lowerWord.includes('ホース')) {
    effect_name = '疾風跳躍 (しっぷうちょうやく)';
    mechanics_type = 'MOVEMENT_HACK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'leap_move';
    description = '【発動条件】移動時、常時発動。\n【効果内容】途中に敵味方の駒が存在しても、それを飛び越えて（桂馬のように）斜め前方の2マス先へ跳躍移動できる。\n【制限・代償】なし。';
    promoted_effect = {
      effect_name: '赤兎一閃 (せきといっせん)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】左右および後方への跳躍移動が可能になる。\n【制限・代償】なし。'
    };
    range_geometry = {
      normal_grid: '0101001010002000000000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Rook (飛車)
  else if (lowerWord.includes('飛車') || lowerWord.includes('ひしゃ') || lowerWord.includes('竜') || lowerWord.includes('龍') || lowerWord.includes('rook') || lowerWord.includes('飛')) {
    effect_name = '超空滑走 (ちょうくうかっそう)';
    mechanics_type = 'MOVEMENT_HACK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'move_like_rook';
    description = '【発動条件】移動時、常時発動。\n【効果内容】縦横の直線方向に何マスでもスライド移動できる。\n【制限・代償】途中に駒がある場合は遮られ、飛び越えることはできない。';
    promoted_effect = {
      effect_name: '龍王覚醒 (りゅうおうかくせい)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】縦横の長距離移動に加え、斜め4方向の1マス移動が可能になる。\n【制限・代償】斜め方向は飛び越え不可。'
    };
    range_geometry = {
      normal_grid: '0010000100112110010000100',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Bishop (角行)
  else if (lowerWord.includes('角行') || lowerWord.includes('かくぎょう') || lowerWord.includes('角') || lowerWord.includes('かく') || lowerWord.includes('bishop')) {
    effect_name = '閃光斜行 (せんこうしゃこう)';
    mechanics_type = 'MOVEMENT_HACK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'move_like_bishop';
    description = '【発動条件】移動時、常時発動。\n【効果内容】斜め4マスの直線方向に何マスでもスライド移動できる。\n【制限・代償】途中に駒がある場合は遮られ、飛び越えることはできない。';
    promoted_effect = {
      effect_name: '龍馬覚醒 (りゅうまかくせい)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】斜めの長距離移動に加え、上下左右4方向の1マス移動が可能になる。\n【制限・代償】上下左右方向は飛び越え不可。'
    };
    range_geometry = {
      normal_grid: '1000101010002000101010001',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Lance (香車)
  else if (lowerWord.includes('香車') || lowerWord.includes('きょうしゃ') || lowerWord.includes('香') || lowerWord.includes('きょう') || lowerWord.includes('lance')) {
    effect_name = '神速直進 (しんそくちょくしん)';
    mechanics_type = 'MOVEMENT_HACK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'move_like_lance';
    description = '【発動条件】移動時、常時発動。\n【効果内容】前方の直線方向に何マスでもスライド移動できる。\n【制限・代償】後退不可。途中に駒がある場合は遮られ、飛び越え不可。';
    promoted_effect = {
      effect_name: '成香覚醒 (なりきょうかくせい)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】金将と同様の移動範囲（前後左右および斜め前方の計6方向1マス）に変化する。\n【制限・代償】長距離スライド移動は失われる。'
    };
    range_geometry = {
      normal_grid: '0010000100002000000000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Knight (桂馬)
  else if (lowerWord.includes('桂馬') || lowerWord.includes('けいま') || lowerWord.includes('桂') || lowerWord.includes('けい') || lowerWord.includes('knight')) {
    effect_name = '変則跳躍 (へんそくちょうやく)';
    mechanics_type = 'MOVEMENT_HACK';
    trigger = 'ALWAYS';
    cool_down_turns = 0;
    logic_code = 'move_like_knight';
    description = '【発動条件】移動時、常時発動。\n【効果内容】前方の左右斜め2マスの位置へ、途中の駒を飛び越えて移動できる。\n【制限・代償】前方以外の方向への移動、および他のマスへの移動は不可。';
    promoted_effect = {
      effect_name: '成桂覚醒 (なりけいかくせい)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】金将と同様の移動範囲（前後左右および斜め前方の計6方向1マス）に変化する。\n【制限・代償】桂馬独自の跳躍移動は失われる。'
    };
    range_geometry = {
      normal_grid: '0101000000002000000000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Mimic (擬態・泥棒)
  else if (lowerWord.includes('擬態') || lowerWord.includes('コピー') || lowerWord.includes('mimic') || lowerWord.includes('泥棒')) {
    effect_name = '画皮擬態 (がひぎたい)';
    mechanics_type = 'DYNAMICS_HACK';
    trigger = 'ON_MOVE';
    cool_down_turns = 1;
    logic_code = 'mimic';
    description = '【発動条件】自身の移動完了時（自動発動）。\n【効果内容】隣接する相手のカスタム駒を1つ指定し、その能力（名称、説明文、移動範囲、効果コード）を自身のものとして完全に上書きコピーする。\n【制限・代償】発動後1手番は充填中となり、移動範囲が前後左右の1マス十字移動に制限される。';
    promoted_effect = {
      effect_name: '百面相 (ひゃくめんそう)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】擬態化時のクールダウン（充填手番）が完全に消失し、毎手番連続で擬態可能になる。\n【制限・代償】なし。'
    };
    range_geometry = {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Puppet (洗脳・寄生)
  else if (lowerWord.includes('洗脳') || lowerWord.includes('寄生') || lowerWord.includes('マインドコントロール') || lowerWord.includes('puppet') || lowerWord.includes('mind_control')) {
    effect_name = '傀儡糸劇 (かいらいしげき)';
    mechanics_type = 'DYNAMICS_HACK';
    trigger = 'ON_MOVE';
    cool_down_turns = 3;
    logic_code = 'mind_control';
    description = '【発動条件】自身の移動完了時（自動発動）。\n【効果内容】隣接するすべての敵の駒（王将を除く）を支配し、自分の駒（所有権寝返り）にする。\n【制限・代償】発動後3手番は充填中となり、その間は移動範囲が前後左右の1マス十字移動に制限される。';
    promoted_effect = {
      effect_name: '狂信支配 (きょうしんしはい)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】洗脳効果の対象範囲が、隣接1マスから周囲2マス（5x5範囲）以内へと拡大する。\n【制限・代償】クールダウン等は維持される。'
    };
    range_geometry = {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Egg/Timer (卵・孵化・時限)
  else if (lowerWord.includes('卵') || lowerWord.includes('たまご') || lowerWord.includes('孵化') || lowerWord.includes('egg') || lowerWord.includes('タイマー') || lowerWord.includes('時限')) {
    effect_name = '神秘繭殻 (しんぴのまゆがら)';
    mechanics_type = 'DYNAMICS_HACK';
    trigger = 'TURN_START';
    cool_down_turns = 3; // 3 turns until hatch
    logic_code = 'time_bomb';
    description = '【発動条件】盤面に配置後、3手番経過した自ターン開始時（自動発動）。\n【効果内容】「邪竜・ファヴニール」へと超進化し、パラメータと強力な能力を獲得する。\n【制限・代償】進化するまでの3手番の間は一切移動できず、能力も発動しない。';
    promoted_effect = {
      effect_name: '進化促進 (しんかそくしん)',
      description: '【発動条件】敵陣に入り「成った」瞬間。\n【効果内容】3手番の経過を待たず、即座に「邪竜・ファヴニール」への孵化・進化を完了する。\n【制限・代償】なし。'
    };
    range_geometry = {
      normal_grid: '0000000100012100010000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Curse (呪い・身代わり)
  else if (lowerWord.includes('呪い') || lowerWord.includes('のろい') || lowerWord.includes('身代わり') || lowerWord.includes('curse')) {
    effect_name = '呪詛返還 (じゅそへんかん)';
    mechanics_type = 'DYNAMICS_HACK';
    trigger = 'ON_TAKEN';
    cool_down_turns = 0;
    logic_code = 'curse_retaliation';
    description = '【発動条件】この駒が敵に捕獲された瞬間（自動発動）。\n【効果内容】自身を捕獲した敵の駒に強力な呪いをかけ、共に盤面から消滅（破壊）させる。\n【制限・代償】使い捨て（1回限りの効果）。'; // ※元のコードは '共に盤面から消滅（破壊）させる。' だった
    promoted_effect = {
      effect_name: '大呪界 (だいじゅかい)',
      description: '【発動条件】成った状態で敵に捕獲された瞬間。\n【効果内容】自身を捕獲した駒に加え、その駒の周囲1マス以内に存在する他の敵駒もすべて道連れにして消滅させる。\n【制限・代償】味方の駒を巻き込まないように注意が必要。'
    };
    range_geometry = {
      normal_grid: '0000000000002000000000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Keywords for Spawner (増殖・巣)
  else if (lowerWord.includes('巣') || lowerWord.includes('増殖') || lowerWord.includes('spawner') || lowerWord.includes('繁殖') || lowerWord.includes('量産')) {
    effect_name = '増殖巣窟 (ぞうしょくそうくつ)';
    mechanics_type = 'DYNAMICS_HACK';
    trigger = 'TURN_START';
    cool_down_turns = 1;
    logic_code = 'spawn_minion';
    spawn_piece_name = '子蜘蛛';
    spawn_config = {
      spawn_piece_name: '子蜘蛛',
      max_limit: 2,
      spawn_range_geometry: '0000001110012100111000000'
    };
    description = '【発動条件】毎ターン開始時（自動発動）。\n【効果内容】自身の周囲の空きマスに「子蜘蛛」を1体自動で生み出す。\n【制限・代償】この駒自身は移動力ゼロで動けない。また、盤面上の生成上限は最大2体まで。';
    promoted_effect = {
      effect_name: '軍隊蜂起 (ぐんたいほうき)',
      description: '【発動条件】成ることで自動適用。\n【効果内容】自動生成するトークンが「子蜘蛛」から、より強力な「兵隊蜘蛛」へと強化される。\n【制限・代償】上限2体および自身移動不可の制限は維持される。'
    };
    range_geometry = {
      normal_grid: '0000001110012100111000000',
      charging_grid: '0000000100012100010000000'
    };
  }
  // Fallbacks
  else {
    const fallbackTypes = ['HEAVY', 'STEALTH', 'ROAR'] as const;
    const chosenType = fallbackTypes[hash % fallbackTypes.length];

    if (chosenType === 'HEAVY') {
      effect_name = '一気貫通 (いっきかんつう)';
      mechanics_type = 'MOVEMENT_HACK';
      trigger = 'ON_MOVE';
      cool_down_turns = 2;
      logic_code = 'linear_charge';
      description = `【発動条件】自身の移動完了時（自動発動）。\n【効果内容】目的地への着地時、移動前の位置から目的地までの直線上に存在するすべての敵駒を捕獲し、自身の持ち駒にする。\n【制限・代償】使用後2手番は充填中（クールタイム）となり、その間は移動範囲が前後左右1マスの十字移動に制限される。`;
      promoted_effect = {
        effect_name: '破山一撃 (はざんいちげき)',
        description: '【発動条件】成ることで自動適用。\n【効果内容】突撃によって敵を捕獲できる直線上の範囲が3マス先まで増加する。\n【制限・代償】クールダウン等の制限は維持される。'
      };
      range_geometry = {
        normal_grid: '0000001110002000000000000',
        charging_grid: '0000000100012100010000000'
      };
    } else if (chosenType === 'STEALTH') {
      effect_name = '隠密デコイ (おんみつでこい)';
      mechanics_type = 'STEALTH_TRAP';
      trigger = 'ON_APPROACH';
      cool_down_turns = 0;
      logic_code = 'stealth_decoy';
      description = `【発動条件】敵の駒が周囲1マス以内に接近した瞬間（自動発動）。\n【効果内容】裏向き（相手から正体が見えない状態）で配置され、接近されると自動で正体を開示する。\n【制限・代償】接近されるまでは他の駒との区別がつかない。移動力は極小。`;
      promoted_effect = {
        effect_name: '影武者替身 (かげむしゃがわり)',
        description: '【発動条件】敵陣に入り「成った」瞬間。\n【効果内容】再び裏向きの隠蔽状態（罠状態）に戻る。\n【制限・代償】なし。'
      };
      range_geometry = {
        normal_grid: '0000001110012100111000000',
        charging_grid: '0000000100012100010000000'
      };
    } else {
      effect_name = '鈍化結界 (どんかけっかい)';
      mechanics_type = 'RULE_BREAK';
      trigger = 'ALWAYS';
      cool_down_turns = 0;
      logic_code = 'slowdown_aura';
      description = `【発動条件】盤面に存在中、常時発動。\n【効果内容】周囲2マス以内に侵入した敵のすべての駒の移動範囲を最大1マスに制限する。\n【制限・代償】自身は前後左右1マスしか動けない。`;
      promoted_effect = {
        effect_name: '天地震動 (てんちしんどう)',
        description: '【発動条件】成ることで自動適用。\n【効果内容】移動力制限の結界範囲が周囲3マス（7x7範囲）に拡大する。\n【制限・代償】自身の移動力制限は維持される。'
      };
      range_geometry = {
        normal_grid: '0111011111112111111101110',
        charging_grid: '0000000100012100010000000'
      };
    }
  }

  let ability_genre = '武力・突撃';
  if (logic_code === 'spawn_clone' || logic_code === 'spawn_minion') {
    ability_genre = '置物・量産';
  } else if (logic_code === 'runaway_buffet') {
    ability_genre = '自律暴走';
  } else if (logic_code === 'self_destruct_trap' || logic_code === 'curse_retaliation') {
    ability_genre = '因果・罠';
  } else if (logic_code === 'reveal_stealth' || logic_code === 'stealth_decoy') {
    ability_genre = 'ステルス・隠密';
  } else if (logic_code === 'mimic' || logic_code === 'mind_control') {
    ability_genre = '擬態・洗脳';
  } else if (logic_code === 'time_bomb') {
    ability_genre = '空間操作';
  } else if (logic_code === 'slowdown_aura') {
    ability_genre = '能力無効化・結界';
  }

  const result: PieceData = {
    word,
    effect_name,
    mechanics_type,
    ability_genre,
    trigger,
    cool_down_turns,
    range_geometry,
    description: `${warningPrefix}\n${description}`,
    spawn_piece_name,
    spawn_config,
    promoted_effect,
    deep_search_analysis: 'オフライン環境でのゲームバランスに即した自動能力設計。入力単語のキーワード（馬、飛車、洗脳など）から事前に定義された能力タイプを選択しました。',
    logic_code
  };

  // 簡易生成の結果はキャッシュしない（後でAI生成が使えるようになったときに上書きを妨げないため）
  return sanitizePieceData(result, word);
}

export type PieceSource = 'cache' | 'ai' | 'offline';

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
 * Gemini APIキーはサーバー (api/generate-piece.ts) だけが保持し、ブラウザには一切渡さない。
 * 失敗時（上限到達・サーバー未設定など）はオフライン簡易生成にフォールバックする。
 */
export async function generatePieceWithSource(word: string): Promise<GeneratedPiece> {
  const trimmed = word.trim();

  // ① メモリ / localStorage キャッシュ（最速）
  const localCached = getFromCache(trimmed);
  if (localCached) return { piece: localCached, source: 'cache' };

  // ② サーバー経由で取得（サーバー側で共有キャッシュ → Gemini 生成の順に処理する。
  //    以前はブラウザからも Firestore を先に読んでいたが、初回接続の往復が丸ごと待ち時間になっていた）
  try {
    const res = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word: trimmed }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.piece) {
      const piece = sanitizePieceData(body.piece, trimmed);
      saveToCache(trimmed, piece);
      return { piece, source: body.source === 'cache' ? 'cache' : 'ai' };
    }
    const notice = body?.error || `AI生成サーバーが応答しませんでした (${res.status})`;
    return { piece: generateOfflinePiece(trimmed, true), source: 'offline', notice };
  } catch (error) {
    console.error('[generate-piece] request failed:', error);
    return {
      piece: generateOfflinePiece(trimmed, true),
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

    parsed.range_geometry = {
      normal_grid: norm,
      charging_grid: chg,
      promoted_grid: prom
    };
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
      targets: [spec.area_shape || 'POINT'],
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
