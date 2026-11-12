import React, { useEffect, useRef, useState } from 'react';
import { generatePieceWithSource, clearAllCustomPieceCache, warmUpGenerator, BlockedWordError, forgetCachedPiece } from '../aiGenerator';
import { onlineConfigured, reportPiece } from '../onlineStore';
import { wordKey } from '../../shared/wordKey';
import { openXShare } from '../share';
import type { Piece, Player } from '../types';
import { generateId } from '../gameLogic';
import { PieceDetailCard } from './PieceDetailCard';
import { ProgramAbilityList } from './ProgramAbilityList';
import { normalizeFusionWord } from '../../shared/challenge';
import type { PartialPiece } from '../../shared/partialPiece';

/** 生成中の駒の移動範囲（5x5）。AIが書き終えた時点で表示する */
const MiniRange: React.FC<{ grid: string; color: string }> = ({ grid, color }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 12px)', gap: '2px' }} aria-label="移動範囲">
    {grid.split('/').join('').split('').map((c, i) => (
      <span key={i} style={{ width: '12px', height: '12px', borderRadius: '2px', background: c === '2' ? '#111' : c === '1' ? color : 'rgba(0,0,0,0.06)' }} />
    ))}
  </div>
);

interface PieceCreatorProps {
  player: Player;
  onPiecesReady: (pieces: Piece[]) => void;
  vsAiMode: boolean;
  setupSubPhase: 'sente_create' | 'gote_create';
  onlineMode?: boolean;
  myRole?: 'sente' | 'gote' | null;
  onlineOpponentReady?: boolean;
  onlineSelfReady?: boolean;
  playerNames: { sente: string; gote: string };
  /** 「今日のお題」のように、作る単語が決まっているとき（自動で生成し、入力欄は出さない） */
  presetWords?: string[];
}

