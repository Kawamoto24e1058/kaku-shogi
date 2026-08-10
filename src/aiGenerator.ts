import type { PieceData, PromotedEffect, RangeGeometry, SpawnConfig } from './types';
import { db } from './firebase';
import { doc, getDoc, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';

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

// ── Firestore キャッシュ ─────────────────────────────────────────────────────
const FIRESTORE_COLLECTION = 'custom_pieces';

/** Firestoreから駒データを取得する（存在しなければ null） */
async function getFromFirestore(word: string): Promise<PieceData | null> {
  try {
    const ref = doc(db, FIRESTORE_COLLECTION, word.trim());
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as PieceData;
      const sanitized = sanitizePieceData(data, word);
      // ローカルキャッシュにも保存して次回以降を高速化
      saveToCache(word, sanitized);
      return sanitized;
    }
  } catch (e) {
    console.warn('[Firestore] getDoc failed:', e);
  }
  return null;
}

/** 駒データをFirestoreに保存する（ドキュメントIDは単語名） */
async function saveToFirestore(word: string, data: PieceData): Promise<void> {
  try {
    const ref = doc(db, FIRESTORE_COLLECTION, word.trim());
    await setDoc(ref, data);
    console.info(`[Firestore] Saved piece: ${word}`);
  } catch (e) {
    console.warn('[Firestore] setDoc failed:', e);
  }
}

/** Firestoreおよびローカルキャッシュからすべてのカスタム駒データを一括消去・リセットする */
export async function clearAllCustomPieceCache(): Promise<number> {
  let count = 0;
  memoryCache.clear();
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('shogi_piece_cache');
      localStorage.setItem('shogi_cache_version', 'v' + Date.now());
    }
  } catch (e) {
    console.warn('Failed to clear localStorage piece cache:', e);
  }

  try {
    const snap = await getDocs(collection(db, FIRESTORE_COLLECTION));
    const deletePromises = snap.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    count = snap.docs.length;
    console.info(`[Firestore] Successfully deleted ${count} custom pieces from Firestore.`);
  } catch (e) {
    console.warn('[Firestore] Failed to delete custom pieces collection:', e);
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
    ? `⚠️【APIエラー】簡易判定を適用します。`
    : `⚠️【簡易生成】APIキー未設定のため、簡易判定を適用します。`;

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

  const sanitized = sanitizePieceData(result, word);
  saveToCache(word, sanitized);
  return sanitized;
}

