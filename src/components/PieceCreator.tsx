import React, { useEffect, useState } from 'react';
import { generatePieceWithSource, clearAllCustomPieceCache, warmUpGenerator, BlockedWordError } from '../aiGenerator';
import { openXShare } from '../share';
import type { Piece, Player } from '../types';
import { generateId } from '../gameLogic';
import { PieceDetailCard } from './PieceDetailCard';
import { ProgramAbilityList } from './ProgramAbilityList';

const SCAN_STAGES = [
  '深層概念マトリクス結合中...',
  '主観的意図をマッピング中...',
  'ゲームマスター論理コード構築中...',
  '物理ルール干渉パラメータを算出中...',
  '概念空間へデプロイ中...'
];

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
}) => {
  const [word, setWord] = useState('');
  // 生成中の単語。複数の単語を並行して生成できるようにし、3枚分の待ち時間を1枚分程度に短縮する
  const [pendingWords, setPendingWords] = useState<{ key: string; word: string }[]>([]);
  const loading = pendingWords.length > 0;
  const [createdPieces, setCreatedPieces] = useState<Piece[]>([]);
  const [stageIdx, setStageIdx] = useState(0);
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

  const playerName = leftLabel;

  const slotsUsed = createdPieces.length + pendingWords.length;

  useEffect(() => {
    warmUpGenerator();
  }, []);

  // 生成中の演出テキストを一定間隔で切り替える（setState はタイマー内でのみ行う）
  useEffect(() => {
    if (!loading) return;
    const statusInterval = setInterval(() => setStageIdx(i => i + 1), 900);
    return () => clearInterval(statusInterval);
  }, [loading]);
  const scanStatus = SCAN_STAGES[stageIdx % SCAN_STAGES.length];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = word.trim();
    if (!target || slotsUsed >= maxPieces) return;

    const key = generateId();
    setPendingWords(prev => [...prev, { key, word: target }]);
    setWord('');

    try {
      const { piece: pieceData, notice: generationNotice, source } = await generatePieceWithSource(target);
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

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '16px', zIndex: 10, position: 'relative' }}>
      
      {/* Matchmaking & Faction Readiness Dashboard */}
      <div 
        className="cyber-panel" 
        style={{ 
          padding: '24px', 
          marginBottom: '24px', 
          background: 'rgba(255, 255, 255, 0.75)',
          border: '1px solid rgba(139, 92, 26, 0.15)',
          borderRadius: '16px',
          fontFamily: 'var(--font-cyber)',
          boxShadow: '0 8px 24px rgba(139, 92, 26, 0.04)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', borderBottom: '1px solid rgba(139, 92, 26, 0.08)', paddingBottom: '12px', marginBottom: '12px' }}>
          <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            <span>対局接続方式:</span>
            <span style={{
              fontSize: '11px',
              color: 'var(--color-matsuba)',
              background: 'rgba(47, 82, 51, 0.05)',
              border: '0.5px solid var(--color-matsuba)',
              padding: '2px 10px',
              borderRadius: '9999px',
              fontWeight: 'bold'
            }}>
              {onlineMode ? '遠隔対局（オンライン複数デバイス接続）' : vsAiMode ? '一人対局（AI対局モード）' : '二人対局（対面パス＆プレイ接続）'}
            </span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={handleResetCache}
              disabled={resettingCache}
              style={{
                fontSize: '10.5px',
                fontWeight: 'bold',
                color: '#991b1b',
                background: '#fef2f2',
                border: '1px solid #fca5a5',
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: resettingCache ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
              title="この端末に保存された駒データのキャッシュを消去します"
            >
              {resettingCache ? '消去中...' : '端末キャッシュを消去'}
            </button>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {onlineMode ? '※お互いのデバイスから同時に駒の作成が可能です' : !vsAiMode && '※1台のデバイスを交互に操作して対戦します'}
            </div>
          </div>
        </div>

        <div className="piece-creator-status-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Left: Your Status */}
          <div style={{ background: 'rgba(139, 92, 26, 0.02)', padding: '12px 16px', borderRadius: '12px', borderLeft: `4px solid ${leftRole === 'sente' ? 'var(--color-shinku)' : 'var(--color-gold)'}` }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>あなたの構築ステータス</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{leftLabel}</span>
              <span style={{ color: (onlineMode ? onlineSelfReady : createdPieces.length === maxPieces) ? 'var(--color-matsuba)' : 'var(--color-gold)' }}>
                {(onlineMode ? onlineSelfReady : createdPieces.length === maxPieces) ? '準備完了' : `構築中 (${createdPieces.length}/${maxPieces})`}
              </span>
            </div>
          </div>

          {/* Right: Opponent Status */}
          <div style={{ background: 'rgba(139, 92, 26, 0.02)', padding: '12px 16px', borderRadius: '12px', borderLeft: `4px solid ${rightRole === 'sente' ? 'var(--color-shinku)' : 'var(--color-gold)'}` }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>対戦相手の準備状況</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{rightLabel}</span>
              <span style={{ 
                color: onlineMode ? (onlineOpponentReady ? 'var(--color-matsuba)' : 'var(--color-gold)') : (vsAiMode ? 'var(--color-gold)' : (setupSubPhase === 'sente_create' ? 'var(--color-gold)' : 'var(--color-matsuba)'))
              }}>
                {onlineMode 
                  ? (onlineOpponentReady ? '準備完了' : '未完了 (構築中)')
                  : vsAiMode 
                    ? 'AI自動待機' 
                    : setupSubPhase === 'sente_create' 
                      ? '未完了 (順番待ち)' 
                      : '準備完了'}
              </span>
            </div>
          </div>
        </div>

        {/* Informative message for player handoff */}
        {onlineMode ? (
          <div style={{ 
            marginTop: '16px', 
            fontSize: '11px', 
            color: onlineSelfReady ? 'var(--color-matsuba)' : 'var(--color-gold)',
            background: onlineSelfReady ? 'rgba(47, 82, 51, 0.03)' : 'rgba(212, 175, 55, 0.03)',
            border: `1px solid ${onlineSelfReady ? 'rgba(47, 82, 51, 0.15)' : 'rgba(212, 175, 55, 0.15)'}`,
            padding: '10px 14px',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>
              {onlineSelfReady 
                ? '対戦相手の構築完了を待っています。両者の準備が完了すると自動で対局へ進みます。' 
                : '3枚のカスタム駒を作成し、完了したら下のボタンをクリックして確定させてください。'}
            </span>
          </div>
        ) : !vsAiMode && (
          <div style={{ 
            marginTop: '16px', 
            fontSize: '11px', 
            color: 'var(--color-gold)',
            background: 'rgba(212, 175, 55, 0.02)',
            border: '1px solid rgba(212, 175, 55, 0.12)',
            padding: '10px 16px',
            borderRadius: '12px',
          }}>
            <div>
              {setupSubPhase === 'sente_create' 
                ? `${playerNames.sente || 'プレイヤー1'} が3枚のカスタム駒を作り終えると、${playerNames.gote || 'プレイヤー2'} の構築フェーズに切り替わります。` 
                : `${playerNames.sente || 'プレイヤー1'} は準備完了しています！ ${playerNames.gote || 'プレイヤー2'} は残り駒を構築して進んでください。`}
            </div>
          </div>
        )}
      </div>

      <div className="cyber-panel" style={{ padding: '30px', marginBottom: '30px', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '16px' }}>
        <h2 className="cyber-title" style={{ fontSize: '20px', marginBottom: '15px', color: 'var(--text-primary)', borderBottom: 'none' }}>
          {playerName} のカスタム能力駒生成
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '13px' }}>
          戦場に召喚するオリジナルのカスタム駒を <strong>{maxPieces}枚</strong> 作成してください。好きな単語から、AIが<strong>その言葉らしい特殊能力</strong>を持つ駒を作ります。
        </p>

        <div style={{
          background: notice ? 'rgba(212, 175, 55, 0.03)' : 'rgba(47, 82, 51, 0.03)',
          border: `1px solid ${notice ? 'rgba(212, 175, 55, 0.15)' : 'rgba(47, 82, 51, 0.15)'}`,
          borderRadius: '12px',
          padding: '12px 16px',
          marginBottom: '20px',
          fontSize: '12px',
          color: notice ? 'var(--color-gold)' : 'var(--color-matsuba)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}>
          {notice ? (
            <div>{notice}</div>
          ) : (
            <div>
              <strong>AI駆動生成モード：</strong> 入力された単語の特徴を生成AIが解釈し、オリジナルの特殊能力を生成します。
            </div>
          )}
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
            ※入力した単語は能力生成のため外部のAIサービス（Cloudflare Workers AI など）に送信され、生成結果は他のプレイヤーとも共有されます。個人情報や他人を傷つける言葉は入力しないでください。
          </div>
        </div>

        {(!onlineMode || !onlineSelfReady) && slotsUsed < maxPieces && (
          <form onSubmit={handleGenerate} className="piece-creator-form" style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="任意の単語（例：山、忍者、大砲、仏）"
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
              概念をコンパイルする
            </button>
          </form>
        )}

        {/* Dynamic Compile Status Card */}
        <div style={{
          width: '100%',
          border: '1px solid rgba(139, 92, 26, 0.15)',
          background: 'rgba(139, 92, 26, 0.01)',
          padding: '24px',
          borderRadius: '12px',
          textAlign: 'center',
          fontFamily: 'var(--font-cyber)',
          minHeight: '100px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          marginBottom: '20px'
        }}>
          {!loading && createdPieces.length === 0 ? (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              戦場に召喚するオリジナルのカスタム駒の「概念」を入力してください。
            </p>
          ) : loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <p style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--color-gold)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Dynamic Runtime Compile...
              </p>
              <p style={{ fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '0.15em' }}>
                {pendingWords.map(p => `「${p.word}」`).join('')} の本質を編纂中…
              </p>
              {slotsUsed < maxPieces && (
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>待っている間に次の単語も入力できます</p>
              )}
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                ({scanStatus})
              </p>
              <div style={{ width: '256px', height: '1px', background: 'rgba(139, 92, 26, 0.1)', overflow: 'hidden', position: 'relative', marginTop: '4px' }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  background: 'var(--color-gold)',
                  width: '33.3%',
                  animation: 'shogi-loading 1.5s infinite ease-in-out'
                }}></div>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--color-gold)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Dynamic Runtime Compile...
              </p>
              <p style={{ fontSize: '14px', color: 'var(--text-primary)', fontWeight: 'bold', letterSpacing: '0.15em' }}>
                ダイナミック・コンパイル完了！ ({createdPieces.length} / {maxPieces})
              </p>
            </div>
          )}
        </div>
      </div>

      <h3 className="cyber-title" style={{ fontSize: '16px', marginBottom: '15px', color: 'var(--text-primary)', borderBottom: 'none' }}>
        構築されたデッキ ({createdPieces.length} / {maxPieces})
      </h3>

      <div className="piece-creator-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '30px' }}>
        {createdPieces.map((piece, index) => {
          return (
            <div key={piece.id} style={{ position: 'relative', display: 'flex', width: '100%' }}>
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
              {piece.abilities?.length ? <div style={{ marginBottom: '40px' }}><ProgramAbilityList piece={piece as Piece} /></div> : null}
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

        {pendingWords.map(p => (
          <div key={p.key} className="cyber-panel" style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', justifyContent: 'center', minHeight: 'min(340px, 30vh)', borderStyle: 'dashed', borderColor: 'var(--color-gold)', background: 'transparent', borderRadius: '16px' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 'bold' }}>「{p.word}」</p>
            <p style={{ color: 'var(--color-gold)', fontSize: '12px', fontFamily: 'var(--font-cyber)' }}>生成中…</p>
          </div>
        ))}

        {Array.from({ length: Math.max(0, maxPieces - slotsUsed) }).map((_, i) => (
          <div key={i} className="cyber-panel" style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 'min(340px, 18vh)', borderStyle: 'dashed', borderColor: 'var(--text-muted)', background: 'transparent', borderRadius: '16px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-cyber)' }}>
              空きスロット
            </p>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          className={`cyber-btn ${createdPieces.length !== maxPieces ? 'cyber-btn-disabled' : 'cyber-btn-purple'}`}
          onClick={handleSubmit}
          disabled={createdPieces.length !== maxPieces || (onlineMode && onlineSelfReady)}
          style={{ padding: '15px 48px', fontSize: '15px' }}
        >
          {onlineMode && onlineSelfReady ? '対戦相手の構築を待っています…' : 'この本質で盤面へ'}
        </button>
      </div>
    </div>
  );
};
