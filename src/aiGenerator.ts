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
      const keysToRemove = ['メタモン', 'スパイ'];
      for (const key of keysToRemove) {
        const normalizedKey = key.trim().toLowerCase();
        if (cacheObj[normalizedKey]) {
          delete cacheObj[normalizedKey];
          updated = true;
        }
      }
      if (updated) {
        localStorage.setItem('shogi_piece_cache', JSON.stringify(cacheObj));
        console.info('Cleared outdated localStorage piece cache for Metamon and Spy.');
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
      description = `【能力効果】罠特性。裏向きで配置され、敵の駒が周囲1マス以内に接近した瞬間に姿が開示される。周囲を欺くためのデコイで、開示される以外に特殊な効果はない。`;
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

// Online Gemini API call for 3 Grand Stratagem Gimmicks & Cooldown Turns (9x9 Shogi)
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

  const prompt = `あなたは伝統的な将棋のルールをハックし、「変則移動」「正体隠蔽（ブラフ）」「環境ハック」「盤面ルール破壊」、そしてそれらの強大すぎる能力を制御する「充填手番（クールタイム）」の概念を融合させた、天才対人ゲームデザイナー兼プログラマーです。
ユーザーが入力した単語から能力を【自動的にシステム側でトリガー（発動）する自動効果】をゼロから創造し、9x9マスの将棋盤を揺るがす、極めて個性的でユーモア溢れる能力オブジェクト（JSON）を出力してください。
※体力（HP）、攻撃力、気力（MP）の概念は完全に廃止されています。すべての駒は重なれば一撃で捕獲されます。手動でボタンを押して発動する能力は絶対に設計しないでください。

### 🚨 4大奇策ギミックの自動判定ルール
入力された単語の性質に応じて、以下のいずれかの【主特性（mechanics_type）】をAI自身が自動判断して必ず組み込んでください。

1. 【変則移動・自律特性（MOVEMENT_HACK）】
   - 対象：動くもの、突撃、空間超越（例: 新幹線、忍者、カエル、ゴールドシップ、台風など）
   - 仕様：障害物を飛び越える「跳躍（LEAP）」、進路上の敵を全滅させる「一気貫通（CRUSH）」、プレイヤーの指示を無視して勝手に動く「自律暴走（ROUTINE）」などを設計。5x5の範囲マップ（grid_map）もこれに合わせて点灯させること。
2. 【正体隠蔽・罠特性（STEALTH_TRAP）】
   - 対象：潜むもの、地雷、騙すもの（例: 爆弾、ウイルス、落とし穴、スパイ、詐欺師など）
   - 仕様：盤面に存在する間、相手からはその駒が『完全に透明（空きマス）』に見えます（自分からは半透明で見えます）。敵の駒がその駒の周囲1マス以内に接近した時（気配感知）、またはそのステルス駒自身が移動した時に、自動でステルスが解除され姿が露見（開示）します。敵が重なった瞬間（ON_TAKEN）に爆発して敵を道連れにする罠（自爆）や、接近された時に逃げる（瞬間移動）等のユーモラスな効果を設計してください。※ゲームバランス維持のため、敵の駒を「行動不能（スタン・動揺・拘束・移動不可）」にする効果は絶対に禁止してください。
3. 【環境ハック・結界特性（RULE_BREAK）】
   - 対象：概念、法律、広域に影響を与えるもの（例: 裁判官、ブラック企業、沼、磁石、締め切りなど）
   - 仕様：その駒が盤面に表向きで存在する限り、周囲2マスの移動力を1に制限する「鈍化結界」、直線上の駒を1マス引き寄せる・弾く「磁力操作」、お互いに持ち駒を打てなくする「禁忌」などの環境ルール上書きロジックを設計。
4. 【その他、盤面ルールを破壊する自由な奇策（DYNAMICS_HACK）】
   単語の本質に合わせて、将棋の概念を覆す特殊なロジックを自由に創造してください。ただし、類似した以下の性質は明確に区別して設計すること。

   - 【擬態・変身（MIMIC_TRANSFORM）】: 「メタモン」「鏡」「カメレオン」など。
     ⇒ \`trigger\` を 'ON_MOVE' または 'ALWAYS' とし、移動先または隣接する「既存のカスタム駒（敵味方問わず）」を1つ指定し、その手番の間（または永続で）ターゲットの移動範囲や名称、効果を完全にコピーして自分自身をその場で書き換えるロジック（logic_code: 'identity_theft', 'transform'）。
   
   - 【強奪・泥棒（ABILITY_STEAL）】: 「泥棒」「ルパン」「ラーニング」など。
     ⇒ 敵の駒を「取った瞬間」に発動。その取った敵の駒が元々持っていた固有能力や移動範囲をそのまま自分のものとして奪い取り、自分自身のステータスを上書きするロジック（logic_code: 'ability_theft'）。

   - 【永続置物・自動生誕（SPAWNER）】: 「工場」「女王蜂」「巣」「インターネット」など。
     ⇒ 自分自身は一切動けない、または極端に移動が苦手な代わりに、ターン開始時（TURN_START）に指定の空きマスへ自動的に別の小さな兵隊駒（「製品」「働き蜂」など）をポコポコと自動生成・増殖させるロジック（logic_code: 'spawn_minion'）。無限増殖によるゲームバランス崩壊を防ぐため、盤面に同時に存在できるミニオン（生み出された駒）の最大数は【厳格に2体まで（リミット）】の制約があります。

   - 【寄生・洗脳（PUPPET_CONTROL）】: 「洗脳」「寄生虫」「甘い罠」など。
     ⇒ 移動して敵の駒の隣（周囲1マス）に着地した瞬間、その敵の駒を洗脳。次のターン、相手の駒であるはずのそれを、自分が手番を消費して勝手に操作・移動させることができるロジック（logic_code: 'mind_control'）。

   - 【時限・孵化（TIMER_BOMB）】: 「卵」「サナギ」「時限爆弾」など。
     ⇒ 指定された数手番（ターン）の間は一切動けないが、ターン経過後にパッと殻を破って最強の駒へと強制進化する、あるいは周囲数マスを巻き込んで大爆発消滅するロジック（logic_code: 'timer_evolution', 'time_bomb'）。

### 🚨 効果トリガー（trigger）の厳密な分類
発動タイミング（trigger）を以下のいずれかに厳密に分類してください。

1. 'ALWAYS'（常時永続）: 盤面に存在するだけで常に周囲に影響を与える（例: 鈍化結界、ルールハックなど）。クールタイムは0。
2. 'ON_MOVE'（移動完了時自動発動）: プレイヤーがその駒を動かして目的地に着地した瞬間に自動で効果が誘発する（例: 着地した隣接マスに複製兵を生み出す、着地時に周囲を爆破するなど）。強力なものは cool_down_turns を設定。
3. 'TURN_START'（自ターン開始時自動発動）: その駒が盤面に生き残っている場合、自分の手番が回ってきた瞬間に自動で効果が誘発する（例: 毎ターン自動で増殖する、周囲を引き寄せるなど）。
4. 'ON_TAKEN' / 'ON_APPROACH': 伏せ駒（罠）や呪い身代わり駒が取られた時、または接近された時に自動開示されて発動する。

### 🚨 強すぎる効果への「充填手番（クールタイム）」算定規則
- 「着地時に周囲を爆破（ON_MOVE）」や「毎ターン周囲を引き寄せる（TURN_START）」など、強力な自動効果を設計した場合、必ず \`cool_down_turns\`（再充填に必要な手番数：2〜4ターン）を設定してください。
- 効果が自動発動した次のターンから指定手番が経過するまでは、その駒の能力はフリーズし、移動範囲も「前進1マス（歩兵と同等）」に超弱体化するペナルティ（充填中状態）がゲーム上で適用されます。
- 常時発動（ALWAYS）のパッシブ能力や、1回発動したら消滅する使い捨ての罠（TRAP）、または呪い（ON_TAKEN）の場合は、\`cool_down_turns\` を \`0\` にしてください。

### 🚨 範囲幾何学データ（range_geometry）の生成規則（手抜き前進1マスは厳禁）
カード上に移動や効果の及ぶ範囲を視覚的に表示するため、5x5マスの二次元配列を模した「25文字の数値文字列」を必ず計算して出力してください。
1. normal_grid にには「通常時（能力発動可能時）」の5x5範囲を設定してください。
2. charging_grid には「能力使用後、充填中（クールタイム中）の5x5範囲」を設定してください。手抜き厳禁、原則前進1マスのみの '0000000100002000000000000' に固定です。
3. 5x5の中心（3行目の3列目、インデックス12番目。0から数えて12番目）は必ず自分自身を表す "2" にしてください。
4. normal_grid の移動や効果 of 範囲（1を立てるマス）は、単語のイメージに合わせて【3マス〜6マス程度】を必ず大胆に点灯させてください。増殖の巣など動かないものは周囲のみを1にし、移動力がないことを説明してください。

### 🚨 カタカナ語（安易なゲーム用語）の禁止
能力名や効果説明に、「ショット」「ノヴァ」「レーザー」「バリア」「ステータス」「バフ」「デバフ」「スキル」「シールド」「クールダウン」「クールタイム」「パッシブ」「アクティブ」「HP」「MP」といった、世界観を壊す安易なカタカナ語を一切使わないでください。代わりに「奥義」「常時」「充填」「体力」「気力」などと表現してください。手動で発動するボタンの記述は完全排除してください。

### 出力フォーマット（厳密にこのJSON構造のみを出力してください。Markdownのバッククォートなどの装飾は一切含めず、純粋なJSONテキストのみを返すか、またはJSON形式で出力してください。）
\`\`\`json
{
  "word": "プレイヤーが入力した単語",
  "effect_name": "その言葉の特性を体現した、洗練された漢字の能力名",
  "mechanics_type": "自動判定された属性（'MOVEMENT_HACK' / 'STEALTH_TRAP' / 'RULE_BREAK' / 'DYNAMICS_HACK' / 'DYNAMICS_HACK'）",
  "trigger": "発動形式（'ALWAYS' / 'ON_MOVE' / 'TURN_START' / 'ON_TAKEN' / 'ON_APPROACH'）",
  "cool_down_turns": 3, // 強すぎる自動効果の充填手番数（発動後、このターン数は再発動不可。パッシブや罠は0）
  "range_geometry": {
    "normal_grid": "通常時の5x5範囲（25文字 of 0,1,2の数値文字列。中心は2）",
    "charging_grid": "能力発動後、充填中（クールタイム中）の5x5範囲（歩兵化: '0000000100002000000000000'）"
  },
  "description": "【能力効果】（日本語。いつ、どういう条件でこの能力が【自動発動】するのか、およびクールタイム中の弱体化ペナルティの挙動を明確に記述。手動ボタンの記述は完全排除）",
  "spawn_piece_name": "ミニオン名など", // コピーや増殖系など、別駒を生み出すロジックが必要な場合のみAIに命名させる（不要ならnull）
  "spawn_config": {
    "spawn_piece_name": "生み出される駒の名称（不要な場合はnull）",
    "max_limit": 2, // 盤面に同時に存在できる最大数（1または2。生み出さない場合は0）
    "spawn_range_geometry": "どの範囲に生み出すかの5x5グリッドデータ（不要ならnull、通常は'0000001110012100111000000'など）"
  },
  "promoted_effect": {
    "effect_name": "覚醒時の能力名",
    "description": "【覚醒効果】成った時の進化説明（自動発動のクールタイムが減少する、生み出す兵が強化されるなど）"
  },
  "logic_code": "移動パターンまたは特殊ロジック（スライド移動させたい場合は 'move_like_rook'（飛車型） / 'move_like_bishop'（角行型） / 'move_like_lance'（香車型） / 'move_like_knight'（桂馬型）。それ以外は適当な一意の英語識別子、または 'normal'）",
  "deep_search_analysis": "なぜその言葉からこのギミック、およびこの充填手番（クールタイム）の長さを導き出したのか、対人戦のゲームバランスを踏まえたロジカルな解説"
}
\`\`\`

### 生成対象のユーザー入力単語:
"${word}"

上記の単語の持つ意味、イメージ、性質を徹底的に分析し、その特徴を完璧に体現する能力駒オブジェクトをJSONで生成してください。
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

    // Repair mechanics_type
    if (!parsed.mechanics_type || !['MOVEMENT_HACK', 'STEALTH_TRAP', 'RULE_BREAK', 'DYNAMICS_HACK'].includes(parsed.mechanics_type)) {
      parsed.mechanics_type = 'MOVEMENT_HACK';
    }

    // Repair trigger
    if (!parsed.trigger || !['ALWAYS', 'ON_MOVE', 'TURN_START', 'ON_TAKEN', 'ON_APPROACH'].includes(parsed.trigger)) {
      parsed.trigger = 'ALWAYS';
    }

    // Repair cool_down_turns
    if (typeof parsed.cool_down_turns !== 'number') {
      parsed.cool_down_turns = parseInt(parsed.cool_down_turns as any) || 0;
    }
    parsed.cool_down_turns = Math.max(0, Math.min(4, parsed.cool_down_turns));

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