export const PieceCreator: React.FC<PieceCreatorProps> = ({
  player,
  onPiecesReady,
  vsAiMode,
  setupSubPhase,
  onlineMode = false,
  myRole = null,
  onlineOpponentReady = false,
  onlineSelfReady = false,
  playerNames,
  presetWords,
}) => {
  const [word, setWord] = useState('');
  // 生成中の単語。複数の単語を並行して生成できるようにし、3枚分の待ち時間を1枚分程度に短縮する
  const [pendingWords, setPendingWords] = useState<{ key: string; word: string; preview?: PartialPiece }[]>([]);
  const loading = pendingWords.length > 0;
  const [createdPieces, setCreatedPieces] = useState<Piece[]>([]);
  const [notice, setNotice] = useState('');

  const maxPieces = 3; 
  const leftRole = onlineMode ? (myRole || 'sente') : player;
  const rightRole = leftRole === 'sente' ? 'gote' : 'sente';

  const leftLabel = onlineMode
    ? `${leftRole === 'sente' ? '▲' : '▽'} ${playerNames[leftRole] || (leftRole === 'sente' ? 'プレイヤー1' : 'プレイヤー2')} (あなた)`
    : `${leftRole === 'sente' ? '▲' : '▽'} ${playerNames[leftRole] || 'プレイヤー1'}${vsAiMode ? '' : (leftRole === 'sente' ? ' (Player 1)' : ' (Player 2)')}`;

  const rightLabel = onlineMode
    ? `${rightRole === 'sente' ? '▲' : '▽'} ${playerNames[rightRole] || (rightRole === 'sente' ? 'プレイヤー1' : 'プレイヤー2')} (対戦相手)`
    : vsAiMode
      ? 'CPU（思考エンジン）'
      : `${rightRole === 'sente' ? '▲' : '▽'} ${playerNames[rightRole] || 'プレイヤー2'}${rightRole === 'sente' ? ' (Player 1)' : ' (Player 2)'}`;


  const slotsUsed = createdPieces.length + pendingWords.length;

  useEffect(() => {
    warmUpGenerator();
  }, []);


  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = word.trim();
    if (!target || slotsUsed >= maxPieces) return;
    setWord('');
    await generateWord(target);
  };

  // 決まった単語（今日のお題）は画面を開いたら自動で作る。StrictMode の二重実行でも1回だけ
  const presetStarted = useRef(false);
  useEffect(() => {
    if (!presetWords?.length || presetStarted.current) return;
    presetStarted.current = true;
    presetWords.slice(0, maxPieces).forEach(w => { void generateWord(w); });
    // generateWord は毎回作り直される関数だが、最初の1回だけ使えばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetWords]);

  const generateWord = async (target: string) => {
    const key = generateId();
    setPendingWords(prev => [...prev, { key, word: target }]);

    try {
      const { piece: pieceData, notice: generationNotice, source } = await generatePieceWithSource(target, preview => {
        setPendingWords(prev => prev.map(p => (p.key === key ? { ...p, preview } : p)));
      });
      setNotice(generationNotice ? `${source === 'similar' ? '近い言葉のAI駒' : '簡易生成'}：${generationNotice}` : '');

      const newPiece: Piece = {
        ...pieceData,
        id: generateId(),
        owner: player,
        isKing: false,
        isPawn: false,
        originalPosition: null,
        coolDownTurnsRemaining: 0,
        isRevealed: pieceData.mechanics_type === 'STEALTH_TRAP' ? false : true,
        isPromoted: false,
      };

      setCreatedPieces(prev => [...prev, newPiece]);
    } catch (error) {
      if (error instanceof BlockedWordError) {
        setNotice(`「${target}」は使えない単語です。別の単語を入力してください。`);
      } else {
        console.error(error);
        alert(`「${target}」の生成に失敗しました。`);
      }
    } finally {
      setPendingWords(prev => prev.filter(p => p.key !== key));
    }
  };

  // 不適切な駒の報告。報告した駒はこの端末では二度と出さず、デッキからも外す
  const handleReport = async (index: number) => {
    const piece = createdPieces[index];
    if (!piece) return;
    if (!window.confirm(`「${piece.word}」の駒に不適切な内容（差別・性的・暴力的な表現など）がありますか？\n報告すると、この駒はデッキから外れます。`)) return;
    forgetCachedPiece(piece.word);
    setCreatedPieces(prev => prev.filter((_, i) => i !== index));
    try {
      await reportPiece(wordKey(normalizeFusionWord(piece.word)));
      setNotice(`「${piece.word}」を報告しました。ご協力ありがとうございます。複数の報告が集まった駒は自動で削除されます。`);
    } catch (err) {
      console.warn('[report] failed:', err);
      setNotice(`「${piece.word}」をデッキから外しました（報告の送信には失敗しました）。`);
    }
  };

  const handleDelete = (index: number) => {
    setCreatedPieces(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    if (createdPieces.length === maxPieces) {
      onPiecesReady(createdPieces);
    }
  };

  const [resettingCache, setResettingCache] = useState(false);

  const handleResetCache = async () => {
    if (!window.confirm('この端末に保存された駒データのキャッシュを消去しますか？（他のプレイヤーには影響しません）')) {
      return;
    }
    setResettingCache(true);
    try {
      const count = await clearAllCustomPieceCache();
      alert(`この端末のキャッシュから ${count} 件の駒データを消去しました。`);
    } catch (e) {
      console.error(e);
      alert('リセット処理中にエラーが発生しました。');
    } finally {
      setResettingCache(false);
    }
  };

  const remaining = maxPieces - createdPieces.length;
  const opponentStatus = onlineMode
    ? (onlineOpponentReady ? '準備できました' : '駒を作っています')
    : setupSubPhase === 'sente_create' ? '順番待ち' : '準備できました';

  return (
    <div style={{ width: '100%', boxSizing: 'border-box', maxWidth: '1000px', margin: '0 auto', padding: '16px', zIndex: 10, position: 'relative' }}>

      {/* 相手がいる対局だけ、相手の状況を1行で（CPU対戦では出さない） */}
      {(onlineMode || !vsAiMode) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '12px', fontSize: '13px' }}>
          <span style={{ fontWeight: 700 }}>{onlineMode ? 'オンライン対戦' : '1台で交代しながら対戦'}</span>
          <span style={{ color: 'var(--text-secondary)' }}>
            {rightLabel}：<strong style={{ color: opponentStatus === '準備できました' ? 'var(--color-matsuba)' : 'var(--color-gold)' }}>{opponentStatus}</strong>
          </span>
        </div>
      )}

      <div className="cyber-panel" style={{ padding: '20px', marginBottom: '20px', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '16px' }}>
        <h2 className="cyber-title" style={{ fontSize: '20px', marginBottom: '6px', color: 'var(--text-primary)', borderBottom: 'none' }}>
          {presetWords?.length ? '今日のお題の駒を作っています' : `好きな言葉で、駒を${maxPieces}枚作ろう`}
        </h2>
        {!onlineMode && !vsAiMode && (
          <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-shinku)', marginBottom: '6px' }}>いまは {leftLabel} の番です</p>
        )}
        <p style={{ color: 'var(--text-secondary)', marginBottom: '14px', fontSize: '13px' }}>
          言葉に合った動きと能力の駒を、AIが作ります。
        </p>

        {notice && (
          <div role="status" style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(212, 175, 55, 0.08)', border: '1px solid rgba(212, 175, 55, 0.3)', fontSize: '12px', color: 'var(--text-primary)' }}>
            {notice}
          </div>
        )}

        {presetWords?.length ? (
          <div style={{ marginBottom: '12px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.25)', fontSize: '13px', lineHeight: 1.7 }}>
            📅 {presetWords.join('・')}（全員同じ3枚。少ない手数で勝つほど上位）
          </div>
        ) : null}

        {!presetWords?.length && (!onlineMode || !onlineSelfReady) && slotsUsed < maxPieces && (
          <form onSubmit={handleGenerate} className="piece-creator-form" style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="例：忍者、満員電車、二度寝"
              aria-label="駒にする言葉"
              className="cyber-input"
              style={{ flex: 1 }}
              maxLength={24}
              required
            />
            <button
              type="submit"
              className="cyber-btn"
              disabled={!word.trim()}
              style={{ flexShrink: 0 }}
            >
              作る
            </button>
          </form>
        )}

        {loading && (
          <p role="status" style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0' }}>
            {pendingWords.map(p => `「${p.word}」`).join('')}を作っています…（初めての言葉は5〜15秒）
            {slotsUsed < maxPieces && ' 待っている間に次の言葉も入れられます'}
          </p>
        )}

        <p style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '6px' }}>
          入力した言葉はAI（Cloudflare Workers AI など）に送られ、できた駒はほかの人とも共有されます。個人情報や人を傷つける言葉は入れないでください。
        </p>
      </div>

      <h3 className="cyber-title" style={{ fontSize: '16px', marginBottom: '15px', color: 'var(--text-primary)', borderBottom: 'none' }}>
        作った駒（{createdPieces.length} / {maxPieces}）
      </h3>

      <div className="piece-creator-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '30px' }}>
        {createdPieces.map((piece, index) => {
          return (
            <div key={piece.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', width: '100%' }}>
              <button
                onClick={() => handleDelete(index)}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-shinku)',
                  cursor: 'pointer',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  zIndex: 10,
                }}
                title="削除"
              >
                ×
              </button>
              <PieceDetailCard piece={piece} />
              {onlineConfigured && (
                <button
                  type="button"
                  onClick={() => handleReport(index)}
                  style={{ position: 'absolute', bottom: '12px', left: '12px', zIndex: 10, padding: '4px 10px', borderRadius: '999px', border: '1px solid rgba(185, 28, 28, 0.3)', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700 }}
                >
                  ⚠ 不適切な内容を報告
                </button>
              )}
              {piece.abilities?.length || piece.trait || piece.move_extra ? <div style={{ margin: '8px 0 44px' }}><ProgramAbilityList piece={piece as Piece} /></div> : null}
              <button
                onClick={() => openXShare(`「${piece.word}」から能力駒《${piece.effect_name}》が生まれた！\n${piece.ability_genre || ''}`)}
                style={{
                  position: 'absolute',
                  bottom: '12px',
                  right: '12px',
                  background: '#111',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  padding: '4px 12px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
                title="この駒をXでシェア"
              >
                𝕏 シェア
              </button>
            </div>
          );
        })}

        {pendingWords.map(p => {
          // AIが書き終えた項目から順に見せる（名前 → 色 → 移動範囲 → 説明文。能力は完成後に表示）
          const preview = p.preview;
          const color = preview?.appearance?.color;
          const accent = preview?.appearance?.accent || 'var(--color-gold)';
          return (
            <div key={p.key} className="cyber-panel" style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', justifyContent: 'center', minHeight: 'min(340px, 30vh)', borderStyle: 'dashed', borderColor: accent, background: color ? `${color}33` : 'transparent', borderRadius: '16px', transition: 'background 0.4s ease, border-color 0.4s ease' }}>
              <p style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 'bold' }}>「{p.word}」</p>
              {preview?.deep_search_analysis && (
                <p style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--text-secondary)', maxWidth: '320px', textAlign: 'center' }}>
                  <span style={{ fontWeight: 700 }}>読み解き：</span>{preview.deep_search_analysis}
                </p>
              )}
              {preview?.effect_name && (
                <p style={{ fontSize: '20px', fontWeight: 900, letterSpacing: '0.1em', color: 'var(--text-primary)' }}>
                  {preview.appearance?.emblem && <span style={{ marginRight: '8px', color: accent }}>{preview.appearance.emblem}</span>}
                  《{preview.effect_name}》
                </p>
              )}
              {preview?.ability_genre && <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{preview.ability_genre}</p>}
              {preview?.range_geometry?.normal_grid && <MiniRange grid={preview.range_geometry.normal_grid} color={accent} />}
              {preview?.description && <p style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--text-primary)', maxWidth: '320px', textAlign: 'center' }}>{preview.description}</p>}
              <p style={{ color: 'var(--color-gold)', fontSize: '12px', fontFamily: 'var(--font-cyber)' }}>
                {preview?.wait_seconds
                  ? `混雑のため順番待ち中…（あと約${preview.wait_seconds}秒）`
                  : preview?.description ? '能力を組み立て中…' : preview?.effect_name ? '姿を描いています…' : preview?.deep_search_analysis ? '技を考えています…' : '言葉を読み解いています…'}
              </p>
            </div>
          );
        })}

        {Array.from({ length: Math.max(0, maxPieces - slotsUsed) }).map((_, i) => (
          <div key={i} className="cyber-panel" style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'min(340px, 18vh)', borderStyle: 'dashed', borderColor: 'var(--text-muted)', background: 'transparent', borderRadius: '16px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-cyber)' }}>
              {slotsUsed + i + 1}枚目
            </p>
          </div>
        ))}
      </div>

      {/* 次にすること（画面の下に固定。3枚そろうと押せる） */}
      <div style={{ position: 'sticky', bottom: 0, zIndex: 20, padding: '12px 0 16px', background: 'linear-gradient(to top, var(--color-washi) 70%, rgba(247, 245, 240, 0))', textAlign: 'center' }}>
        <p style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: remaining > 0 ? 'var(--color-shinku)' : 'var(--color-matsuba)' }}>
          {onlineMode && onlineSelfReady ? '相手の準備を待っています…（そろうと自動で始まります）' : remaining > 0 ? `あと${remaining}枚` : `${maxPieces}枚そろいました`}
        </p>
        <button
          className={`cyber-btn ${createdPieces.length !== maxPieces ? 'cyber-btn-disabled' : 'cyber-btn-purple'}`}
          onClick={handleSubmit}
          disabled={createdPieces.length !== maxPieces || (onlineMode && onlineSelfReady)}
          style={{ padding: '15px 48px', fontSize: '15px', width: '100%', maxWidth: '420px' }}
        >
          {onlineMode ? 'この3枚で準備完了' : !vsAiMode && setupSubPhase === 'sente_create' ? 'この3枚で決定（次の人へ）' : 'この3枚で対局する'}
        </button>
      </div>

      <p style={{ textAlign: 'center', marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
        駒の表示がおかしいとき：
        <button
          type="button"
          onClick={handleResetCache}
          disabled={resettingCache}
          style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', textDecoration: 'underline', cursor: resettingCache ? 'not-allowed' : 'pointer', fontSize: '11px' }}
        >
          {resettingCache ? '消去中…' : 'この端末に保存した駒を消す'}
        </button>
      </p>
    </div>
  );
};
