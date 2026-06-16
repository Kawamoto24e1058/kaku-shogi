import React, { useEffect, useRef } from 'react';
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
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  turn,
  phase,
  customPiecesToPlace,
  winner,
  logs,
  selectedPiece,
  hoveredPiece,
  onResetGame,
  onPassTurn,
  vsAiMode,
  onToggleVsAi,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getLogColor = (type: string) => {
    switch (type) {
      case 'move': return 'var(--text-primary)';
      case 'action': return 'var(--neon-pink)';
      case 'capture': return 'var(--neon-yellow)';
      case 'ability': return 'var(--neon-green)';
      case 'system': return '#00f3ff';
      default: return 'var(--text-secondary)';
    }
  };

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
            ★ {winner === 'sente' ? '先手' : '後手'}の勝利！ ★
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
                {turn === 'sente' ? '先手 (Player 1)' : '後手 (Player 2 / AI)'}
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

      {/* Game Logs Panel */}
      <div className="cyber-panel" style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: '140px' }}>
        <h3 className="cyber-title" style={{ fontSize: '15px', marginBottom: '8px' }}>
          戦術記録ログ
        </h3>
        <div style={{
          flex: 1,
          background: 'rgba(5, 2, 18, 0.7)',
          borderRadius: '6px',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          padding: '8px',
          overflowY: 'auto',
          fontSize: '11px',
          fontFamily: 'monospace',
          display: 'flex',
          flexDirection: 'column',
          gap: '5px',
          maxHeight: '160px'
        }}>
          {logs.map((log) => (
            <div key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '3px' }}>
              <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>[{log.timestamp}]</span>
              <span style={{
                color: log.player === 'sente' ? 'var(--neon-cyan)' : 'var(--neon-purple)',
                fontWeight: 'bold',
                marginRight: '4px'
              }}>
                {log.player === 'sente' ? '先手' : '後手'}
              </span>
              <span style={{ color: getLogColor(log.type) }}>{log.message}</span>
            </div>
          ))}
          <div ref={logEndRef} />
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
