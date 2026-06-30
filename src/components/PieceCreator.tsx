import React, { useState } from 'react';
import { generatePieceFromWord } from '../aiGenerator';
import type { Piece, Player } from '../types';
import { generateId } from '../gameLogic';
import { PieceDetailCard } from './PieceDetailCard';

interface PieceCreatorProps {
  player: Player;
  onPiecesReady: (pieces: Piece[]) => void;
  geminiApiKey: string;
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
  geminiApiKey,
  vsAiMode,
  setupSubPhase,
  onlineMode = false,
  myRole = null,
  onlineOpponentReady = false,
  onlineSelfReady = false,
  playerNames,
}) => {
  const [word, setWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdPieces, setCreatedPieces] = useState<Piece[]>([]);
  const [scanStatus, setScanStatus] = useState('');

  const maxPieces = 3; 
  const leftRole = onlineMode ? (myRole || 'sente') : player;
  const rightRole = leftRole === 'sente' ? 'gote' : 'sente';

  const leftLabel = onlineMode
    ? `${leftRole === 'sente' ? '▲' : '▽'} ${playerNames[leftRole] || (leftRole === 'sente' ? 'プレイヤー1' : 'プレイヤー2')} (あなた)`
    : `${leftRole === 'sente' ? '▲' : '▽'} ${playerNames[leftRole] || 'プレイヤー1'}${vsAiMode ? '' : (leftRole === 'sente' ? ' (Player 1)' : ' (Player 2)')}`;

  const rightLabel = onlineMode
    ? `${rightRole === 'sente' ? '▲' : '▽'} ${playerNames[rightRole] || (rightRole === 'sente' ? 'プレイヤー1' : 'プレイヤー2')} (対戦相手)`
    : vsAiMode
      ? '人工知能 (Gemini AI)'
      : `${rightRole === 'sente' ? '▲' : '▽'} ${playerNames[rightRole] || 'プレイヤー2'}${rightRole === 'sente' ? ' (Player 1)' : ' (Player 2)'}`;

  const playerName = leftLabel;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || createdPieces.length >= maxPieces) return;

    setLoading(true);
    setScanStatus('深層概念マトリクス結合中...');
    
    const stages = [
      '主観的意図をマッピング中...',
      'ゲームマスター論理コード構築中...',
      '物理ルール干渉パラメータを算出中...',
      '概念空間へデプロイ中...'
    ];

    let stageIdx = 0;
    const statusInterval = setInterval(() => {
      setScanStatus(stages[stageIdx % stages.length]);
      stageIdx++;
    }, 255);

    try {
      const pieceData = await generatePieceFromWord(word.trim(), geminiApiKey);
      
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

      setCreatedPieces([...createdPieces, newPiece]);
      setWord('');
    } catch (error) {
      console.error(error);
      alert('概念コンパイルに失敗しました。');
    } finally {
      clearInterval(statusInterval);
      setLoading(false);
      setScanStatus('');
    }
  };

  const handleDelete = (index: number) => {
    const nextPieces = [...createdPieces];
    nextPieces.splice(index, 1);
    setCreatedPieces(nextPieces);
  };

  const handleSubmit = () => {
    if (createdPieces.length === maxPieces) {
      onPiecesReady(createdPieces);
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
          
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {onlineMode ? '※お互いのデバイスから同時に駒の作成が可能です' : !vsAiMode && '※1台のデバイスを交互に操作して対戦します'}
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
          戦場に召喚するオリジナルのカスタム駒を **{maxPieces}枚** 作成してください。単語の本質をハックし、ルールそのものを書き換える**【完全に新しい特殊能力】**をゼロから創造・ダイナミックコンパイルします。
        </p>

        {!geminiApiKey || geminiApiKey.trim() === '' ? (
          <div style={{
            background: 'rgba(212, 175, 55, 0.03)',
            border: '1px solid rgba(212, 175, 55, 0.15)',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '12px',
            color: 'var(--color-gold)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div>
              <strong>オフライン簡易生成モード動作中：</strong> Gemini API キーが設定されていません。
              簡易テンプレートが適用されます。
            </div>
          </div>
        ) : (
          <div style={{
            background: 'rgba(47, 82, 51, 0.03)',
            border: '1px solid rgba(47, 82, 51, 0.15)',
            borderRadius: '12px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '12px',
            color: 'var(--color-matsuba)',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}>
            <div>
              <strong>AI駆動生成モード有効：</strong> Gemini API を使用して、入力された単語の特徴を深く解釈したオリジナルの特殊能力をリアルタイムでゼロから創造します。
            </div>
          </div>
        )}

        {(!onlineMode || !onlineSelfReady) && createdPieces.length < maxPieces && (
          <form onSubmit={handleGenerate} className="piece-creator-form" style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="任意の単語（例：山、忍者、大砲、仏）"
              className="cyber-input"
              style={{ flex: 1 }}
              maxLength={20}
              disabled={loading}
              required
            />
            <button
              type="submit"
              className="cyber-btn"
              disabled={loading || !word.trim()}
              style={{ flexShrink: 0 }}
            >
              {loading ? 'コンパイル中...' : '概念をコンパイルする'}
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
                単語の本質を編纂し、独自の幾何学範囲を鋳造中…
              </p>
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
            </div>
          );
        })}

        {Array.from({ length: maxPieces - createdPieces.length }).map((_, i) => (
          <div key={i} className="cyber-panel" style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '340px', borderStyle: 'dashed', borderColor: 'var(--text-muted)', background: 'transparent', borderRadius: '16px' }}>
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
