import type { PieceData, PromotedEffect, RangeGeometry, SpawnConfig } from './types';
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

// キャッシュ用インメモリマップおよび localStorage との連携
const memoryCache = new Map<string, PieceData>();

// 古いバグデータのワンタイムクリーンアップ
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    const cachedData = localStorage.getItem('shogi_piece_cache');
    if (cachedData) {
      const cacheObj = JSON.parse(cachedData);
      let updated = false;
      const keysToRemove = ['メタモン', 'スパイ', '𰻞𰻞麺'];
      for (const key of keysToRemove) {
        const normalizedKey = key.trim().toLowerCase();
        if (cacheObj[normalizedKey]) {
          delete cacheObj[normalizedKey];
          updated = true;
        }
      }
      if (updated) {
        localStorage.setItem('shogi_piece_cache', JSON.stringify(cacheObj));
        console.info('Cleared outdated localStorage piece cache for Metamon, Spy, and BiangBiangMian.');
      }
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
    description = '【能力効果】自ターン開始時に自動発動。周囲の空きマスに「複製社員」を1体生成する。発動後3手番の間は『充填中』となり、能力がフリーズし、前後左右に1マス動ける充填状態となる。';
    promoted_effect = {
      effect_name: '定時退社 (ていじたいしゃ)',
      description: '【覚醒効果】成ることでクールダウン（充填手番）が1手番短縮される。'
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
    description = '【能力効果】自律暴走。この駒はプレイヤーの指示を受け付けず、手番開始時にAIが勝手に周囲の空きマスへ暴走移動する。';
    promoted_effect = {
      effect_name: '狂気満腹 (きょうきまんぷく)',
      description: '【覚醒効果】成ることで暴走移動の範囲が2マス先まで拡大する。'
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
    description = '【能力効果】罠特性。裏向きで配置され、相手には正体が見えない。敵の駒に重なり取られた瞬間に開示され、敵駒を道連れに破壊して両者消滅する。';
    promoted_effect = {
      effect_name: '甘美魅了 (かんびみりょう)',
      description: '【覚醒効果】成った瞬間、再び裏向き（隠蔽状態）に戻る。'
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
    description = '【能力効果】環境結界。常時発動。周囲2マス以内に潜む敵の裏向きの罠駒の正体を強制開示（表向き）にする。';
    promoted_effect = {
      effect_name: '神獣威嚇 (しんじゅういかく)',
      description: '【覚醒効果】成ることで索敵開示の結界範囲が周囲3マスに拡大する。'
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
    description = '【能力効果】跳躍移動。常時発動。途中に障害物（敵味方の駒）が存在しても、それを飛び越えて桂馬のように斜め前方へ跳躍移動できる。';
    promoted_effect = {
      effect_name: '赤兎一閃 (せきといっせん)',
      description: '【覚醒効果】成ることで、左右および後方へも跳躍移動が可能になる。'
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
    description = '【能力効果】飛車移動。常時発動。縦横 of 直線方向に何マスでもスライド移動できる（障害物に遮られる）。';
    promoted_effect = {
      effect_name: '龍王覚醒 (りゅうおうかくせい)',
      description: '【覚醒効果】成ることで、斜め4方向の1マス移動が追加される。'
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
    description = '【能力効果】角行移動。常時発動。斜め4マスの直線方向に何マスでもスライド移動できる（障害物に遮られる）。';
    promoted_effect = {
      effect_name: '龍馬覚醒 (りゅうまかくせい)',
      description: '【覚醒効果】成ることで、上下左右4方向の1マス移動が追加される。'
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
    description = '【能力効果】香車移動。常時発動。前方の直線方向に何マスでもスライド移動できる（障害物に遮られる）。';
    promoted_effect = {
      effect_name: '成香覚醒 (なりきょうかくせい)',
      description: '【覚醒効果】成ることで金将と同じ動きが可能になる。'
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
    description = '【能力効果】桂馬移動。常時発動。前方の左右斜め2マスの位置へ飛び越えて移動できる。';
    promoted_effect = {
      effect_name: '成桂覚醒 (なりけいかくせい)',
      description: '【覚醒効果】成ることで金将と同じ動きが可能になる。'
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
    description = '【能力効果】移動完了時自動発動。隣接する相手のカスタム駒の能力（名前、説明、移動範囲、効果コード）を完全にコピー（擬態化）する。';
    promoted_effect = {
      effect_name: '百面相 (ひゃくめんそう)',
      description: '【覚醒効果】成ることで擬態時のクールダウンが完全に消失する。'
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
    description = '【能力効果】移動完了時自動発動。隣接するすべての敵駒（王将を除く）の精神を支配し、自分の駒（所有権寝返り）にする。';
    promoted_effect = {
      effect_name: '狂信支配 (きょうしんしはい)',
      description: '【覚醒効果】成ることで支配範囲が周囲2マスへ拡大する。'
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
    description = '【能力効果】時限羽化。この駒は配置されてから3手番の間は移動できず（歩兵移動）、3手番目のターン開始時に「邪竜・ファヴニール」へと超進化を遂げる。';
    promoted_effect = {
      effect_name: '進化促進 (しんかそくしん)',
      description: '【覚醒効果】成った瞬間、即座に孵化・進化を完了する。'
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
    description = '【能力効果】因果応報。この駒が捕獲された瞬間、自身を捕獲した敵の駒を呪いによって道連れにし、共に盤面から消滅（破壊）させる。';
    promoted_effect = {
      effect_name: '大呪界 (だいじゅかい)',
      description: '【覚醒効果】成った時に捕獲されると、捕獲した駒の周囲1マスの敵もすべて道連れにする。'
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
    description = '【能力効果】巣特性。この駒は移動能力を持たない（移動力ゼロ）が、毎ターン開始時に周囲の空きマスに「子蜘蛛」を1体自動量産する。';
    promoted_effect = {
      effect_name: '軍隊蜂起 (ぐんたいほうき)',
      description: '【覚醒効果】成ることで、生成するミニオンが強力な「兵隊蜘蛛」に変化する。'
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
      description = `【能力効果】移動完了時自動発動。目的地に着地した際、進行方向の直線上にいるすべての敵駒を押しつぶし、捕獲して手駒にする。発動後2手番は充填中となり、前後左右に1マス動ける充填状態となる。`;
      promoted_effect = {
        effect_name: '破山一撃 (はざんいちげき)',
        description: '【覚醒効果】成ることで、突撃によりなぎ倒す距離が3マス先まで増加する。'
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
      description = `【能力効果】罠特性。裏向きで配置され、敵の駒が周囲1マス以内に接近した瞬間に姿が開示される。`;
      promoted_effect = {
        effect_name: '影武者替身 (かげむしゃがわり)',
        description: '【覚醒効果】成った瞬間、再び裏向き（隠蔽状態）に戻る。'
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
      description = `【能力効果】環境結界。常時発動。周囲2マス以内に侵入した敵の駒の移動力を最大1マスに制限する。`;
      promoted_effect = {
        effect_name: '天地震動 (てんちしんどう)',
        description: '【覚醒効果】成ることで、移動力制限の結界範囲が周囲3マスに拡大する。'
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
    description: `${warningPrefix} ${description}`,
    spawn_piece_name,
    spawn_config,
    promoted_effect,
    deep_search_analysis: 'オフライン環境でのゲームバランスに即した自動能力設計。',
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

### 📚 AI能力デザインの引き出し（10大ジャンルと24の参考例プール）

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

#### 【ジャンル7：自律暴走・自動移動系（AUTOMATIC_DRIVE）】
- No.18: [完全ランダム暴走（RANDOM_TELEPORT）] - 毎ターン開始時（TURN_START）、プレイヤーの指示を無視して、盤面全体のランダムな空きマスへ勝手にワープする（logic_code: 'random_teleport'）。
- No.19: [猪突猛進（RUNAWAY_DRIVE）] - 自分の手番の終わり（ON_MOVE）に、自動的に前方の障害物（駒または壁）にぶつかるまで真っ直ぐ進む移動を強制実行する（logic_code: 'runaway_drive'）。

#### 【ジャンル8：感染・デバフ系（VIRUS_INFECT）】
- No.20: [行動封印・呪縛（curse_stun）] - 取られた時（ON_TAKEN）に発動。自身を取った敵駒を3ターンの間、行動封印（完全に移動不可能）状態にする。
- No.21: [能力封印（curse_silence）] - 取られた時（ON_TAKEN）に発動。自身を取った敵駒のすべての特殊能力と移動範囲を永久に奪い、前進1マスのみ動ける「普通の歩兵」に弱体化させる。
- No.22: [死の宣告（curse_death）] - 取られた時（ON_TAKEN）に発動。自身を取った敵駒に3ターンの死のカウントダウンを付与し、3ターン経過後にその敵駒を自動消滅させる。

#### 【ジャンル9：位置入れ替え系（SPACE_WARP）】
- No.23: [位置スワップ（SWAP）] - 移動完了時、盤面にある「自分の通常歩兵1枚」を指定し、この駒と位置を一瞬で入れ替える（クールタイム3ターン）。

#### 【ジャンル10：墓地利用・リサイクル系（NECROMANCY）】
- No.24: [死者蘇生（RECYCLE）] - 1ゲーム1回限定。移動完了時、これまでに完全に破壊されて消滅したカスタム駒を1つ指定し、自分の「持ち駒（ストック）」として手札に復活させる。

#### 【ジャンル11：能力無効化・結界系（NULLIFY）】
- No.25: [呪文無効・結界（NULLIFY）] - 永続パッシブ（ALWAYS）または使い捨て。この駒が盤面に存在する限り、周囲2マス以内で発動した敵の自動能力（直線貫通や洗脳、変身など）の対象になった際、その効果を【1度だけ完全に無効化（フリーズ）】して防ぐ聖域ロジック。

---

### 🚨 必須ルール
1. 【カタカナ語完全禁止】「ショット」「ノヴァ」「レーザー」「バリア」「スタン」「バフ」「デバフ」「HP」「MP」「クールダウン」「パッシブ」「アクティブ」を能力名・説明文に使うな。漢語・和語で表現すること。
2. 【スタン・拘束の原則禁止と呪い（ON_TAKEN）でのみ例外許可】敵駒を「行動不能・移動不能・拘束」にする通常効果は禁止。ただし、駒が取られた時（ON_TAKEN）に発動する「行動封印・呪縛（curse_stun: 3ターンの間行動封印・呪縛）」「能力封印（curse_silence: 永続的にただの歩兵化）」「死の宣告（curse_death: 3ターン後に消滅）」の呪い効果に限り、例外として許可する。
3. 【手動ボタン消費系（ACTIVE_USE）は完全禁止】すべて全自動発動（ALWAYS, ON_MOVE, TURN_START, ON_TAKEN, ON_APPROACH）に統一すること。
4. 【1ゲームに1回（使い捨て）の場合】is_once_per_game: true とし、cool_down_turns: 0 を設定すること。発動後はゲーム終了まで移動力・移動範囲を一律で「前後左右に1マス動ける十字移動（charging_grid）」の充填状態となるペナルティを課すこと。効果説明内にも必ず「前後左右に1マス動ける充填状態となる」という統一した表現で明記すること。
5. 【何度も使える効果の場合】is_once_per_game: false とし、cool_down_turns: 2〜4 を設定すること。クールタイム中の数ターンは移動範囲が前後左右に1マス動ける十字移動に極小化するペナルティ（充填状態）を課すこと。効果説明内にも必ず「前後左右に1マス動ける充填状態となる」という統一した表現で明記すること。
6. 【増殖系（SPAWNER）の絶対制限】盤面に生み出すトークンの上限は最大2体（max_limit: 2）とすること。
7. 【永続パッシブの制限】永続パッシブ能力（ALWAYS）を持つ強力な駒は、本体の移動範囲（normal_grid）を「0マス（1マスも動けない完全固定）」または「前進1マス」に設定すること。

---

### 💻 出力JSONフォーマット（純粋なJSONのみ。Markdownのバッククォートや解説文は一切禁止）
{
  "word": "プレイヤーが入力した単語",
  "effect_name": "漢字の能力名",
  "mechanics_type": "内部属性コード（'FORCE_CRUSH' / 'HACK_AND_STEAL' / 'STEALTH_GHOST' / 'SUPPORT_BUFF' / 'SPAWNER_BUILD' / 'TRAP_MINE' / 'AUTOMATIC_DRIVE' / 'UNKNOWN_HERESY' 等）",
  "ability_genre": "画面の属性欄に表示する日本語のジャンル名（例: '武力・突撃', '擬態・洗脳', 'ステルス・隠密', '能力無効化・結界', '支援・強化' など単語から適切に選択）",
  "trigger": "発動形式（'ALWAYS' / 'ON_MOVE' / 'TURN_START' / 'ON_TAKEN' / 'ON_APPROACH'）",
  "is_once_per_game": true,
  "cool_down_turns": 0,
  "range_geometry": {
    "normal_grid": "通常時5x5範囲（周囲2マスの場合は外周の計算ミス厳禁）",
    "charging_grid": "0000000100012100010000000" // 十字移動に完全固定
  },
  "description": "【能力効果】（日本語。いつどういう条件で【自動発動】するのか、1ゲーム1回限定の有無、能力使用後の十字移動への弱体化などを明記。カタカナ語排除）",
  "spawn_config": {
    "spawn_piece_name": "生み出す駒名（不要ならnull）",
    "max_limit": 2,
    "spawn_range_geometry": "生み出す範囲の5x5グリッド（不要ならnull）"
  },
  "promoted_effect": {
    "effect_name": "成った時の能力名",
    "description": "【覚醒効果】敵陣に入って成った時の進化効果説明（カタカナ語排除）"
  },
  "logic_code": "移動パターンまたは特殊ロジック（スライド移動は 'move_like_rook'/'move_like_bishop'/'move_like_lance'/'move_like_knight'。それ以外は一意の英語識別子）",
  "deep_search_analysis": "ゲームバランス的解説"
}

### 生成対象のユーザー入力単語:
"${word}"

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
      charging_grid: '0000000100012100010000000'
    };
  } else {
    let norm = parsed.range_geometry.normal_grid;
    let chg = parsed.range_geometry.charging_grid;

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

    parsed.range_geometry = {
      normal_grid: norm,
      charging_grid: chg
    };
  }

  return parsed as PieceData;
}
