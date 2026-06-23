import React, { useState } from 'react';
import type { GameLog, Player, Piece, GamePhase } from '../types';
import { getPieceTrigger } from '../gameLogic';
import { PieceDetailCard } from './PieceDetailCard';

interface ControlPanelProps {
  turn: Player;
  phase: GamePhase;
  customPiecesToPlace: Piece[];
  winner: Player | null;
  logs: GameLog[];
  selectedPiece: Piece | null;
  hoveredPiece: Piece | null;
  onResetGame: () => void;
  onPassTurn: () => void;
  vsAiMode: boolean;
  playerNames: { sente: string; gote: string };

  // New props
  capturedPieces: { sente: Piece[]; gote: Piece[] };
  selectedCapturedPiece: { piece: Piece; index: number } | null;
  onCapturedPieceClick: (piece: Piece, index: number, owner: Player) => void;
  sharedPieces: Piece[];
  selectedSharedPiece: { piece: Piece; index: number } | null;
  onSharedPieceClick: (piece: Piece, index: number) => void;
  onHoverPiece?: (piece: Piece | null) => void;
  isResurrectActive?: boolean;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  turn,
  phase,
  customPiecesToPlace,
  winner,
  selectedPiece,
  hoveredPiece,
  onResetGame,
  onPassTurn,
  vsAiMode,
  playerNames,
  capturedPieces,
  selectedCapturedPiece,
  onCapturedPieceClick,
  sharedPieces,
  selectedSharedPiece,
  onSharedPieceClick,
  onHoverPiece,
  isResurrectActive,
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<string | null>(null);