// Online Gemini API call
export async function generatePieceFromWord(word: string, apiKey?: string): Promise<PieceData> {
  // ① メモリ / localStorage キャッシュ（最速）
  const localCached = getFromCache(word);
  if (localCached) {
    console.info(`[Cache] HIT (local): ${word}`);
    return localCached;
  }

  // ② Firestore キャッシュ（ローカルになければDBから）
  const firestoreCached = await getFromFirestore(word);
  if (firestoreCached) {
    console.info(`[Cache] HIT (Firestore): ${word}`);
    return firestoreCached;
  }

  // ③ APIキー未設定ならオフライン生成
  if (!apiKey || apiKey.trim() === '') {
    return generateOfflinePiece(word);
  }

  const prompt = `あなたは伝統的な将棋をハックし、言葉の本質から「変態的な移動・全自動効果」をゼロから創造する天才ゲームデザイナー兼プログラマーです。

ユーザーが入力した単語から能力を【完全新規で創造】、または以下の【AI能力デザインの引き出し（参考例プール）】からロジックを自由に組み合わせて、対人戦が最もカオスに盛り上がるJSONオブジェクトを出力してください。
※体力や攻撃力、手動奥義ボタンは完全に廃止されています。一撃捕獲ルールです。

### 🚨 最重要：言葉の意味・物理的特性の徹底調査とマッピングの義務
AIは、生成対象のユーザー入力単語の「概念、物理的特性（質量、速度、攻撃性、耐久力、隠密性など）、社会的・歴史的イメージ」について、深く調査・分析を最初に行ってください。その上で、移動範囲（normal_grid）および能力効果（logic_code/trigger）を整合するように厳格に設計してください。

【物性マッピングのガイドライン】
1. 物理的に高速、あるいは俊敏に移動するもの（例：「雷」「新幹線」「犬」「飛鳥」「光」「風」「突風」など）
   - 前方長距離スライド移動、桂馬のような長距離跳躍など、大きな機動力を normal_grid に持たせること。
   - または、プレイヤーが操作できず勝手に走り回る自律暴走（AUTOMATIC_DRIVE: logic_code: 'runaway_drive' や 'random_teleport'）を積極的に設定すること。通常の素直な移動にまとめないこと。
2. 物理的に重く、あるいは強固なもの（例：「盾」「壁」「岩」「城」「守護者」「山」など）
   - normal_grid の移動範囲は極小（0〜1マス、あるいは全く動けない完全固定の置物）に設定すること。
   - その代わり、周囲への強力な防御（身代わりや聖盾）、あるいは周囲の敵を遅くする「鈍化結界」（移動力を最大1マスに制限する環境効果）などを設定すること。
3. 物理的に破壊力が高く、あるいは凶暴なもの（例：「大砲」「爆弾」「剣」「龍」「猛獣」など）
   - 直線貫通（経路上をすべて捕獲して突き抜けるCRUSH）や、着地時の周囲衝撃波（SHOCKWAVE）、または自身が捕獲されたときの自爆爆破（MINE）などの強力な一撃破壊効果を設定すること。
4. 概念的に隠密、あるいは奇襲するもの（例：「忍者」「ステルス」「影」「霧」「幽霊」など）
   - 相手画面から姿を隠すステルス（STEALTH_TRAP: 隣接接近されるまで非表示）や、裏向きに配置される罠（TRAP_MINE）を設定すること。
5. 罠を設置する（罠設置、地雷設置、トラップ配置）能力を設計する場合は、必ず「移動完了時、移動先の隣接マスの空きマスにランダムに1個の裏向きの罠（地雷）を設置する（logic_code: 'spawn_trap'）」仕様とし、説明文も「移動先の隣接マスに裏向きの罠をランダムに1個設置する」と書いてください（元の位置に設置する仕様は完全に廃止されました）。
6. レーザーやビーム、砲台、大砲等の直線破壊能力を設計する場合は、必ず移動範囲（custom_moves）を生成し、移動は前後左右1マス、または縦横の移動範囲を持たせてください。移動能力（custom_moves）がないと移動完了時（ON_MOVE）の直線攻撃能力を発動できません。必ず「移動完了時、移動先の直線上にいる敵のすべての駒を消滅（墓地送り）させる（玉将を除く）」仕様とし、説明文もそのように書いてください（移動前の位置からの直線攻撃は完全に廃止されました）。

【和風演出テーマ（visual_theme）の判定ガイドライン】
入力された単語の歴史的背景、概念、特徴から、最も相応しい「モダン和風演出テーマ」を1つ割り当ててください：
- 'WARRIOR_IRON' (武将・武器系): 戦場、武力、金属に関連する単語（例：「信長」「大砲」「刀」など）。演出モチーフは錆びた鉄、赤黒い土、掠れ筆。
- 'MYSTIC_MIST' (神話・呪術・怪異系): 霊、死、神仏、魔力に関連する単語（例：「お化け」「仏」「呪い」など）。演出モチーフは立ち込める川霧、和蝋燭のじんわりとした陰影。
- 'SHADOW_NIGHT' (隠密・罠・忍系): 暗殺、隠蔽、夜、闇に関連する単語（例：    "effect_type": "効果種別（'DESTROY'=消滅（墓地送り）/ 'CAPTURE'=通常捕獲（持ち駒化）/ 'IMMOBILIZE'=行動封印2手番 / 'SWAP'=位置入替 / 'PULL'=引き寄せ / 'PUSH'=押し出し / 'STEALTH'=自身を隠蔽 / 'SPAWN'=トークン召喚 / 'TRANSFORM'=擬態（能力コピー）/ 'RESURRECT'=墓地から蘇生 / 'FORCE_CAPTURE'=強制捕獲 / 'TRANSFORM_PAWN'=敵の歩兵化 / 'STEAL_HAND'=敵の持ち駒強奪 / 'TIME_REWIND'=時間逆行 / 'BOOMERANG'=帰還（一撃離脱）/ 'GRAVITY_PULL'=重力吸引 / 'SHARE_FATE'=因果応報 / 'WALL_CREATE'=障害物生成 / 'LEAVE_TRAIL_FIRE'=炎の足跡 / 'EVOLUTION'=特殊成長 / 'MIND_CONTROL'=精神支配 / 'CLEAR_DEBUFF'=状態浄化 / 'MAGNET_PULL'=手前引き寄せ / 'KNOCKBACK_BUMP'=弾き飛ばし / 'POS_SWAP_ENEMY'=位置交換 / 'STUN_LOCK'=手番麻痺 / 'PENETRATE_STRIKE'=貫通狙撃 / 'VAULT_EXECUTE'=跳躍撃破 / 'CLEAVE_LINE'=縦ライン一掃 / 'GUARD_STANCE'=絶対防護 / 'SILENCE_SEAL'=能力封印 / 'OVERDRIVE_BOOST'=限界突破）※単体の場合はこちらを使用。複合コンボは actions 配列を使うこと",
    "actions": "【複合アクション配列・最大3要素】単体では表現できない連続コンボをここで定義してください。効果は配列の順番に連続実行されます。例: ['MAGNET_PULL', 'DESTROY']（引き寄せてから切る）/ ['KNOCKBACK_BUMP', 'STUN_LOCK']（体当たりして麻痺）/ ['POS_SWAP_ENEMY', 'SILENCE_SEAL']（位置入替後に能力封印）/ ['PENETRATE_STRIKE', 'STUN_LOCK']（貫通後に麻痺）。単体の場合は effect_type のみ使い、このフィールドは省略すること。",
フォーマット】を【完全厳守】して出力してください。

【説明文フォーマット】
【発動条件】<いつ、どういう条件で自動発動するのか。例：自身の移動完了時（自動発動）など>
【効果内容】<具体的にどういう効果が、どの範囲（周囲1マスなど）に起こるのか。ゲーム上の挙動を簡潔明瞭に記述>
【制限・代償】<1ゲーム1回限定の有無、クールダウンに必要な自手番数、能力使用後に移動範囲が前後左右1マスの十字移動に極小化されるペナルティ、生成数の上限などの不利益や制約を記述。制約がない場合は「なし」と記述>

※「【能力効果】」「【覚醒効果】」などの古いタグは一切使用しないでください。
※カタカナゲーム用語（バフ、デバフ、HP、MP、クールダウン、アクティブ、パッシブ、バリア、スタン等）は完全に排除し、漢語・和語（例：能力強化、弱体化、体力、魔力、充填手番、自動発動、聖盾、行動封印など）のみを使用してください。

---

### 🚨 最重要：ゲームバランスを壊さないための『4大・安全ブレーキルール』

AIは能力をデザインする際、ゲームがワンサイドゲーム（大味な怪獣大戦争）になるのを防ぐため、以下の4つの調整弁（ペナルティ・制限）を【必ず】どれか1つ以上組み合わせ、効果テキスト（description）およびJSONデータに厳格に反映させてください。

1. 【1ゲームに1回（使い捨て：is_once_per_game: true）の強制適用】
   - 直線上の敵を全滅させる（CRUSH）、周囲の敵を全滅させる（SHOCKWAVE）、相手の強力な駒に自由に変身する（TRANSFORM）、敵を洗脳する（PUPPET）などの「1手で戦況を完全にひっくり返すレベルのチート能力」は、必ず \`is_once_per_game: true\` をセットすること。
   - この必殺技を全自動発動した後は、ゲーム終了までその駒の移動範囲は一律で「前後左右の4方向へ1マス動ける十字移動（charging_grid）」の充填状態となるペナルティを課すこと。

2. 【何度も使える能力には「重いクールタイム」を付与】
   - 2マスジャンプ、味方へのバフ、位置入れ替えなど、何度も使える通常効果（is_once_per_game: false）を設計する場合、必ず \`cool_down_turns\`（再充填に必要な自手番数：2〜4ターン）を設定すること。
   - クールタイム中の数ターンは、能力がフリーズし、移動範囲も「前後左右に1マス動ける十字移動」に制限されるペナルティ（充填状態）を課すこと。

3. 【増殖系（SPAWNER）は「最大2体まで」を絶対死守】
   - 別個体のトークン（複製兵など）を盤面に生み出す能力の場合、盤面に同時に存在できる最大上限数を【厳格に2体まで（max_limit: 2）】にロックすること。2体生き残っている場合は、クールタイムが明けても次の兵は生成されないロジックとすること。

4. 【永続パッシブ能力（結界・バフ等）は「移動力ゼロ」の肉斬骨断】
   - 「周囲にいる味方を永続的に強化する」「周囲の敵を永続的に鈍化させる」といった、使い捨てでもクールタイム制でもない永続パッシブ能力を持つ駒（ALWAYS）は、その強力さの代償として、本体の移動範囲（normal_grid）を「0マス（1マスも動けない完全固定の置物）」、または「前進1マスのみ」という最弱の足回りに設定すること。

5. 【成る（覚醒）前と後の『アビリティの完全分離』】
   - **成った後にのみ発現・上書きされる能力**がある場合、通常時の \`ability_spec\` は \`null\` または \`undefined\` にし、\`promoted_effect.ability_spec\` にそのアビリティの定義を格納してください。
   - 成った後の移動パターン変更（例: 全空きマスへのワープ: 'teleport_move' など）は、通常時の \`logic_code\` ではなく、\`promoted_effect.logic_code\` に定義してください。
   - **成る前の通常時の説明文（\`description\`）には、覚醒後の効果（例: 「【覚醒効果】...」など）を絶対に混ぜて記載しないでください**。成る前の説明は \`description\` にのみ、成った後の説明は \`promoted_effect.description\` にのみ記載すること。これを破ると、成る前のキーワード誤検知で誤動作するバグの原因になります。

---

### 🚨 幾何学範囲（grid_map）の空間計算ルールの厳格化
AIは「2マスの範囲」と記述したにもかかわらず、5x5グリッドで1マス分しか点灯させない計算ミスを絶対に起こさないでください。

【5x5グリッドの距離インデックス構造（上が前方）】
 00 01 02 03 04  ← 前方2マス行（02は「正面2マス先」）
 05 06 07 08 09  ← 前方1マス行（07は「正面1マス先」）
 10 11 12 13 14  ← 自分の行   （12は「自分自身=必ず2」）
 15 16 17 18 19  ← 後方1マス行（17は「背後1マス」）
 20 21 22 23 24  ← 後方2マス行（22は「背後2マス」）

【重要な計算例】
- 「周囲1マス（隣接8方向）」→ 06 07 08 11 13 16 17 18 に 1 → '0000001110012100111000000'
- 「周囲2マス（外周まで全て）」→ 外周全20マスに 1 → '1111111111121111111111111'
- 「前方2マス（直線）」→ 02と07に 1 → '0010000100002000000000000'
- 「前方扇形」→ 01 02 03 と 06 07 08 に 1 → '0111001110020000000000000'
- 「十字スライド（飛車型）」→ 02 07 11 13 17 に 1 → '0010000100112100010000100'
- 「斜め（角型）」→ 00 04 06 08 10 14 16 18 20 24 に 1 → '1000101010021010101010001'

能力を使い切った後または充填中の charging_grid は一律「前後左右の4方向へ1マス動ける十字移動（0000000100012100010000000）」に固定。

---

### 📚 AI能力デザインの引き出し（12大ジャンルと28の参考例プール）

#### 【ジャンル1：武力・突撃系（FORCE_CRUSH）】
- No.1: [直線貫通（CRUSH）] - 移動軌道上の全マスを走査し、経路上にいた敵駒をすべて捕獲して突き抜ける（1ゲーム1回限定）。
- No.2: [全方位衝撃波（SHOCKWAVE）] - 着地した瞬間、自分の周囲1マスにいる敵を全員捕獲する（1ゲーム1回限定）。
- No.3: [障害跳躍（LEAP）] - 進路上の駒を無視して空間を飛び越え、目的のマスにワープ着地する（何度も使えるがクールタイム2ターン）。

#### 【ジャンル2：洗脳・擬態・強奪系（HACK_AND_STEAL）】
- No.4: [精神洗脳（PUPPET）] - 周囲1マスに敵の飛車・角またはカスタム駒が存在するときに全自動トリガー。1ゲーム1回限定で、次の自ターンにその敵駒のコントロールを奪って操作できる。発動後は歩兵化。
- No.5: [即時変身（TRANSFORM）] - 着地時、盤面の他の駒を1u指定し、その能力・移動範囲に自分のデータを完全に書き換えて成り代わる（1ゲーム1回限定）。
- No.6: [能力強奪（STEAL）] - 敵の駒を取った瞬間に自動発動。取った敵の能力を奪い取り、自分の能力として永続上書きする。

#### 【ジャンル3：ステルス・隠密系（STEALTH_GHOST）】
- No.7: [近接探知型ステルス] - 通常時は相手画面から「完全非表示（空きマス）」。ただし敵の周囲1マス（隣接）に互いが進入した瞬間のみ自動表示され、2マス以上離れると再び完全に見えなくなる。永続パッシブだが本体は歩兵並みに弱い。
- No.8: [偽装表示（DISGUISE）] - 相手画面からはただの「歩兵」に見えているが、自分側からは本来の姿と変則移動範囲が見えている。

#### 【ジャンル4：支援・戦意高揚系（SUPPORT_BUFF）】
味方の能力を底上げし、軍勢としてラインを押し上げる王道ジャンル。
- No.9: [軍神の号令（WAR_CRY）] - 1ゲーム1回限定。移動完了時（ON_MOVE）に発動。その時盤面にいる「自分のすべての通常歩兵」の移動範囲を、そのターンだけ一時的に「全方向1マス動ける（王将と同等）」に超強化する。発動後は自身は歩兵化する。
- No.10: [金剛の加護（SHIELD）] - ターン開始時（TURN_START）、この駒の周囲1マスに隣接している味方の駒1枚に「一撃耐える聖盾」を付与。盾がある駒は、次に敵に取られそうになった瞬間、盾が身代わりに割れてそのマスに生き残る（何度も使えるがクールタイム3ターン）。
- No.11: [神速の風（SPEED_BOOST）] - 永続パッシブ（ALWAYS）。この駒の周囲2マス（5x5範囲）に進入した味方のすべての駒は、前方への移動力がプラス1マス拡張される。この強大な恩恵の代償として、この駒自身は1マスも動けない（移動力ゼロ）。

#### 【ジャンル5：置物・自動生誕系（SPAWNER_BUILD）】
- No.12: [自動量産（SPAWNER）] - 移動力ゼロの代わりに、毎ターン開始時に隣接マスに「複製兵」等のトークンを自動生成する（盤面存在上限2体を厳守）。
- No.13: [環境鈍化（SLOWNESS）] - この駒が盤面にいる限り、周囲2マスに進入したすべての敵駒は、本来の移動力を失い「前進1マス」しか動けなくなる（本体は移動力ゼロ）。

#### 【ジャンル6：因果逆転・罠系（TRAP_MINE）】
- No.14: [道連れ地雷（MINE）] - 配置時は裏向き。敵が取ろうと重なった瞬間に自動開示され、取った相手の駒を道連れに爆破消滅させる（使い捨て）。
- No.15: [落とし穴（TRAP）] - 配置時は裏向き。周囲1マスに敵が侵入した瞬間に開示され、その敵をその場に2ターン拘束（移動不能化）する。
- No.16: [身代わり（SUBSTITUTE）] - 味方の王将が取られそうになった瞬間、自動でその位置へワープして盾となり、身代わりに捕獲される（1ゲーム1回限定）。
- No.17: [時限進化（TIMER）] - 盤面に打たれてから3ターンの間は動けないが、4ターン目の開始時に最強の駒へ強制進化する。
- No.17.5: [罠設置（spawn_trap）] - 移動完了時（ON_MOVE）に発動。移動先の隣接するマスのうち空いているマスにランダムに1枚、裏向きの罠（地雷など：ON_TAKENで相手を道連れにする使い捨ての駒）を設置する（logic_code: 'spawn_trap'、クールタイム2ターン）。

#### 【ジャンル7：自律暴走・自動移動系（AUTOMATIC_DRIVE）】
- No.18: [完全ランダム暴走（RANDOM_TELEPORT）] - 毎ターン開始時（TURN_START）、プレイヤーの指示を無視して、自身の移動可能範囲（通常グリッド、成グリッド）内のランダムな空きマスへ勝手にワープする（logic_code: 'random_teleport'）。
- No.19: [猪突猛進（RUNAWAY_DRIVE）] - 自分の手番の終わり（ON_MOVE）に、自動的に前方の障害物（駒または壁）にぶつかるまで真っ直ぐ進む移動を強制実行する（logic_code: 'runaway_drive'）。
- ※自律移動・自動移動（AUTOMATIC_DRIVE）の駒には、他のあらゆる種類の特殊効果（衝撃波、バフ、聖盾、洗脳、変身、地雷など）を【絶対に組み合わせて持たせない】でください。「勝手に動く」という単一の効果のみに完全に集中させてください。また、自律行動する駒のクールタイム（cool_down_turns）は必ず「0」に設定し、使い捨て（is_once_per_game）は必ず「false」に設定してください。

#### 【ジャンル8：感染・デバフ系（VIRUS_INFECT）】
- No.20: [行動封印・呪縛（curse_stun）] - 取られた時（ON_TAKEN）に発動。自身を取った敵駒を3ターンの間、行動封印（完全に移動不可能）状態にする。
- No.21: [能力封印（curse_silence）] - 取られた時（ON_TAKEN）に発動。自身を取った敵駒のすべての特殊能力と移動範囲を永久に奪い、前進1マスのみ動ける「普通の歩兵」に弱体化させる。
- No.22: [死の宣告（curse_death）] - 取られた時（ON_TAKEN）に発動。自身を取った敵駒に3ターンの死のカウントダウンを付与し、3ターン経過後にその敵駒を自動消滅させる。

#### 【ジャンル9：位置入れ替え系（SPACE_WARP）】
- No.23: [位置スワップ（SWAP）] - 移動完了時、盤面にある「自分の通常歩兵1枚」を指定し、この駒と位置を一瞬で入れ替える（クールタイム3ターン）。

#### 【ジャンル10：時間・射撃・環境効果系（TIME_ATTACK）】
- No.24: [遠隔狙撃（remote_snipe）] - 移動完了時（ON_MOVE）、直線または斜め方向にちょうど3マス先にある敵の駒（王将を除く）を遠隔狙撃してその場から捕獲する（logic_code: 'remote_snipe'、クールタイム3ターン）。
- No.25: [昏睡毒霧（stun_mist）] - 移動完了時（ON_MOVE）、周囲1マスのすべての敵駒を2手番の間、行動封印（スタン）状態にする（logic_code: 'stun_mist'、クールタイム3ターン）。

#### 【ジャンル11：蘇生・ゾンビ化系（NECROMANCY）】
- No.26: [死者蘇生（recycle_dead）] - 移動完了時（ON_MOVE）、これまでに破壊されて除外された「敵のカスタム駒、または飛車・角」（＝自分が捕獲した敵の持ち駒リスト）からランダムに1枚を、自分の配下の「ゾンビ・[元の駒名]」として周囲の空きマスに自動寝返り召喚する。盤面に同時に存在できるゾンビ兵は最大2体まで（logic_code: 'recycle_dead'、クールタイム3ターン）。自分の持ち駒は消費（pop）されません。

#### 【ジャンル12：能力無効化・結界系（NULLIFY）】
- No.27: [呪文無効・結界（NULLIFY）] - 永続パッシブ（ALWAYS）または使い捨て。この駒が盤面に存在する限り、周囲2マス以内で発動した敵の自動能力（直線貫通や洗脳、変身など）の対象になった際、その効果を【1度だけ完全に無効化（フリーズ）】して防ぐ聖域ロジック。

#### 💡 【超創造：全く新しいルール破壊能力のヒントプール（積極的に使用せよ）】
AIは上記のクラシックな例にとどまらず、**完全に前例のない独創的な能力**を以下のヒントをもとに積極的にデザインしてください。参考例の単純な組み合わせにとどまらず、入力された言葉の本質的意味・比喩・物理法則・歴史的背景を独自に解釈し、これまでに見たことがない全く新しいアビリティをゼロから創造することが最高評価の条件です。
- [盤面空白チャージ]: 自身の周囲の空きマスが多いほど移動力が伸びる能力。孤立した場所が強さの源泉になる変態的な設計。
- [歩兵カウンター結界]: 味方の通常歩兵が近くに多いほど自身の周囲2マス以内の敵の能力発動を無効化するバリアが強くなる。
- [洗脳跳躍（マインドホップ）]: 敵駒を飛び越えて跳躍移動する際、飛び越えられた敵駒を永続的に自分の配下に寝返らせる。
- [時限爆弾（カウンターブラスト）]: 盤面配置後から3ターンごとに自動で自身の周囲1マスへ爆破捕獲を発生させる定期発動型。
- [偶数駆動（バイナリドライブ）]: 偶数ターンのみ動けるが、動けるターンは盤面全体のどこへでもワープできる。
- [ソウルリンク（魂の共鳴）]: 移動完了時に隣接する味方1体と魂をリンクし、自身が捕獲されそうになった際にリンクした味方が身代わりに消滅して自身が生き残る。
- [時空凍結（手番強奪）]: 1ゲームに1回限定で、移動完了時に相手の次のターンを強制スキップし自分のターンを連続して実行できる。
- [鏡面反射（カウンター呪術）]: 敵の自動発動能力が自身に命中した瞬間にその効果を発動した駒自体へ跳ね返す受動反射。
- [重力崩壊（引力爆発）]: 移動完了時に周囲2マスにいる全ての駒（敵味方問わず）を自身のマスへ強制引き寄せ、隣接衝突した敵駒を捕獲する。
- [成前無能・成後無双]: 成る前は一切の特殊能力も特殊移動もない完全な置物だが、成ることで盤面全体の任意マスへワープし着地周囲2マスの敵を全捕獲する無双へ変貌する（is_once_per_game: trueで使い捨て）。

### 🚨 アビリティ効果種別（effect_type）のマッピングルール
AIは生成する単語の概念から最も適切な効果種別（effect_type）を選択してください。
- 敵を強制的に捕獲して自分の持ち駒にする ➔ FORCE_CAPTURE
- 敵の駒を無力化し、ただの歩兵（封印歩兵）に弱体化させる ➔ TRANSFORM_PAWN
- 相手の持ち駒をランダムに強奪する ➔ STEAL_HAND
- 時間を巻き戻し、駒を前ターンの座標にワープさせる ➔ TIME_REWIND
- 攻撃や能力を使用した後に移動前の元のマスに戻る（ヒット＆アウェイ） ➔ BOOMERANG
- 盤面全体のすべての敵駒を自分（または指定の中心）に向けて1マス引き寄せる ➔ GRAVITY_PULL
- 自分と敵の運命を共有し、自分が倒されたときに敵も道連れにする ➔ SHARE_FATE
- 指定の空きマスに進入不可能の障害物（結界）を生成する ➔ WALL_CREATE
- 移動経路上の空きマスに炎上ダメージトラップを設置する ➔ LEAVE_TRAIL_FIRE
- 進化・成長・レベルアップ・強くなる ➔ EVOLUTION
- 洗脳・マインドコントロール・操る ➔ MIND_CONTROL
- 浄化・解呪・治す・リセット ➔ CLEAR_DEBUFF
- 引き寄せ・磁石・引力・たぐり寄せる ➔ MAGNET_PULL
- 体当たり・バンプ・押し出し・吹き飛ばす ➔ KNOCKBACK_BUMP
- 位置交換・チェンジ・スワップ・位置をかえる ➔ POS_SWAP_ENEMY
- 麻痺・足止め・金縛り・バインド・スタン ➔ STUN_LOCK
- 貫通・狙撃・遠距離打撃・スルー ➔ PENETRATE_STRIKE
- 飛び越える・背後・跳躍撃破・回り込み ➔ VAULT_EXECUTE
- 縦回転・縦一掃・スライス・軸攻撃 ➔ CLEAVE_LINE
- ガード・パリィ・絶対防護・無効化 ➔ GUARD_STANCE
- 封印・沈黙・無力化・サイレンス ➔ SILENCE_SEAL
- 限界突破・オーバードライブ・2倍機動・界王拳 ➔ OVERDRIVE_BOOST

---

### 🚨 演出のAIデザイン化ルール（visual_effect オブジェクトの出力）
AIは、生成する単語のイメージ（例：「超電磁砲」なら青白い直線ビーム、「桜吹雪」ならピンクの渦、「メテオ」なら上空からの放物線・大画面揺れなど）に合わせて、以下の visual_effect オブジェクトを必ず設計し、通常時（ルート）および成った後の効果（promoted_effect内）にそれぞれ格納してください。
- trajectory_type:
  - PARABOLA: 発動駒から対象へ放物線を描いて弾が飛んでいく
  - BEAM: 発動駒から対象へ一瞬で極太レーザーが突き刺さる
  - STRIKE: 上空から対象マスへ落雷のように光が真っ直ぐ突き刺さる
  - SPIRAL: 対象マスの中心で光が円を描きながら渦巻く
  - BURST: 対象マスの中心から全方位へエネルギー粒子が激しく弾ける
- particle_color: 属性や単語に100%合致するカラーHEXコード（例：桜吹雪なら "#ffb7c5"）
- particle_count: 粒子の多さ（20〜100）
- particle_speed: 粒子の拡散・進行速度（0.5〜3.0）
- screen_shake: 画面の揺れ幅（0〜5。強力な能力ほど大きな値をセットする）

---

### 🧠 【知識連動・超個性錬成】思考プロセス（Chain of Thought）指示
プレイヤーが入力した単語「${word}」が、固有名詞（競走馬・アニメ/漫画キャラクター・神話/伝説・ブランド製品・偉人・歴史的出来事・ネットミームなど）である場合、必ず以下の思考プロセスで能力を錬成してください：

1. **知識検索・元ネタ分析**:
   - その単語が持つ元ネタのエピソード、固有の性質、能力、名言、物理的特徴（質量・吸引力・速度・気まぐれさなど）を内部知識から抽出してください。
2. **将棋ゲームメカニクスへの翻訳・調合レシピ**:
   - 抽出した元ネタの性質を、最も合致するアクション (actions)、移動範囲 (range_geometry/custom_moves)、発動タイミング (trigger/activation_trigger)、自動行動フラグ (isAutonomous) の組み合わせへ翻訳してください。

#### 【解釈・調合レシピの代表例】
- **「ゴールドシップ」**
  - 意味解析: 規格外の強さを持つ競走馬だが気まぐれで指示を聞かない暴れ馬。突然のワープ（ワープワープ）。
  - 調合レシピ: isAutonomous: true（操作不能/自動行動）, logic_code: 'random_teleport', actions: ['VAULT_EXECUTE', 'KNOCKBACK_BUMP'], description: "【効果内容】手番終了時にランダムなマスへ突如ワープし、着地地点の敵を跳躍撃破・吹き飛ばす。暴れ馬のためプレイヤーの直接操作を聞かない。"
- **「ダイソン」**
  - 意味解析: 吸引力が変わらない唯一の掃除機。強力な吸い込み。
  - 調合レシピ: actions: ['MAGNET_PULL', 'GRAVITY_PULL'], area_shape: 'SQUARE_5X5', description: "【効果内容】周囲5x5以内のすべての敵駒を強烈な吸引力で自分へ引き寄せる。"
- **「アーニャ」**
  - 意味解析: 他人の心を読める超能力者（わくわく）。相手の企みを事前に察知。
  - 調合レシピ: actions: ['SILENCE_SEAL', 'STEALTH_ON'], trigger: 'ON_APPROACH', description: "【効果内容】敵駒が接近した瞬間、相手の心を読んで行動と能力を封印し、自身は隠密状態に入る。"
- **「キングクリムゾン」**
  - 意味解析: 時間を消し去り、過程を飛ばして結果だけを残す悪魔的スタンド。
  - 調合レシピ: actions: ['POS_SWAP_ENEMY', 'STUN_LOCK'], description: "【効果内容】敵駒と位置を強制入れ替えし、消し去った時間の中で対象の手番を1ターン麻痺封印する。"
- **「エクスカリバー」**
  - 意味解析: 約束された勝利の聖剣。直線上の全てを穿つ極大光線。
  - 調合レシピ: actions: ['PENETRATE_STRIKE', 'OVERDRIVE_BOOST'], area_shape: 'LINE_STRAIGHT', visual_effect: { trajectory_type: 'BEAM', particle_color: '#ffd700', screen_shake: 5 }

---

### 💻 出力JSONフォーマット（純粋なJSONのみ。Markdownのバッククォートや解説文は一切禁止）
{
  "word": "プレイヤーが入力した単語",
  "effect_name": "漢字の能力名",
  "mechanics_type": "内部属性コード（'FORCE_CRUSH' / 'HACK_AND_STEAL' / 'STEALTH_GHOST' / 'SUPPORT_BUFF' / 'SPAWNER_BUILD' / 'TRAP_MINE' / 'AUTOMATIC_DRIVE' / 'UNKNOWN_HERESY' 等）",
  "ability_genre": "画面の属性欄に表示する日本語のジャンル名（例: '武力・突撃', '擬態・洗脳', 'ステルス・隠密', '能力無効化・結界', '支援・強化' など単語から適切に選択）",
  "visual_theme": "演出テーマコード（'WARRIOR_IRON' / 'MYSTIC_MIST' / 'SHADOW_NIGHT' / 'NATURE_STONE'）",
  "trigger": "発動形式（'ALWAYS' / 'ON_MOVE' / 'TURN_START' / 'ON_TAKEN' / 'ON_APPROACH'）",
  "is_once_per_game": true,
  "cool_down_turns": 0,
  "isAutonomous": false, // 指示を聞かない・勝手に動く・暴走駒・暴れ馬の場合は true に設定（操作不能/自動行動）
  "range_geometry": {
    "normal_grid": "通常時5x5範囲（周囲2マスの場合は外周の計算ミス厳禁）",
    "charging_grid": "0000000100012100010000000", // 十字移動に完全固定
    "promoted_grid": "成った（プロモーション）時の5x5範囲（通常時よりも移動範囲が拡張されたバフグリッドであること。例えば8方向すべての隣接マスに移動可能な '0000001110012100111000000' や、それ以上に拡張された範囲）"
  },
  "ability_spec": {
    // 🚨 必須要件: プレイヤー単語から調合したメインの能力（actions/custom_moves/isAutonomous等）は、必ずこの通常時の「ability_spec」に100%セットすること！（成る前の基礎能力としてすぐ発動・使用可能にする）
    "activation_trigger": "能力の発動タイミング（'ON_MOVE' / 'TURN_START' / 'ON_TAKEN' / 'ON_APPROACH' / 'ALWAYS'）",
    "range": 3,
    "target_selection": "ターゲット選択方式（'CLICK_ZONE'=プレイヤーが着弾点を選択 / 'AUTOMATIC'=自動で近くの対象を狙う / 'SELF'=自分自身に発動）",
    "area_shape": "着弾形状（'POINT'=単点 / 'SQUARE_3X3'=3x3全範囲 / 'SQUARE_5X5'=5x5全範囲 / 'CROSS'=十字無限 / 'LINE_STRAIGHT'=8方向直線無限 / 'RANGE_2'=周囲2マス / 'RANGE_3'=周囲3マス）",
    "effect_type": "効果種別（'DESTROY'=消滅 / 'CAPTURE'=通常捕獲 / 'IMMOBILIZE'=行動封印 / 'SWAP'=位置入替 / 'PULL'=引き寄せ / 'PUSH'=押し出し / 'STEALTH'=隠蔽 / 'SPAWN'=召喚 / 'TRANSFORM'=擬態 / 'RESURRECT'=蘇生 / 'FORCE_CAPTURE'=強制捕獲 / 'TRANSFORM_PAWN'=歩兵化 / 'STEAL_HAND'=持ち駒強奪 / 'TIME_REWIND'=時間逆行 / 'BOOMERANG'=帰還 / 'GRAVITY_PULL'=重力吸引 / 'SHARE_FATE'=因果応報 / 'WALL_CREATE'=障害物生成 / 'LEAVE_TRAIL_FIRE'=炎の足跡 / 'EVOLUTION'=特殊成長 / 'MIND_CONTROL'=精神支配 / 'CLEAR_DEBUFF'=状態浄化 / 'MAGNET_PULL'=手前引き寄せ / 'KNOCKBACK_BUMP'=弾き飛ばし / 'POS_SWAP_ENEMY'=位置交換 / 'STUN_LOCK'=手番麻痺 / 'PENETRATE_STRIKE'=貫通狙撃 / 'VAULT_EXECUTE'=跳躍撃破 / 'CLEAVE_LINE'=縦ライン一掃 / 'GUARD_STANCE'=絶対防護 / 'SILENCE_SEAL'=能力封印 / 'OVERDRIVE_BOOST'=限界突破）",
    "actions": ["複合アクション配列（最大3要素）。例: ['MAGNET_PULL', 'DESTROY']"],
    "affects_who": "対象（'ENEMY_ONLY'=敵のみ / 'ALL_PIECES'=無差別 / 'ALLY_ONLY'=味方のみ / 'EMPTY_ONLY'=空マスのみ）",
    "cooldown_turns": 2
  },
  "visual_effect": {
    "trajectory_type": "軌道タイプ（'PARABOLA' / 'BEAM' / 'STRIKE' / 'SPIRAL' / 'BURST'）",
    "particle_color": "HEXカラー（例: '#ff5500'）",
    "particle_count": 50,
    "particle_speed": 1.2,
    "screen_shake": 2
  },
  "description": "通常時の説明文（【発動条件】...\n【効果内容】...\n【制限・代償】... の3部構成。）",
  "spawn_config": {
    "spawn_piece_name": "生み出す駒名（不要ならnull）",
    "max_limit": 2,
    "spawn_range_geometry": "生み出す範囲の5x5グリッド（不要ならnull）"
  },
  "promoted_effect": {
    "effect_name": "成った時の能力名（例: 漢字名＋'・覚醒'）",
    "description": "成った後の覚醒効果の説明文（基礎能力の対象範囲拡大、クールタイム短縮、または元ネタの別側面・派生技の追加効果）",
    "logic_code": "成った後の移動パターン（不要ならnull。例: 成後ワープなら 'teleport_move'、成後クイーンなら 'queen'）",
    "ability_spec": {
      "activation_trigger": "能力の発動タイミング",
      "range": 4,
      "target_selection": "AUTOMATIC",
      "area_shape": "SQUARE_5X5",
      "effect_type": "DESTROY",
      "actions": ["DESTROY", "KNOCKBACK_BUMP"],
      "affects_who": "ENEMY_ONLY",
      "cooldown_turns": 1
    },
    "visual_effect": {
      "trajectory_type": "軌道タイプ（'PARABOLA' / 'BEAM' / 'STRIKE' / 'SPIRAL' / 'BURST'）",
      "particle_color": "HEXカラー（例: '#ffd700'）",
      "particle_count": 60,
      "particle_speed": 1.5,
      "screen_shake": 3
    }
  },
  "logic_code": "移動パターンまたは特殊ロジック（スライド移動は 'move_like_rook'/'move_like_bishop'/'move_like_lance'/'move_like_knight'。それ以外は一意の英語識別子）",
  "deep_search_analysis": "「XXX」という単語の本質・物理的特徴（質量、速度、攻撃性など）を調べ、それをどのように移動範囲や効果にマッピングしたのかの論理的理由（日本語200文字程度）"
}

### 生成対象のユーザー入力単語:
\"${word}\"

上記の単語の持つ意味・イメージ・性質を徹底分析し、10大ジャンルと24の参考例プールを参照しながら、それを超越した完全オリジナルの対人戦最高カオス駒オブジェクトをJSONで生成してください。
`;


  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API returned status ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Invalid API response structure');
    }

    const parsed: any = JSON.parse(text.trim());
    const resultPiece = sanitizePieceData(parsed, word);
    // ローカル + Firestore 両方に保存（Firestore は fire-and-forget）
    saveToCache(word, resultPiece);
    saveToFirestore(word, resultPiece);
    return resultPiece;
  } catch (error) {
    console.error('Error generating piece with new gimmicks:', error);
    return generateOfflinePiece(word, true);
  }
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

  // ─── Safeguard: custom_ability.actions の正規化 ───────────────────────
  // 1. actions が未定義で effect_type があれば actions: [effect_type] に自動変換
  // 2. actions を最大3要素にクランプ
  // 3. 未知のアクションキーを除去してパイプラインの安全性を保証
  const VALID_EFFECT_TYPES = new Set([
    'DESTROY', 'CAPTURE', 'IMMOBILIZE', 'SWAP', 'PULL', 'PUSH', 'STEALTH', 'SPAWN', 'TRANSFORM',
    'RESURRECT', 'FORCE_CAPTURE', 'TRANSFORM_PAWN', 'STEAL_HAND', 'TIME_REWIND', 'BOOMERANG',
    'GRAVITY_PULL', 'SHARE_FATE', 'WALL_CREATE', 'LEAVE_TRAIL_FIRE', 'EVOLUTION', 'MIND_CONTROL',
    'CLEAR_DEBUFF', 'MAGNET_PULL', 'KNOCKBACK_BUMP', 'POS_SWAP_ENEMY', 'STUN_LOCK',
    'PENETRATE_STRIKE', 'VAULT_EXECUTE', 'CLEAVE_LINE', 'GUARD_STANCE', 'SILENCE_SEAL', 'OVERDRIVE_BOOST'
  ]);
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
  const isGambleKeyword = fullDesc.includes('ギャンブル') || fullDesc.includes('運') || fullDesc.includes('気まぐれ') || fullDesc.includes('確率') || fullDesc.includes('コイン') || fullDesc.includes('スロット') || fullDesc.includes('サイコロ') || fullDesc.includes('ダイス');
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
    if (!Array.isArray(ca.actions) || ca.actions.length === 0) {
      // legacy effect_type 形式 → actions 配列に変換
      if (ca.effect_type && typeof ca.effect_type === 'string' && VALID_EFFECT_TYPES.has(ca.effect_type)) {
        ca.actions = [ca.effect_type];
      } else if (!Array.isArray(ca.actions)) {
        ca.actions = ['DESTROY']; // 最終フォールバック
      }
    }
    // 未知のアクションをフィルタリング
    ca.actions = ca.actions.filter((a: string) => VALID_EFFECT_TYPES.has(a));
    // 最大3要素にクランプ
    if (ca.actions.length > 3) {
      ca.actions = ca.actions.slice(0, 3);
    }
    // 空になった場合はフォールバック
    if (ca.actions.length === 0) {
      ca.actions = ['DESTROY'];
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
