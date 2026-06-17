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
    return memoryCache.get(key) || null;
  }
  try {
    const cachedData = localStorage.getItem('shogi_piece_cache');
    if (cachedData) {
      const cacheObj = JSON.parse(cachedData);
      if (cacheObj[key]) {
        memoryCache.set(key, cacheObj[key]);
        return cacheObj[key];
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
      // ローカルキャッシュにも保存して次回以降を高速化
      saveToCache(word, data);
      return data;
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
  let mechanics_type: 'MOVEMENT_HACK' | 'STEALTH_TRAP' | 'RULE_BREAK' | 'DYNAMICS_HACK' = 'MOVEMENT_HACK';
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
    charging_grid: '0000000100002000000000000' // Fixed to forward-1-cell during cooldown
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
    description = '【能力効果】自ターン開始時に自動発動。周囲の空きマスに「複製社員」を1体生成する。発動後3手番の間は『充填中』となり、能力がフリーズし、移動が前進1マスのみに制限される。';
    promoted_effect = {
      effect_name: '定時退社 (ていじたいしゃ)',
      description: '【覚醒効果】成ることでクールダウン（充填手番）が1手番短縮される。'
    };
    range_geometry = {
      normal_grid: '0010001110112110111000100',
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      normal_grid: '0000000100002000000000000',
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      charging_grid: '0000000100002000000000000'
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
      description = `【能力効果】移動完了時自動発動。目的地に着地した際、進行方向の直線上にいるすべての敵駒を押しつぶし、捕獲して手駒にする。発動後2手番は充填中となり、移動が前進1マスに極小化する。`;
      promoted_effect = {
        effect_name: '破山一撃 (はざんいちげき)',
        description: '【覚醒効果】成ることで、突撃によりなぎ倒す距離が3マス先まで増加する。'
      };
      range_geometry = {
        normal_grid: '0000001110002000000000000',
        charging_grid: '0000000100002000000000000'
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
        charging_grid: '0000000100002000000000000'
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
        charging_grid: '0000000100002000000000000'
      };
    }
  }

  const result: PieceData = {
    word,
    effect_name,
    mechanics_type,
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

  saveToCache(word, result);
  return result;
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

ユーザーが入力した単語から能力を【完全新規で創造】してください。以下の【5大ジャンルと15のサンプル（引き出し）】は、将棋のルールをどの程度までハックしてよいかという『技術的な許容基準（参考・ヒント）』です。サンプル通りのコピペは手抜きとみなし、制限します。入力単語の独自のニュアンスを深掘りし、サンプルの枠を飛び越えた、まったく新しい自動発動ギミックや戦術ロジックを即興でブレインストーミングして創造することを最優先（プライオリティ1）としてください。
※体力や攻撃力、手動奥義ボタンは完全に廃止されています。一撃捕獲ルールです。

---

### 📐 幾何学範囲（grid_map）の空間計算ルールの厳格化
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

能力を使い切った後または充填中の charging_grid は一律「前進1マス（0000000100002000000000000）」に固定。

---

### 📚 AI能力デザインの引き出し（5大ジャンルと15の参考例プール）

#### 【ジャンル1：洗脳・擬態・強奪系（HACK_AND_STEAL）】
敵の駒や能力をハックして戦況をひっくり返すトリッキーなジャンル。
- No.1: [精神洗脳（PUPPET）] - trigger: 'TURN_START' または 'ON_MOVE'。周囲1マスに敵の大駒またはカスタム駒が存在する時のみ自動発動。1ゲームに1回限定（is_once_per_game: true）で、次の自ターンにその敵駒を乗っ取って操作。発動後は歩兵化。
- No.2: [即時変身（TRANSFORM）] - 動いて着地した時、盤面の他駒の能力・移動範囲に自分を書き換え（1ゲームに1回限定）。logic_code: 'transform'
- No.3: [能力強奪（STEAL）] - 敵駒を取った瞬間に自動発動。取った敵の固有能力と範囲を永続上書き。logic_code: 'ability_theft'

#### 【ジャンル2：ステルス・隠密系（STEALTH_GHOST）】
心理戦・ブラフ特化のジャンル。
- No.4: [近接探知型ステルス（INVISIBILITY）] - 相手画面からは完全な空きマスに見える。互いが周囲1マスに進入した瞬間のみ自動表示。2マス以上離れると再び見えなくなる。永続パッシブ（is_once_per_game: false）。
- No.5: [偽装表示（DISGUISE）] - 相手画面からはただの歩兵に見えるが、自分側からは本来の姿と変則移動範囲が見える。

#### 【ジャンル3：武力・突撃系（FORCE_CRUSH）】
盤面の物理破壊を目的とした攻撃型ジャンル。
- No.6: [直線貫通（CRUSH）] - 動いた方向ベクトル上の全敵駒をすべて一気に捕獲して突き抜ける（1ゲームに1回限定）。logic_code: 'linear_charge'
- No.7: [全方位衝撃波（SHOCKWAVE）] - 着地した瞬間、周囲1〜2マスの敵を全員一瞬で吹き飛ばして捕獲（1ゲームに1回限定）。logic_code: 'shockwave'
- No.8: [障害跳躍（LEAP）] - 進路上の駒を完全無視してワープ着地。何度も使用可能な移動特性。logic_code: 'leap_move'

#### 【ジャンル4：置物・自動生誕系（SPAWNER_BUILD）】
移動を放棄し盤面を支配する嫌がらせジャンル。
- No.9: [自動量産（SPAWNER）] - 自身は動けない代わりに毎ターン隣接マスに兵を自動生成。max_limit:2 の spawn_config 必須。logic_code: 'spawn_minion'
- No.10: [環境鈍化（SLOWNESS）] - この駒が盤面にいる限り、周囲2マスの全駒の移動力を「前進1マス」に制限。logic_code: 'slowdown_aura'
- No.11: [磁力操作（MAGNET）] - ターン開始時、同じ縦・横ライン上の全駒を自分の方へ1マス強制引き寄せ（または外側へ弾く）。logic_code: 'magnet_pull'

#### 【ジャンル5：因果逆転・罠系（TRAP_MINE）】
相手の攻撃を逆手に取る防衛・カウンタージャンル。
- No.12: [道連れ地雷（MINE）] - 裏向き配置。敵に取られた瞬間に開示・相打ち爆破（1回使い捨て）。logic_code: 'self_destruct_trap'
- No.13: [落とし穴（TRAP）] - 裏向き配置。周囲1マスに敵が侵入した瞬間に開示。logic_code: 'stealth_decoy'
- No.14: [身代わり（SUBSTITUTE）] - 味方の王将が危険な時、自動でその位置へワープして盾になり身代わりに捕獲される（1ゲームに1回限定）。logic_code: 'substitute'
- No.15: [時限進化（TIMER）] - 配置後3ターンは動けないが、4ターン目開始時に最強駒へ強制進化または大爆発。logic_code: 'time_bomb'

---

### 🚨 必須ルール
1. 【カタカナ語完全禁止】「ショット」「ノヴァ」「レーザー」「バリア」「スタン」「バフ」「デバフ」「HP」「MP」「クールダウン」「パッシブ」「アクティブ」を能力名・説明文に使うな。漢語・和語で表現すること。
2. 【スタン・拘束禁止】敵駒を「行動不能・移動不能・拘束」にする効果は禁止。爆破・引き寄せ・変身・洗脳・盗取などで代替すること。
3. 【1ゲーム1回限定の場合】is_once_per_game: true とし、cool_down_turns: 0 を設定すること（ゲームロジックが永続歩兵化を自動適用する）。
4. 【何度も使える効果の場合】is_once_per_game: false とし、強力なものは cool_down_turns: 2〜4 を設定すること。
5. 【サンプルを超えること】サンプルのコピペは手抜き。入力単語の独自性を深掘りした完全オリジナルの効果を最優先で創造すること。

---

### 💻 出力JSONフォーマット（純粋なJSONのみ。Markdownのバッククォートや解説文は一切禁止）
{
  "word": "プレイヤーが入力した単語",
  "effect_name": "その言葉のソウルを体現した、洗練された漢字の能力名",
  "mechanics_type": "属性（'HACK_AND_STEAL' / 'STEALTH_GHOST' / 'FORCE_CRUSH' / 'SPAWNER_BUILD' / 'TRAP_MINE' / 'UNKNOWN_HERESY'）",
  "trigger": "発動形式（'ALWAYS' / 'ON_MOVE' / 'TURN_START' / 'ON_TAKEN' / 'ON_APPROACH'）",
  "is_once_per_game": false,
  "cool_down_turns": 0,
  "range_geometry": {
    "normal_grid": "通常時の5x5範囲（25文字の0,1,2の数値文字列。中心インデックス12は必ず2。外周まで正確に計算すること）",
    "charging_grid": "一律 '0000000100002000000000000' に固定"
  },
  "description": "【能力効果】（日本語。いつどういう条件で自動発動するのか。1ゲーム1回限定の場合は発動後の永続歩兵化ペナルティを明記。カタカナ語排除）",
  "spawn_piece_name": null,
  "spawn_config": {
    "spawn_piece_name": "生み出す駒名（不要ならnull）",
    "max_limit": 0,
    "spawn_range_geometry": null
  },
  "promoted_effect": {
    "effect_name": "成った時の能力名",
    "description": "【覚醒効果】敵陣に入って成った時の進化効果説明（カタカナ語排除）"
  },
  "logic_code": "移動パターンまたは特殊ロジック（スライド移動は 'move_like_rook'/'move_like_bishop'/'move_like_lance'/'move_like_knight'。それ以外は上記サンプルのlogic_codeまたは適切な一意の英語識別子）",
  "deep_search_analysis": "サンプルをどう参考にしたか、あるいはどう超越したか、この単語からどうやってこの全く新しいオリジナルのゲームバランスとロジックを導き出したのかの熱い解説"
}

### 生成対象のユーザー入力単語:
"${word}"

上記の単語の持つ意味・イメージ・性質を徹底分析し、5大ジャンルと15の引き出しを参照しながら、それを超越した完全オリジナルの対人戦最高カオス駒オブジェクトをJSONで生成してください。
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

    // Repair word
    if (!parsed.word || typeof parsed.word !== 'string') {
      parsed.word = word;
    }

    // Repair mechanics_type: map new 5-genre names to internal legacy names
    const mechanicsTypeMap: Record<string, string> = {
      'HACK_AND_STEAL': 'DYNAMICS_HACK',
      'STEALTH_GHOST':  'STEALTH_TRAP',
      'FORCE_CRUSH':    'MOVEMENT_HACK',
      'SPAWNER_BUILD':  'RULE_BREAK',
      'TRAP_MINE':      'STEALTH_TRAP',
      'UNKNOWN_HERESY': 'DYNAMICS_HACK',
    };
    if (parsed.mechanics_type && mechanicsTypeMap[parsed.mechanics_type]) {
      parsed.mechanics_type = mechanicsTypeMap[parsed.mechanics_type];
    }
    if (!parsed.mechanics_type || !['MOVEMENT_HACK', 'STEALTH_TRAP', 'RULE_BREAK', 'DYNAMICS_HACK'].includes(parsed.mechanics_type)) {
      parsed.mechanics_type = 'MOVEMENT_HACK';
    }

    // Repair trigger
    if (!parsed.trigger || !['ALWAYS', 'ON_MOVE', 'TURN_START', 'ON_TAKEN', 'ON_APPROACH'].includes(parsed.trigger)) {
      parsed.trigger = 'ALWAYS';
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
    // Repair logic_code
    if (!parsed.logic_code || typeof parsed.logic_code !== 'string') {
      if (parsed.mechanics_type === 'STEALTH_TRAP') {
        parsed.logic_code = parsed.trigger === 'ON_TAKEN' ? 'self_destruct_trap' : 'stun_approach_trap';
      } else if (parsed.mechanics_type === 'RULE_BREAK') {
        parsed.logic_code = parsed.trigger === 'TURN_START' ? 'spawn_clone' : 'slowdown_aura';
      } else {
        parsed.logic_code = parsed.trigger === 'ON_MOVE' ? 'linear_charge' : 'leap_move';
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
        charging_grid: '0000000100002000000000000'
      };
    } else {
      let norm = parsed.range_geometry.normal_grid;
      let charg = parsed.range_geometry.charging_grid;

      if (typeof norm === 'string') {
        norm = norm.replace(/[^012]/g, '');
      }
      if (typeof charg === 'string') {
        charg = charg.replace(/[^012]/g, '');
      }

      if (typeof norm !== 'string' || norm.length !== 25) {
        norm = '0000001110012100111000000';
      }
      if (typeof charg !== 'string' || charg.length !== 25) {
        charg = '0000000100002000000000000';
      }

      parsed.range_geometry = {
        normal_grid: norm,
        charging_grid: charg
      };
    }

    const resultPiece = parsed as PieceData;
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
