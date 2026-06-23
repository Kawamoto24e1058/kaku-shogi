import React from 'react';
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
  onToggleVsAi: () => void;
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
  onToggleVsAi,
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
  const triggerEvent = selectedPiece ? getPieceTrigger(selectedPiece) : 'ALWAYS';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
      
      {/* Turn Info & Phase Panel */}
      <div className={`cyber-panel ${turn === 'sente' ? 'cyan-glow' : 'purple-glow'}`} style={{ padding: '15px' }}>
        <h3 className="cyber-title" style={{ fontSize: '16px', marginBottom: '8px' }}>
          戦局ステータス (9x9)
        </h3>

        {winner ? (
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--neon-yellow)', textAlign: 'center', margin: '10px 0', fontFamily: 'var(--font-cyber)' }}>
            🏆 {winner === 'sente'
              ? (playerNames.sente || '先手')
              : (playerNames.gote || (vsAiMode ? 'AI' : '後手'))
            } の勝利！
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>フェーズ:</span>
              <span style={{ fontWeight: 'bold', color: 'var(--neon-yellow)' }}>
                {phase === 'placement' ? '初期配置フェーズ' : '対局中'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>現在の手番:</span>
              <span style={{
                fontSize: '15px',
                fontWeight: 'bold',
                color: turn === 'sente' ? 'var(--neon-cyan)' : 'var(--neon-purple)',
                textShadow: `0 0 5px ${turn === 'sente' ? 'rgba(0,243,255,0.4)' : 'rgba(189,0,255,0.4)'}`,
                fontFamily: 'var(--font-cyber)'
              }}>
                {turn === 'sente'
                  ? `▲ ${playerNames.sente || '先手'}`
                  : `▽ ${playerNames.gote || (vsAiMode ? 'AI' : '後手')}`
                }
              </span>
            </div>

            {phase === 'placement' && (
              <div style={{ padding: '8px', background: 'rgba(255,230,0,0.03)', border: '1px solid rgba(255,230,0,0.15)', borderRadius: '6px', fontSize: '11px' }}>
                <p style={{ fontWeight: 'bold', color: 'var(--neon-yellow)', marginBottom: '3px' }}>
                  配置ルール:
                </p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  手持ちのカスタム能力駒を、自陣の下3段（先手: 青枠）または上3段（後手: 紫枠）に配置してください。
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(hoveredPiece || selectedPiece) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h3 className="cyber-title" style={{ fontSize: '15px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {hoveredPiece ? (
                  <>
                    <span style={{ color: 'var(--neon-green)' }}>👁️</span>
                    <span>詳細プレビュー</span>
                  </>
                ) : (
                  <>
                    <span style={{ color: 'var(--neon-cyan)' }}>⚔️</span>
                    <span>選択駒の戦術能力</span>
                  </>
                )}
              </h3>
              
              <PieceDetailCard piece={hoveredPiece || selectedPiece || {}} />
              
              {/* Tactical Actions for Selected Piece */}
              {selectedPiece && (!hoveredPiece || hoveredPiece.id === selectedPiece.id) && (
                <div className="cyber-panel cyan-glow" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--neon-cyan)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '4px' }}>
                    戦術オプション
                  </div>
                  
                  {/* Debug/Info box */}
                  <div style={{
                    background: 'rgba(0,0,0,0.4)',
                    padding: '6px',
                    borderRadius: '4px',
                    border: '1.2px solid rgba(0, 243, 255, 0.2)',
                    fontFamily: 'monospace',
                    fontSize: '9px',
                    color: 'var(--neon-cyan)'
                  }}>
                    <div>状態: {selectedPiece.isPromoted ? '覚醒（成）' : '通常'}</div>
                    <div>属性: {selectedPiece.mechanics_type}</div>
                    <div>発動: "{triggerEvent === 'ON_MOVE' ? '移動完了時自動発動' : triggerEvent === 'TURN_START' ? 'ターン開始時自動発動' : triggerEvent === 'ON_TAKEN' ? '捕獲時発動（罠）' : triggerEvent === 'ON_APPROACH' ? '接近時発動（罠）' : '常時パッシブ'}"</div>
                    {selectedPiece.coolDownTurnsRemaining > 0 && (
                      <div style={{ color: 'var(--neon-pink)', fontWeight: 'bold' }}>充填完了まであと: {selectedPiece.coolDownTurnsRemaining} 手番</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="cyber-panel" style={{ padding: '15px', textAlign: 'center' }}>
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
          <div style={{ fontSize: '10px', color: 'var(--neon-purple)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
            ▽ {playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} 持ち駒
          </div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', minHeight: '34px', padding: '6px', background: 'rgba(189,0,255,0.02)', border: '1px solid rgba(189,0,255,0.1)', borderRadius: '4px' }}>
            {capturedPieces.gote.map((piece, idx) => {
              const isSel = selectedCapturedPiece?.piece.id === piece.id && selectedCapturedPiece?.index === idx;
              return (
                <div
                  key={piece.id}
                  onClick={() => onCapturedPieceClick(piece, idx, 'gote')}
                  onMouseEnter={() => onHoverPiece?.(piece)}
                  onMouseLeave={() => onHoverPiece?.(null)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: `1px solid ${isSel ? 'var(--neon-purple)' : 'rgba(189,0,255,0.25)'}`,
                    background: isSel ? 'rgba(189,0,255,0.2)' : 'rgba(189,0,255,0.05)',
                    cursor: turn === 'gote' && phase === 'playing' ? 'pointer' : 'default',
                    fontSize: '10px',
                    color: '#fff',
                    userSelect: 'none'
                  }}
                >
                  {piece.word}
                </div>
              );
            })}
            {capturedPieces.gote.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>なし</span>
            )}
          </div>
        </div>

        {/* Graveyard (墓場) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{
            fontSize: '10px',
            color: isResurrectActive ? 'var(--neon-cyan)' : '#888',
            fontFamily: 'var(--font-cyber)',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            animation: isResurrectActive ? 'pulseGlow 1.5s infinite alternate' : 'none'
          }}>
            🪦 墓場 (Graveyard) {isResurrectActive && <span style={{ color: 'var(--neon-yellow)' }}>[蘇生対象を選択]</span>}
          </div>
          <div style={{
            display: 'flex',
            gap: '5px',
            flexWrap: 'wrap',
            minHeight: '34px',
            padding: '6px',
            background: isResurrectActive ? 'rgba(0,243,255,0.05)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${isResurrectActive ? 'var(--neon-cyan)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '4px',
            transition: 'all 0.3s ease',
            boxShadow: isResurrectActive ? '0 0 10px rgba(0, 243, 255, 0.2)' : 'none'
          }}>
            {sharedPieces.map((piece, idx) => {
              const isSel = selectedSharedPiece?.piece.id === piece.id && selectedSharedPiece?.index === idx;
              return (
                <div
                  key={piece.id}
                  onClick={() => isResurrectActive && onSharedPieceClick(piece, idx)}
                  onMouseEnter={() => onHoverPiece?.(piece)}
                  onMouseLeave={() => onHoverPiece?.(null)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: `1px solid ${isSel ? 'var(--neon-cyan)' : (isResurrectActive ? 'rgba(0,243,255,0.3)' : 'rgba(255,255,255,0.15)')}`,
                    background: isSel ? 'rgba(0,243,255,0.2)' : (isResurrectActive ? 'rgba(0,243,255,0.05)' : 'rgba(255,255,255,0.03)'),
                    cursor: isResurrectActive ? 'pointer' : 'not-allowed',
                    opacity: isResurrectActive ? 1 : 0.6,
                    fontSize: '10px',
                    color: isResurrectActive ? '#fff' : '#aaa',
                    userSelect: 'none',
                    transition: 'all 0.2s ease',
                    boxShadow: isSel ? '0 0 8px rgba(0,243,255,0.5)' : 'none'
                  }}
                  title={`もとの所有者: ${piece.owner === 'sente' ? (playerNames.sente || 'プレイヤー1') : (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'))}`}
                >
                  {piece.word}
                </div>
              );
            })}
            {sharedPieces.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>空</span>
            )}
          </div>
        </div>

        {/* Sente Captured Hand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ fontSize: '10px', color: 'var(--neon-cyan)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
            ▲ {playerNames.sente || 'プレイヤー1'} 持ち駒
          </div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', minHeight: '34px', padding: '6px', background: 'rgba(0,243,255,0.02)', border: '1px solid rgba(0,243,255,0.1)', borderRadius: '4px' }}>
            {capturedPieces.sente.map((piece, idx) => {
              const isSel = selectedCapturedPiece?.piece.id === piece.id && selectedCapturedPiece?.index === idx;
              return (
                <div
                  key={piece.id}
                  onClick={() => onCapturedPieceClick(piece, idx, 'sente')}
                  onMouseEnter={() => onHoverPiece?.(piece)}
                  onMouseLeave={() => onHoverPiece?.(null)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: `1px solid ${isSel ? 'var(--neon-cyan)' : 'rgba(0,243,255,0.25)'}`,
                    background: isSel ? 'rgba(0,243,255,0.2)' : 'rgba(0,243,255,0.05)',
                    cursor: turn === 'sente' && phase === 'playing' ? 'pointer' : 'default',
                    fontSize: '10px',
                    color: '#fff',
                    userSelect: 'none'
                  }}
                >
                  {piece.word}
                </div>
              );
            })}
            {capturedPieces.sente.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>なし</span>
            )}
          </div>
        </div>
      </div>

      {/* Mode Settings Panel */}
      <div className="cyber-panel" style={{ padding: '10px 15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={vsAiMode}
              onChange={onToggleVsAi}
              style={{ cursor: 'pointer' }}
            />
            後手をAIに任せる (VS AI)
          </label>
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
