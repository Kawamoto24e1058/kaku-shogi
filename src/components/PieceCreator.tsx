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
}) => {
  const [word, setWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [createdPieces, setCreatedPieces] = useState<Piece[]>([]);
  const [scanStatus, setScanStatus] = useState('');

  const maxPieces = 3; // 3 custom pieces for a standard 9x9 match
  const playerName = onlineMode 
    ? (myRole === 'sente' ? '▲ 先手 (あなた)' : '▽ 後手 (あなた)')
    : (player === 'sente' ? '先手 (Player 1)' : '後手 (Player 2 / AI)');

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
    }, 250);

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
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '16px' }}>
      {/* Matchmaking & Faction Readiness Dashboard */}
      <div 
        className="cyber-panel" 
        style={{ 
          padding: '20px', 
          marginBottom: '20px', 
          background: 'rgba(18, 14, 10, 0.95)',
          border: '1px solid rgba(219, 188, 98, 0.35)',
          borderRadius: '4px',
          fontFamily: 'var(--font-cyber)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', borderBottom: '1px solid rgba(219, 188, 98, 0.15)', paddingBottom: '12px', marginBottom: '12px' }}>
          <div style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--shogi-wood)' }}>⚔️</span>
            <span>対局接続方式:</span>
            <span style={{
              fontSize: '11px',
              color: 'var(--neon-green)',
              background: 'rgba(124, 168, 86, 0.1)',
              border: '0.5px solid var(--neon-green)',
              padding: '2px 8px',
              borderRadius: '2px',
              fontWeight: 'bold'
            }}>
              {onlineMode ? 'ONLINE: オンライン複数デバイス接続中' : vsAiMode ? 'SINGLE: AI対局モード' : 'LOCAL 2P: 対面パス＆プレイ接続完了'}
            </span>
          </div>
          
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {onlineMode ? '※お互いのデバイスから同時に駒の作成が可能です' : !vsAiMode && '※1台 of デバイスを交互に操作して対戦します'}
          </div>
        </div>

        <div className="piece-creator-status-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Left: Your Status */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 15px', borderRadius: '3px', borderLeft: `3px solid ${player === 'sente' ? 'var(--shogi-sente)' : 'var(--shogi-gote)'}` }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>あなたの構築ステータス</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{onlineMode ? (myRole === 'sente' ? '▲ 先手 (あなた)' : '▽ 後手 (あなた)') : (player === 'sente' ? '▲ 先手 (Player 1)' : '▽ 後手 (Player 2)')}</span>
              <span style={{ color: (onlineMode ? onlineSelfReady : createdPieces.length === maxPieces) ? 'var(--neon-green)' : 'var(--neon-yellow)' }}>
                {(onlineMode ? onlineSelfReady : createdPieces.length === maxPieces) ? '🟢 準備完了' : `構築中 (${createdPieces.length}/${maxPieces})`}
              </span>
            </div>
          </div>

          {/* Right: Opponent Status */}
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 15px', borderRadius: '3px', borderLeft: `3px solid ${player === 'sente' ? 'var(--shogi-gote)' : 'var(--shogi-sente)'}` }}>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>対戦相手の準備状況</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{onlineMode ? (myRole === 'sente' ? '▽ 後手 (対戦相手)' : '▲ 先手 (対戦相手)') : (player === 'sente' ? (vsAiMode ? '🤖 後手 (AI)' : '▽ 後手 (Player 2)') : '▲ 先手 (Player 1)')}</span>
              <span style={{ 
                color: onlineMode ? (onlineOpponentReady ? 'var(--neon-green)' : 'var(--neon-yellow)') : (vsAiMode ? 'var(--neon-cyan)' : (setupSubPhase === 'sente_create' ? 'var(--neon-yellow)' : 'var(--neon-green)'))
              }}>
                {onlineMode 
                  ? (onlineOpponentReady ? '🟢 準備完了 (3/3)' : '⏳ 未完了 (構築中)')
                  : vsAiMode 
                    ? '🤖 AI自動待機' 
                    : setupSubPhase === 'sente_create' 
                      ? '⏳ 未完了 (順番待ち)' 
                      : '🟢 準備完了 (3/3)'}
              </span>
            </div>
          </div>
        </div>

        {/* Informative message for player handoff */}
        {onlineMode ? (
          <div style={{ 
            marginTop: '12px', 
            fontSize: '11px', 
            color: onlineSelfReady ? 'var(--neon-green)' : 'var(--neon-yellow)',
            background: onlineSelfReady ? 'rgba(124, 168, 86, 0.05)' : 'rgba(219, 188, 98, 0.05)',
            border: `1px solid ${onlineSelfReady ? 'rgba(124, 168, 86, 0.2)' : 'rgba(219, 188, 98, 0.2)'}`,
            padding: '8px 12px',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>💡</span>
            <span>
              {onlineSelfReady 
                ? '対戦相手の構築完了を待っています。両者の準備が完了すると自動で対局へ進みます。' 
                : '3枚のカスタム駒を作成し、完了したら下のボタンをクリックして確定させてください。'}
            </span>
          </div>
        ) : !vsAiMode && (
          <div style={{ 
            marginTop: '12px', 
            fontSize: '11px', 
            color: setupSubPhase === 'sente_create' ? 'var(--neon-yellow)' : 'var(--neon-green)',
            background: setupSubPhase === 'sente_create' ? 'rgba(219, 188, 98, 0.05)' : 'rgba(124, 168, 86, 0.05)',
            border: `1px solid ${setupSubPhase === 'sente_create' ? 'rgba(219, 188, 98, 0.2)' : 'rgba(124, 168, 86, 0.2)'}`,
            padding: '8px 12px',
            borderRadius: '2px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>💡</span>
            <span>
              {setupSubPhase === 'sente_create' 
                ? '先手(Player 1)が3枚のカスタム駒を作り終えると、後手(Player 2)の構築フェーズに切り替わります。' 
                : '先手(Player 1)は準備完了しています！ 後手(Player 2)は残り駒を構築して「盤面へ」進んでください。'}
            </span>
          </div>
        )}
      </div>

      <div className="cyber-panel cyan-glow" style={{ padding: '30px', marginBottom: '30px' }}>
        <h2 className="cyber-title" style={{ fontSize: '24px', marginBottom: '15px' }}>
          {playerName} のカスタム能力駒生成
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
          戦場に召喚するオリジナルのカスタム駒を **{maxPieces}枚** 作成してください。単語の本質をハックし、ルールそのものを書き換える**【完全に新しい特殊能力】**をゼロから創造・ダイナミックコンパイルします。
        </p>

        {!geminiApiKey || geminiApiKey.trim() === '' ? (
          <div style={{
            background: 'rgba(219, 188, 98, 0.08)',
            border: '1px solid rgba(219, 188, 98, 0.3)',
            borderRadius: '4px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '13px',
            color: 'var(--neon-yellow)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <span style={{ fontSize: '18px' }}>⚠️</span>
            <div>
              <strong>オフライン簡易生成モード動作中：</strong> Gemini API キーが設定されていません。
              この状態では単語本来の意味や特徴を解釈した能力生成は行われず、簡易テンプレートが適用されます。
            </div>
          </div>
        ) : (
          <div style={{
            background: 'rgba(86, 166, 191, 0.08)',
            border: '1px solid rgba(86, 166, 191, 0.3)',
            borderRadius: '4px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '13px',
            color: 'var(--neon-cyan)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <span style={{ fontSize: '18px' }}>✨</span>
            <div>
              <strong>AI駆動生成モード有効：</strong> Gemini API を使用して、入力された単語の特徴を深く解釈したオリジナルの特殊能力をリアルタイムでゼロから創造します。
            </div>
          </div>
        )}

        {(!onlineMode || !onlineSelfReady) && createdPieces.length < maxPieces && (
          <form onSubmit={handleGenerate} className="piece-creator-form" style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <input
              type="text"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="任意の単語（例：人間、猟犬、ウイルス）"
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
            >
              {loading ? 'コンパイル中...' : '概念をコンパイルする'}
            </button>
          </form>
        )}

        {/* Dynamic Compile Status Card */}
        <div style={{
          width: '100%',
          border: '1px solid rgba(219, 188, 98, 0.25)',
          background: 'rgba(26, 25, 23, 0.55)',
          padding: '24px',
          borderRadius: '4px',
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
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              戦場に召喚するオリジナルのカスタム駒の「概念」を入力してください。
            </p>
          ) : loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <p style={{ fontSize: '11px', fontFamily: 'monospace', color: 'rgba(219, 188, 98, 0.6)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Dynamic Runtime Compile...
              </p>
              <p style={{ fontSize: '14px', color: 'var(--neon-yellow)', letterSpacing: '0.15em', animation: 'pulse 2s infinite' }}>
                単語の本質を編纂し、独自の幾何学範囲を鋳造中…
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                ({scanStatus})
              </p>
              <div style={{ width: '256px', height: '1px', background: 'rgba(219, 188, 98, 0.2)', overflow: 'hidden', position: 'relative', marginTop: '4px' }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  background: 'var(--neon-yellow)',
                  width: '33.3%',
                  animation: 'shogi-loading 1.5s infinite ease-in-out'
                }}></div>
              </div>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--neon-cyan)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Dynamic Runtime Compile...
              </p>
              <p style={{ fontSize: '14px', color: 'var(--neon-cyan)', fontWeight: 'bold', letterSpacing: '0.15em' }}>
                ダイナミック・コンパイル完了！ ({createdPieces.length} / {maxPieces})
              </p>
            </div>
          )}
        </div>
      </div>

      <h3 className="cyber-title" style={{ fontSize: '18px', marginBottom: '15px', color: 'var(--neon-purple)' }}>
        構築されたデッキ ({createdPieces.length} / {maxPieces})
      </h3>

      <div className="piece-creator-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px', marginBottom: '30px' }}>
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
                  color: 'var(--neon-pink)',
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
          <div key={i} className="cyber-panel" style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '340px', borderStyle: 'dashed', borderColor: 'var(--text-muted)', background: 'transparent' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontFamily: 'var(--font-cyber)' }}>
              EMPTY SLOT
            </p>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          className={`cyber-btn ${createdPieces.length !== maxPieces ? 'cyber-btn-disabled' : 'cyber-btn-purple'}`}
          onClick={handleSubmit}
          disabled={createdPieces.length !== maxPieces || (onlineMode && onlineSelfReady)}
          style={{ padding: '15px 40px', fontSize: '16px' }}
        >
          {onlineMode && onlineSelfReady ? '対戦相手の構築を待っています…' : 'この本質で盤面へ'}
        </button>
      </div>
    </div>
  );
};
