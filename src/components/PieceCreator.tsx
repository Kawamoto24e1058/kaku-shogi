import React, { useEffect, useState } from 'react';
import { generatePieceWithSource, clearAllCustomPieceCache, warmUpGenerator, BlockedWordError, forgetCachedPiece } from '../aiGenerator';
import { onlineConfigured, reportPiece } from '../onlineStore';
import { wordKey } from '../../shared/wordKey';
import { openXShare } from '../share';
import type { Piece, Player } from '../types';
import { generateId } from '../gameLogic';
import { KomaForge3D, FORGE_STEPS } from './KomaForge3D';
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
  // 1枚ずつ順番に作る。いま工房で作っている駒（AI の途中経過 preview → 完成した piece）
  const [forging, setForging] = useState<{ key: string; word: string; preview?: PartialPiece; piece?: Piece } | null>(null);
  const [createdPieces, setCreatedPieces] = useState<Piece[]>([]);
  const [notice, setNotice] = useState('');
  // 画面に見せている工程。AI の進み具合（actualStage）に、1工程ずつ追いつく。
  // キャッシュ済みの言葉はすぐ完成するが、加工の流れは見せる（約4秒。スキップできる）
  const [shownStage, setShownStage] = useState(0);

  const maxPieces = 3;
  // 作り直せる回数（「別の言葉にする」と、できた駒を×で外すのを合わせて）。
  // 作り直すたびに新しい言葉で AI を呼び、1日の利用枠をすぐ使い切ってしまうため
  const MAX_REDOS = 2;
  const [redosLeft, setRedosLeft] = useState(MAX_REDOS);
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

  useEffect(() => {
    warmUpGenerator();
  }, []);

  const preview = forging?.preview;
  const done = forging?.piece;
  const actualStage = done ? 5
    : preview?.description ? 4
    : preview?.range_geometry?.normal_grid ? 3
    : preview?.appearance?.color ? 2
    : preview?.deep_search_analysis || preview?.effect_name ? 1
    : 0;
  useEffect(() => {
    if (!forging || shownStage >= actualStage) return;
    const t = setTimeout(() => setShownStage(st => Math.min(actualStage, st + 1)), 750);
    return () => clearTimeout(t);
  }, [forging, shownStage, actualStage]);
  const reviewing = !!done && shownStage >= 5;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = word.trim();
    if (!target || forging || createdPieces.length >= maxPieces) return;
    setWord('');
    await generateWord(target);
  };

  // 決まった単語（今日のお題）は、1枚できるごとに次の単語を自動で作る
  useEffect(() => {
    if (!presetWords?.length || forging || createdPieces.length >= Math.min(maxPieces, presetWords.length)) return;
    void generateWord(presetWords[createdPieces.length]);
    // generateWord は毎回作り直される関数だが、作る単語は createdPieces の数で決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetWords, forging, createdPieces.length]);

  const generateWord = async (target: string) => {
    const key = generateId();
    setShownStage(0);
    setForging({ key, word: target });
    try {
      const { piece: pieceData, notice: generationNotice, source } = await generatePieceWithSource(target, p => {
        setForging(prev => (prev?.key === key ? { ...prev, preview: p } : prev));
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
      setForging(prev => (prev?.key === key ? { ...prev, piece: newPiece } : prev));
    } catch (error) {
      setForging(null);
      if (error instanceof BlockedWordError) {
        setNotice(`「${target}」は使えない単語です。別の単語を入力してください。`);
      } else {
        console.error(error);
        setNotice(`「${target}」の生成に失敗しました。もう一度試すか、別の言葉にしてください。`);
      }
    }
  };

  // 完成した駒をデッキに入れて、次の1枚へ
  const acceptForged = () => {
    if (!forging?.piece) return;
    const piece = forging.piece;
    setCreatedPieces(prev => [...prev, piece].slice(0, maxPieces));
    setForging(null);
  };
  // 別の言葉で作り直す（今日のお題は単語が決まっているので出さない）
  const discardForged = () => {
    if (redosLeft <= 0) return;
    setRedosLeft(n => n - 1);
    setForging(null);
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
    if (redosLeft <= 0) return;
    if (!window.confirm(`「${createdPieces[index]?.word}」を外して作り直しますか？（作り直しはあと${redosLeft}回）`)) return;
    setRedosLeft(n => n - 1);
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

      <div className="cyber-panel" style={{ padding: '16px', marginBottom: '16px', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '16px' }}>
        {/* 何枚目を作っているか（3つの丸） */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
          <h2 className="cyber-title" style={{ fontSize: '18px', margin: 0, color: 'var(--text-primary)', borderBottom: 'none' }}>
            {createdPieces.length >= maxPieces ? '3枚そろいました' : `${createdPieces.length + 1}枚目の駒を作る`}
          </h2>
          <div style={{ display: 'flex', gap: '6px' }} aria-label={`${createdPieces.length} / ${maxPieces} 枚`}>
            {Array.from({ length: maxPieces }).map((_, i) => (
              <span key={i} style={{ width: '12px', height: '12px', borderRadius: '50%', background: i < createdPieces.length ? 'var(--color-shinku)' : i === createdPieces.length && forging ? 'var(--color-gold)' : 'rgba(0,0,0,0.12)' }} />
            ))}
          </div>
        </div>
        {!onlineMode && !vsAiMode && (
          <p style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-shinku)', marginBottom: '6px' }}>いまは {leftLabel} の番です</p>
        )}
        {presetWords?.length ? (
          <div style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: '10px', background: 'rgba(217, 119, 6, 0.08)', border: '1px solid rgba(217, 119, 6, 0.25)', fontSize: '13px' }}>
            📅 今日のお題：{presetWords.join('・')}（全員同じ3枚）
          </div>
        ) : null}
        {notice && (
          <div role="status" style={{ marginBottom: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(212, 175, 55, 0.08)', border: '1px solid rgba(212, 175, 55, 0.3)', fontSize: '12px', color: 'var(--text-primary)' }}>
            {notice}
          </div>
        )}

        {/* 1. 言葉を入れる */}
        {!forging && !presetWords?.length && createdPieces.length < maxPieces && (!onlineMode || !onlineSelfReady) && (
          <>
            <form onSubmit={handleGenerate} className="piece-creator-form" style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
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
              <button type="submit" className="cyber-btn" disabled={!word.trim()} style={{ flexShrink: 0 }}>
                作る
              </button>
            </form>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {redosLeft > 0 ? `作り直しは${MAX_REDOS}回まで（あと${redosLeft}回）。` : '作り直しは使い切りました。この言葉で決まります。'}
            </p>
            <p style={{ fontSize: '10.5px', color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '6px' }}>
              入力した言葉はAI（Cloudflare Workers AI など）に送られ、できた駒はほかの人とも共有されます。個人情報や人を傷つける言葉は入れないでください。
            </p>
          </>
        )}

        {/* 2. 工房: 立体の駒が加工されていく */}
        {forging && (
          <div className="forge">
            <KomaForge3D
              stage={shownStage}
              text={(done?.word || forging.word).slice(0, 6)}
              color={(done?.appearance?.color as string | undefined) || preview?.appearance?.color}
              accent={(done?.appearance?.accent as string | undefined) || preview?.appearance?.accent}
              size={220}
            />
            {/* 工程の並び（今の工程が光る） */}
            <ol className="forge-steps" aria-label="駒づくりの工程">
              {FORGE_STEPS.map((label, i) => (
                <li key={label} className={i < shownStage ? 'is-done' : i === shownStage ? 'is-now' : ''}>
                  <span aria-hidden="true">{i < shownStage ? '✓' : i + 1}</span>{label}
                </li>
              ))}
            </ol>
            {/* 工程ごとに、AI が書いた中身を見せる */}
            <div className="forge-log" role="status" aria-live="polite">
              {preview?.wait_seconds && !done ? <p>混雑のため順番待ち中…（あと約{preview.wait_seconds}秒）</p> : null}
              {shownStage === 0 && <p>「{forging.word}」を読み解いています…</p>}
              {shownStage >= 1 && (preview?.deep_search_analysis || done?.deep_search_analysis) && (
                <p className="forge-analysis">{String(preview?.deep_search_analysis || done?.deep_search_analysis)}</p>
              )}
              {shownStage >= 1 && (preview?.effect_name || done?.effect_name) && (
                <p className="forge-name">《{preview?.effect_name || done?.effect_name}》</p>
              )}
              {shownStage >= 3 && (done?.range_geometry?.normal_grid || preview?.range_geometry?.normal_grid) && (
                <MiniRange grid={(done?.range_geometry?.normal_grid || preview?.range_geometry?.normal_grid)!} color={(done?.appearance?.accent as string | undefined) || preview?.appearance?.accent || 'var(--color-gold)'} />
              )}
              {shownStage >= 4 && !reviewing && (preview?.description || done?.description) && <p>{preview?.description || done?.description}</p>}
            </div>
            {done && !reviewing && (
              <button type="button" onClick={() => setShownStage(5)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', fontSize: '12px', cursor: 'pointer' }}>
                スキップ
              </button>
            )}

            {/* 3. 完成: 中身を見て、この駒にするか決める */}
            {reviewing && done && (
              <div style={{ width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {done.abilities?.length || done.trait || done.move_extra
                  ? <ProgramAbilityList piece={done} />
                  : <p style={{ fontSize: '13px', lineHeight: 1.6 }}>{done.description}</p>}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }}>
                  <button type="button" className="cyber-btn cyber-btn-purple" onClick={acceptForged} style={{ flex: '1 1 200px', padding: '12px' }}>
                    {createdPieces.length + 1 >= maxPieces ? 'この駒にする（そろった！）' : 'この駒にする → 次の駒へ'}
                  </button>
                  {!presetWords?.length && redosLeft > 0 && (
                    <button type="button" className="cyber-btn" onClick={discardForged} style={{ flex: '0 1 auto', padding: '12px', background: '#fff', color: 'var(--text-primary)' }}>
                      別の言葉にする（あと{redosLeft}回）
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => openXShare(`「${done.word}」から能力駒《${done.effect_name}》が生まれた！\n${done.ability_genre || ''}`)}
                    style={{ background: '#111', color: '#fff', border: 'none', borderRadius: '9999px', padding: '4px 12px', fontSize: '11px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    𝕏 シェア
                  </button>
                  {onlineConfigured && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(`「${done.word}」の駒に不適切な内容（差別・性的・暴力的な表現など）がありますか？`)) return;
                        forgetCachedPiece(done.word);
                        setForging(null);
                        void reportPiece(wordKey(normalizeFusionWord(done.word))).catch(() => {});
                        setNotice(`「${done.word}」を報告しました。ご協力ありがとうございます。`);
                      }}
                      style={{ padding: '4px 10px', borderRadius: '999px', border: '1px solid rgba(185, 28, 28, 0.3)', background: '#fff', color: '#b91c1c', fontSize: '11px', fontWeight: 700 }}
                    >
                      ⚠ 不適切な内容を報告
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* できた駒（小さく並べる。×で外して作り直せる） */}
      {createdPieces.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {createdPieces.map((piece, index) => (
            <div key={piece.id} className="forged-chip" style={{ borderColor: (piece.appearance?.accent as string | undefined) || 'rgba(139, 92, 26, 0.3)' }}>
              <span className="forged-chip-word">{piece.word}</span>
              <span className="forged-chip-name">《{piece.effect_name}》</span>
              {!presetWords?.length && !forging && redosLeft > 0 && (!onlineMode || !onlineSelfReady) && (
                <button type="button" onClick={() => handleDelete(index)} aria-label={`${piece.word} を外す`} title="外して作り直す">×</button>
              )}
              {onlineConfigured && !forging && (
                <button type="button" onClick={() => handleReport(index)} aria-label={`${piece.word} を報告`} title="不適切な内容を報告">⚠</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 次にすること（画面の下に固定。3枚そろうと押せる。工房で作っている間は出さない） */}
      {!forging && <div style={{ position: 'sticky', bottom: 0, zIndex: 20, padding: '12px 0 16px', background: 'linear-gradient(to top, var(--color-washi) 70%, rgba(247, 245, 240, 0))', textAlign: 'center' }}>
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
      </div>}

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