  const renderCapturedPieceTile = (piece: Piece, idx: number, owner: Player, type: 'captured' | 'shared') => {
    const isCustom = !piece.isKing && !piece.isPawn && !piece.isHisha && !piece.isKaku;
    const isSel = type === 'captured' 
      ? (selectedCapturedPiece?.piece.id === piece.id && selectedCapturedPiece?.index === idx)
      : (selectedSharedPiece?.piece.id === piece.id && selectedSharedPiece?.index === idx);

    const isActive = type === 'captured'
      ? (turn === owner && phase === 'playing')
      : isResurrectActive;

    const hoverKey = `${type}-${owner}-${idx}`;
    const isHovered = hoveredIdx === hoverKey;

    if (!isCustom) {
      return (
        <div
          key={piece.id}
          onClick={() => {
            if (type === 'captured') {
              if (turn === owner && phase === 'playing') onCapturedPieceClick(piece, idx, owner);
            } else {
              if (isResurrectActive) onSharedPieceClick(piece, idx);
            }
          }}
          onMouseEnter={() => {
            onHoverPiece?.(piece);
            setHoveredIdx(hoverKey);
          }}
          onMouseLeave={() => {
            onHoverPiece?.(null);
            setHoveredIdx(null);
          }}
          style={{
            position: 'relative',
            width: '42px',
            height: '46px',
            clipPath: 'polygon(50% 0%, 100% 30%, 85% 100%, 15% 100%, 0% 30%)',
            background: isSel ? 'var(--color-gold)' : 'rgba(26, 26, 26, 0.15)',
            padding: '1px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isActive ? 'pointer' : 'default',
            opacity: isActive ? 1 : 0.6,
            transition: 'all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)',
            transform: isHovered ? 'scale(1.08) translateY(-2px)' : 'none',
            boxShadow: isHovered ? '0 8px 16px rgba(0, 0, 0, 0.4)' : 'none',
          }}
          title={type === 'shared' ? `もとの所有者: ${piece.owner === 'sente' ? (playerNames.sente || '先手') : (playerNames.gote || '後手')}` : undefined}
        >
          <div style={{
            width: '100%',
            height: '100%',
            clipPath: 'polygon(50% 0%, 100% 30%, 85% 100%, 15% 100%, 0% 30%)',
            background: 'var(--color-shiraki)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            padding: '2px',
            color: 'var(--color-kurogane)',
            fontWeight: 'bold',
            fontFamily: 'var(--font-ui)',
          }}>
            <div style={{ fontSize: '10px', marginTop: '6px' }}>
              {piece.word}
            </div>
          </div>
        </div>
      );
    } else {
      const getStampInfo = (genre: string) => {
        switch (genre) {
          case 'MOVEMENT_HACK':
            return { char: '武', color: 'var(--color-shinku)' };
          case 'STEALTH_TRAP':
            return { char: '隠', color: 'var(--color-kurogane)' };
          case 'RULE_BREAK':
            return { char: '律', color: 'var(--color-murasaki)' };
          case 'DYNAMICS_HACK':
            return { char: '破', color: 'var(--color-matsuba)' };
          default:
            return { char: '印', color: 'var(--color-gold)' };
        }
      };

      const stamp = getStampInfo(piece.mechanics_type);

      return (
        <div
          key={piece.id}
          onClick={() => {
            if (type === 'captured') {
              if (turn === owner && phase === 'playing') onCapturedPieceClick(piece, idx, owner);
            } else {
              if (isResurrectActive) onSharedPieceClick(piece, idx);
            }
          }}
          onMouseEnter={() => {
            onHoverPiece?.(piece);
            setHoveredIdx(hoverKey);
          }}
          onMouseLeave={() => {
            onHoverPiece?.(null);
            setHoveredIdx(null);
          }}
          style={{
            position: 'relative',
            width: '50px',
            height: '66px',
            background: 'var(--color-shiraki)',
            border: `1px solid ${isSel ? 'var(--color-gold)' : 'rgba(26, 26, 26, 0.15)'}`,
            borderRadius: '2px',
            boxShadow: isHovered 
              ? '0 10px 20px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255,255,255,0.6)' 
              : '0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255,255,255,0.5)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isActive ? 'pointer' : 'default',
            opacity: isActive ? 1 : 0.6,
            transition: 'all 0.25s cubic-bezier(0.25, 0.8, 0.25, 1)',
            transform: isHovered ? 'scale(1.08) translateY(-3px)' : 'none',
            userSelect: 'none',
            boxSizing: 'border-box',
            padding: '2px',
          }}
          title={type === 'shared' ? `もとの所有者: ${piece.owner === 'sente' ? (playerNames.sente || '先手') : (playerNames.gote || '後手')}` : undefined}
        >
          <div style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '12px',
            height: '12px',
            border: `1px solid ${stamp.color}`,
            borderRadius: '1px',
            color: stamp.color,
            fontSize: '8px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            fontFamily: 'var(--font-cyber)',
            background: 'rgba(255, 255, 255, 0.3)'
          }}>
            {stamp.char}
          </div>
          
          <div style={{
            fontSize: '11px',
            fontWeight: 'bold',
            color: 'var(--color-kurogane)',
            fontFamily: 'var(--font-ui)',
            textAlign: 'center',
            marginTop: '8px',
            lineHeight: 1.1
          }}>
            {piece.word}
          </div>
        </div>
      );
    }
  };

  const triggerEvent = selectedPiece ? getPieceTrigger(selectedPiece) : 'ALWAYS';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
      
      {/* Turn Info & Phase Panel */}
      <div className="cyber-panel" style={{ padding: '15px', borderColor: turn === 'sente' ? 'var(--color-shinku)' : 'var(--color-gold)' }}>
        <h3 className="cyber-title" style={{ fontSize: '16px', marginBottom: '8px' }}>
          戦局ステータス (9x9)
        </h3>

        {winner ? (
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--color-gold)', textAlign: 'center', margin: '10px 0', fontFamily: 'var(--font-cyber)' }}>
            🏆 {winner === 'sente'
              ? (playerNames.sente || '先手')
              : (playerNames.gote || (vsAiMode ? 'AI' : '後手'))
            } の勝利！
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>フェーズ:</span>
              <span style={{ fontWeight: 'bold', color: 'var(--color-gold)' }}>
                {phase === 'placement' ? '初期配置フェーズ' : '対局中'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>現在の手番:</span>
              <span style={{
                fontSize: '15px',
                fontWeight: 'bold',
                color: turn === 'sente' ? 'var(--color-shinku)' : 'var(--color-gold)',
                fontFamily: 'var(--font-cyber)'
              }}>
                {turn === 'sente'
                  ? `▲ ${playerNames.sente || '先手'}`
                  : `▽ ${playerNames.gote || (vsAiMode ? 'AI' : '後手')}`
                }
              </span>
            </div>

            {phase === 'placement' && (
              <div style={{ padding: '8px', background: 'rgba(212,175,55,0.03)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '2px', fontSize: '11px' }}>
                <p style={{ fontWeight: 'bold', color: 'var(--color-gold)', marginBottom: '3px' }}>
                  配置ルール:
                </p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  手持ちのカスタム能力駒を、自陣の下3段（先手）または上3段（後手）に配置してください。
                </p>
                <p style={{ color: 'var(--text-secondary)', marginTop: '3px' }}>
                  未配置の駒: <strong style={{ color: '#fff' }}>{customPiecesToPlace.length}枚</strong>
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dynamic Special Ability Panel */}
      {phase === 'playing' && !winner && (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          height: '360px', 
          minHeight: '360px', 
          maxHeight: '360px', 
          overflowY: 'auto',
          boxSizing: 'border-box',
          paddingRight: '4px'
        }}>
          {(hoveredPiece || selectedPiece) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h3 className="cyber-title" style={{ fontSize: '15px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {hoveredPiece ? (
                  <>
                    <span style={{ color: 'var(--color-matsuba)' }}>👁️</span>
                    <span>詳細プレビュー</span>
                  </>
                ) : (
                  <>
                    <span style={{ color: 'var(--color-gold)' }}>⚔️</span>
                    <span>選択駒の戦術能力</span>
                  </>
                )}
              </h3>
              
              <PieceDetailCard piece={hoveredPiece || selectedPiece || {}} />
              
              {/* Tactical Actions for Selected Piece */}
              {selectedPiece && (!hoveredPiece || hoveredPiece.id === selectedPiece.id) && (
                <div className="cyber-panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', borderColor: 'var(--color-gold)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--color-gold)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '4px' }}>
                    戦術オプション
                  </div>
                  
                  {/* Debug/Info box */}
                  <div style={{
                    background: 'rgba(0,0,0,0.4)',
                    padding: '6px',
                    borderRadius: '2px',
                    border: '1px solid var(--color-gold)',
                    fontFamily: 'monospace',
                    fontSize: '9px',
                    color: 'var(--color-gold)'
                  }}>
                    <div>状態: {selectedPiece.isPromoted ? '覚醒（成）' : '通常'}</div>
                    <div>属性: {selectedPiece.mechanics_type}</div>
                    <div>発動: "{triggerEvent === 'ON_MOVE' ? '移動完了時自動発動' : triggerEvent === 'TURN_START' ? 'ターン開始時自動発動' : triggerEvent === 'ON_TAKEN' ? '捕獲時発動（罠）' : triggerEvent === 'ON_APPROACH' ? '接近時発動（罠）' : '常時パッシブ'}"</div>
                    {selectedPiece.coolDownTurnsRemaining > 0 && (
                      <div style={{ color: 'var(--color-shinku)', fontWeight: 'bold' }}>充填完了まであと: {selectedPiece.coolDownTurnsRemaining} 手番</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="cyber-panel" style={{ padding: '15px', textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
                自陣の駒を選択するか、盤面の駒にマウスを重ねると、その言葉に秘められた特殊能力が表示されます。
              </p>
            </div>
          )}
        </div>
      )}

      {/* Captured Pieces & Shared Pool Panel */}
      <div className="cyber-panel" style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '180px' }}>
        <h3 className="cyber-title" style={{ fontSize: '15px', marginBottom: '4px' }}>
          獲得した持ち駒
        </h3>
        
        {/* Gote Captured Hand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ fontSize: '10px', color: 'var(--color-gold)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
            ▽ {playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} 持ち駒
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', minHeight: '34px', padding: '6px', background: 'rgba(212,175,55,0.02)', border: '1px solid rgba(212,175,55,0.1)', borderRadius: '2px' }}>
            {capturedPieces.gote.map((piece, idx) => renderCapturedPieceTile(piece, idx, 'gote', 'captured'))}
            {capturedPieces.gote.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>なし</span>
            )}
          </div>
        </div>

        {/* Graveyard (墓場) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{
            fontSize: '10px',
            color: isResurrectActive ? 'var(--color-gold)' : '#888',
            fontFamily: 'var(--font-cyber)',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            🪦 墓場 (Graveyard) {isResurrectActive && <span style={{ color: 'var(--color-shinku)' }}>[蘇生対象を選択]</span>}
          </div>
          <div style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            minHeight: '34px',
            padding: '6px',
            background: isResurrectActive ? 'rgba(212,175,55,0.05)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${isResurrectActive ? 'var(--color-gold)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: '2px',
            transition: 'all 0.3s ease'
          }}>
            {sharedPieces.map((piece, idx) => renderCapturedPieceTile(piece, idx, 'sente', 'shared'))}
            {sharedPieces.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>空</span>
            )}
          </div>
        </div>

        {/* Sente Captured Hand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ fontSize: '10px', color: 'var(--color-shinku)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
            ▲ {playerNames.sente || 'プレイヤー1'} 持ち駒
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', minHeight: '34px', padding: '6px', background: 'rgba(158,42,43,0.02)', border: '1px solid rgba(158,42,43,0.1)', borderRadius: '2px' }}>
            {capturedPieces.sente.map((piece, idx) => renderCapturedPieceTile(piece, idx, 'sente', 'captured'))}
            {capturedPieces.sente.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>なし</span>
            )}
          </div>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          className="cyber-btn cyber-btn-purple"
          style={{ flex: 1, padding: '10px', fontSize: '12px' }}
          onClick={onPassTurn}
          disabled={!!winner || phase === 'placement'}
        >
          手番パス
        </button>
        
        <button
          className="cyber-btn cyber-btn-danger"
          style={{ flex: 1, padding: '10px', fontSize: '12px' }}
          onClick={onResetGame}
        >
          リセット
        </button>
      </div>

    </div>
  );
};
