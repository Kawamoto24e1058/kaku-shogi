import React, { useState } from 'react';
import type { GameLog, Player, Piece, GamePhase } from '../types';
import { PieceDetailCard } from './PieceDetailCard';
import { AbilityTooltip } from './AbilityTooltip';

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

  // Hand Decks & Captured pieces
  capturedPieces: { sente: Piece[]; gote: Piece[] };
  selectedCapturedPiece: { piece: Piece; index: number } | null;
  onCapturedPieceClick: (piece: Piece, index: number, owner: Player) => void;
  customDecks: { sente: Piece[]; gote: Piece[] };
  selectedCustomDeckPiece: { piece: Piece; index: number } | null;
  onCustomDeckPieceClick: (piece: Piece, index: number, owner: Player) => void;

  sharedPieces: Piece[];
  selectedSharedPiece: { piece: Piece; index: number } | null;
  onSharedPieceClick: (piece: Piece, index: number) => void;
  onHoverPiece?: (piece: Piece | null) => void;
  isResurrectActive?: boolean;
  isViewerOpponent?: boolean;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  turn,
  phase,
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
  customDecks,
  selectedCustomDeckPiece,
  onCustomDeckPieceClick,
  sharedPieces,
  selectedSharedPiece,
  onSharedPieceClick,
  onHoverPiece,
  isResurrectActive,
  isViewerOpponent = false,
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
            borderTopLeftRadius: '30% 50%',
            borderTopRightRadius: '30% 50%',
            borderBottomLeftRadius: '6px',
            borderBottomRightRadius: '6px',
            background: isSel ? 'var(--color-gold)' : 'rgba(26, 26, 26, 0.15)',
            padding: '1.5px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isActive ? 'pointer' : 'default',
            opacity: isActive ? 1 : 0.6,
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            transform: isHovered ? 'scale(1.08) translateY(-2px)' : 'none',
            boxShadow: isHovered ? '0 8px 16px rgba(139, 92, 26, 0.12)' : 'none',
          }}
          title={type === 'shared' ? `もとの所有者: ${piece.owner === 'sente' ? (playerNames.sente || '先手') : (playerNames.gote || '後手')}` : undefined}
        >
          <div style={{
            width: '100%',
            height: '100%',
            borderTopLeftRadius: '28% 48%',
            borderTopRightRadius: '28% 48%',
            borderBottomLeftRadius: '5px',
            borderBottomRightRadius: '5px',
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

      const getThemeColor = (theme?: string) => {
        switch (theme) {
          case 'WARRIOR_IRON': return 'var(--color-shinku)';
          case 'MYSTIC_MIST': return 'var(--color-murasaki)';
          case 'SHADOW_NIGHT': return '#555555';
          case 'NATURE_STONE': return 'var(--color-matsuba)';
          default: return 'transparent';
        }
      };
      const themeColor = getThemeColor(piece.visual_theme);

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
          className="wood-card-hand"
          style={{
            position: 'relative',
            width: '50px',
            height: '66px',
            border: `1.5px solid ${isSel ? 'var(--color-gold)' : 'rgba(139, 92, 26, 0.15)'}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: isActive ? 'pointer' : 'default',
            opacity: isActive ? 1 : 0.6,
            userSelect: 'none',
            boxSizing: 'border-box',
            padding: '2px',
          }}
          title={type === 'shared' ? `もとの所有者: ${piece.owner === 'sente' ? (playerNames.sente || '先手') : (playerNames.gote || '後手')}` : undefined}
        >
          {/* Theme Accent Bottom Bar */}
          {themeColor !== 'transparent' && (
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: '3px',
              backgroundColor: themeColor,
            }} />
          )}

          <div style={{
            position: 'absolute',
            top: '2px',
            right: '2px',
            width: '12px',
            height: '12px',
            border: `1px solid ${stamp.color}`,
            borderRadius: '2px',
            color: stamp.color,
            fontSize: '8px',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'scale(0.85)'
          }}>
            {stamp.char}
          </div>

          <div style={{
            fontSize: piece.word.length > 5 ? '7px' : '9px',
            fontWeight: 'bold',
            color: 'var(--color-kurogane)',
            fontFamily: 'var(--font-ui)',
            textAlign: 'center',
            lineHeight: 1.1,
            wordBreak: 'break-all',
            marginTop: '6px',
            padding: '0 2px'
          }}>
            {piece.word}
          </div>
        </div>
      );
    }
  };

  const renderCustomDeckPieceTile = (piece: Piece, idx: number, owner: Player) => {
    const isSel = selectedCustomDeckPiece?.piece.id === piece.id && selectedCustomDeckPiece?.index === idx;
    const isActive = turn === owner && phase === 'playing';

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

    const getThemeColor = (theme?: string) => {
      switch (theme) {
        case 'WARRIOR_IRON': return 'var(--color-shinku)';
        case 'MYSTIC_MIST': return 'var(--color-murasaki)';
        case 'SHADOW_NIGHT': return '#555555';
        case 'NATURE_STONE': return 'var(--color-matsuba)';
        default: return 'transparent';
      }
    };
    const themeColor = getThemeColor(piece.visual_theme);

    const hoverKey = `deck-${owner}-${idx}`;

    return (
      <div
        key={piece.id}
        onClick={() => {
          if (isActive) onCustomDeckPieceClick(piece, idx, owner);
        }}
        onMouseEnter={() => {
          onHoverPiece?.(piece);
          setHoveredIdx(hoverKey);
        }}
        onMouseLeave={() => {
          onHoverPiece?.(null);
          setHoveredIdx(null);
        }}
        className="wood-card-hand"
        style={{
          position: 'relative',
          width: '50px',
          height: '66px',
          border: `1.5px solid ${isSel ? 'var(--color-gold)' : 'rgba(139, 92, 26, 0.15)'}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: isActive ? 'pointer' : 'default',
          opacity: isActive ? 1 : 0.6,
          userSelect: 'none',
          boxSizing: 'border-box',
          padding: '2px',
        }}
      >
        {/* Theme Accent Bottom Bar */}
        {themeColor !== 'transparent' && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '3px',
            backgroundColor: themeColor,
          }} />
        )}

        <div style={{
          position: 'absolute',
          top: '2px',
          right: '2px',
          width: '12px',
          height: '12px',
          border: `1px solid ${stamp.color}`,
          borderRadius: '2px',
          color: stamp.color,
          fontSize: '8px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'scale(0.85)'
        }}>
          {stamp.char}
        </div>

        <div style={{
          fontSize: piece.word.length > 5 ? '7px' : '9px',
          fontWeight: 'bold',
          color: 'var(--color-kurogane)',
          fontFamily: 'var(--font-ui)',
          textAlign: 'center',
          lineHeight: 1.1,
          wordBreak: 'break-all',
          marginTop: '6px',
          padding: '0 2px'
        }}>
          {piece.word}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      
      {/* Tactical Info Panel (Shoji Style) */}
      <div className="cyber-panel" style={{ padding: '20px', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '16px' }}>
        <h3 className="cyber-title" style={{ fontSize: '16px', marginBottom: '12px' }}>
          情報
        </h3>
        
        {/* Selected Piece Details */}
        <div style={{ height: '380px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {(() => {
            const displayPiece = hoveredPiece || selectedPiece || null;
            if (!displayPiece) {
              return (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed rgba(139, 92, 26, 0.15)', borderRadius: '12px', background: 'rgba(139, 92, 26, 0.01)' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-cyber)' }}>駒を選択またはホバーして能力表示</span>
                </div>
              );
            }
            const hasCustomAbility = !!(displayPiece as Piece).custom_ability;
            return (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* カスタム能力バッジカードを先頭に表示 */}
                {hasCustomAbility && (
                  <AbilityTooltip 
                    piece={displayPiece as Piece} 
                    visible 
                    isViewerOpponent={isViewerOpponent} 
                  />
                )}
                {/* 従来の詳細カード */}
                <PieceDetailCard 
                  piece={displayPiece} 
                  isHoverPreview={!!hoveredPiece} 
                  isViewerOpponent={isViewerOpponent} 
                />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Captured Pieces & Shared Pool Panel */}
      <div className="cyber-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '220px', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '16px' }}>
        <h3 className="cyber-title" style={{ fontSize: '16px', marginBottom: '4px' }}>
          手札・持ち駒ストック
        </h3>
        
        {/* Gote Hand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-gold)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
            ▽ {playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} 手札・持ち駒
          </div>
          
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', minHeight: '38px', padding: '8px', background: 'rgba(139, 92, 26, 0.02)', border: '1px solid rgba(139, 92, 26, 0.08)', borderRadius: '12px' }}>
            {capturedPieces.gote.map((piece, idx) => renderCapturedPieceTile(piece, idx, 'gote', 'captured'))}
            {customDecks.gote.map((piece, idx) => renderCustomDeckPieceTile(piece, idx, 'gote'))}
            {capturedPieces.gote.length === 0 && customDecks.gote.length === 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center', paddingLeft: '4px' }}>なし</span>
            )}
          </div>
        </div>

        {/* Graveyard (墓所) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{
            fontSize: '11px',
            color: isResurrectActive ? 'var(--color-gold)' : '#555',
            fontFamily: 'var(--font-cyber)',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            墓所 (Graveyard) {isResurrectActive && <span style={{ color: 'var(--color-shinku)' }}>[蘇生対象を選択してください]</span>}
          </div>
          <div style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            minHeight: '38px',
            padding: '8px',
            background: isResurrectActive ? 'rgba(212,175,55,0.06)' : 'rgba(139, 92, 26, 0.01)',
            border: `1.5px ${isResurrectActive ? 'solid var(--color-gold)' : 'dashed rgba(139, 92, 26, 0.15)'}`,
            borderRadius: '12px',
            transition: 'all 0.3s ease'
          }}>
            {sharedPieces.map((piece, idx) => renderCapturedPieceTile(piece, idx, 'sente', 'shared'))}
            {sharedPieces.length === 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center', paddingLeft: '4px' }}>空</span>
            )}
          </div>
        </div>

        {/* Sente Hand */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ fontSize: '11px', color: 'var(--color-shinku)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
            ▲ {playerNames.sente || 'プレイヤー1'} 手札・持ち駒
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', minHeight: '38px', padding: '8px', background: 'rgba(139, 92, 26, 0.02)', border: '1px solid rgba(139, 92, 26, 0.08)', borderRadius: '12px' }}>
            {capturedPieces.sente.map((piece, idx) => renderCapturedPieceTile(piece, idx, 'sente', 'captured'))}
            {customDecks.sente.map((piece, idx) => renderCustomDeckPieceTile(piece, idx, 'sente'))}
            {capturedPieces.sente.length === 0 && customDecks.sente.length === 0 && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center', paddingLeft: '4px' }}>なし</span>
            )}
          </div>
        </div>
      </div>

      {/* Control Buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          className="cyber-btn cyber-btn-purple"
          style={{ flex: 1, padding: '12px', fontSize: '12px' }}
          onClick={onPassTurn}
          disabled={!!winner || phase === 'placement'}
        >
          手番パス
        </button>
        
        <button
          className="cyber-btn cyber-btn-danger"
          style={{ flex: 1, padding: '12px', fontSize: '12px' }}
          onClick={onResetGame}
        >
          対局リセット
        </button>
      </div>

    </div>
  );
};
