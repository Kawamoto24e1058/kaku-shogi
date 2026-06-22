import React, { useRef, useState, useEffect } from 'react';
import type { Board, Piece, Player, GamePhase } from '../types';
import { BOARD_SIZE, getPieceLogicCode, getPieceTrigger } from '../gameLogic';

interface GameBoardProps {
  board: Board;
  turn: Player;
  phase: GamePhase;
  capturedPieces: {
    sente: Piece[];
    gote: Piece[];
  };
  customDecks: {
    sente: Piece[];
    gote: Piece[];
  };
  destroyedPieces?: Piece[];
  sharedPieces: Piece[]; // Shared fantasy pool pieces
  customPiecesToPlace: Piece[];
  selectedCell: [number, number] | null;
  selectedCapturedPiece: { piece: Piece; index: number } | null;
  selectedSharedPiece: { piece: Piece; index: number } | null; // Shared pool selection
  selectedCustomDeckPiece: { piece: Piece; index: number } | null;
  validMoves: [number, number][];
  activeAbilityTargets: [number, number][];
  activeAbilityMode: boolean;
  onCellClick: (y: number, x: number) => void;
  onCapturedPieceClick: (piece: Piece, index: number, owner: Player) => void;
  onCustomDeckPieceClick: (piece: Piece, index: number, owner: Player) => void;
  onSharedPieceClick: (piece: Piece, index: number) => void; // Shared pool callback
  onHoverPiece?: (piece: Piece | null) => void; // Hover popup callback
  vsAiMode: boolean;
  isSenteChecked?: boolean;
  isGoteChecked?: boolean;
  onlineMode?: boolean;
  myRole?: 'sente' | 'gote' | null;
  playerNames: { sente: string; gote: string };
}

export const GameBoard: React.FC<GameBoardProps> = ({
  board,
  turn,
  phase,
  capturedPieces,
  customDecks,
  sharedPieces,
  customPiecesToPlace: _customPiecesToPlace,
  selectedCell,
  selectedCapturedPiece,
  selectedSharedPiece,
  selectedCustomDeckPiece,
  validMoves,
  activeAbilityTargets,
  activeAbilityMode: _activeAbilityMode,
  onCellClick,
  onCapturedPieceClick,
  onCustomDeckPieceClick,
  onSharedPieceClick,
  onHoverPiece,
  vsAiMode,
  isSenteChecked = false,
  isGoteChecked = false,
  onlineMode = false,
  myRole = null,
  playerNames,
}) => {
  const shouldRotate = onlineMode
    ? (myRole === 'gote')
    : (vsAiMode ? false : turn === 'gote');

  const prevBoardRef = useRef<Board | null>(null);
  const [damageFlashCells, setDamageFlashCells] = useState<Record<string, boolean>>({});

  // Detect HP reduction or captures to trigger a damage flash
  useEffect(() => {
    if (prevBoardRef.current) {
      const newFlashCells: Record<string, boolean> = {};
      let hasChanges = false;

      const pieceExistsOnNewBoard = (pieceId: string) => {
        return board.some(row => row.some(p => p?.id === pieceId));
      };

      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          const prevPiece = prevBoardRef.current[y]?.[x];
          const currPiece = board[y]?.[x];

          if (prevPiece) {
            if (!currPiece) {
              // Piece vanished from cell. If it is no longer anywhere on the board, it was captured.
              if (!pieceExistsOnNewBoard(prevPiece.id)) {
                newFlashCells[`${y},${x}`] = true;
                hasChanges = true;
              }
            } else if (currPiece.id !== prevPiece.id) {
              // Piece replaced by opponent (capture)
              newFlashCells[`${y},${x}`] = true;
              hasChanges = true;
            }
          }
        }
      }

      if (hasChanges) {
        setDamageFlashCells(prev => ({ ...prev, ...newFlashCells }));
        // Clean flash state after animation duration (400ms)
        const timer = setTimeout(() => {
          setDamageFlashCells(prev => {
            const updated = { ...prev };
            Object.keys(newFlashCells).forEach(key => {
              delete updated[key];
            });
            return updated;
          });
        }, 400);
        return () => clearTimeout(timer);
      }
    }
    prevBoardRef.current = board;
  }, [board]);
  
  // Helpers to check highlights
  const isMoveHighlight = (y: number, x: number) => {
    return validMoves.some(([my, mx]) => my === y && mx === x);
  };

  const isActiveAbilityHighlight = (y: number, x: number) => {
    return activeAbilityTargets.some(([dy, dx]) => dy === y && dx === x);
  };

  const isSelected = (y: number, x: number) => {
    return selectedCell !== null && selectedCell[0] === y && selectedCell[1] === x;
  };

  const isValidSetupCell = (y: number, x: number) => {
    if (phase !== 'placement') return false;
    if (board[y][x] !== null) return false;
    // Sente places on bottom 3 ranks (y=6, 7, 8)
    if (turn === 'sente') return y >= 6;
    // Gote places on top 3 ranks (y=0, 1, 2)
    return y <= 2;
  };

  // Render cell
  const renderCell = (y: number, x: number) => {
    const piece = board[y][x];
    const isSel = isSelected(y, x);
    const isMove = isMoveHighlight(y, x);
    const isActiveTarget = isActiveAbilityHighlight(y, x);
    const isSetupValid = isValidSetupCell(y, x);
    const isFlashActive = damageFlashCells[`${y},${x}`];

    let cellClassName = '';
    if (isActiveTarget) {
      if (piece) {
        if (piece.owner !== turn) {
          cellClassName = 'ability-target-blue';
        } else {
          cellClassName = 'ability-target-yellow';
        }
      }
    }

    let cellStyle: React.CSSProperties = {
      width: '100%',
      minWidth: 0,
      aspectRatio: '1',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      cursor: 'pointer',
      fontSize: '11px',
      userSelect: 'none',
      transition: 'all 0.15s ease',
      border: '1px solid rgba(139, 101, 58, 0.25)',
      background: 'rgba(240, 235, 215, 0.35)'
    };

    if (isFlashActive) {
      cellStyle.animation = 'damageFlash 0.4s ease-in-out forwards';
    }

    if (isSel) {
      cellStyle.boxShadow = '0 0 10px rgba(86, 166, 191, 0.7), inset 0 0 8px rgba(86, 166, 191, 0.3)';
      cellStyle.borderColor = 'var(--neon-cyan)';
      cellStyle.background = 'rgba(86, 166, 191, 0.2)';
    } else if (isMove) {
      cellStyle.boxShadow = '0 0 8px rgba(124, 168, 86, 0.5), inset 0 0 4px rgba(124, 168, 86, 0.2)';
      cellStyle.borderColor = 'var(--neon-green)';
      cellStyle.background = 'rgba(124, 168, 86, 0.15)';
    } else if (isActiveTarget) {
      const selectedPiece = selectedCell ? board[selectedCell[0]][selectedCell[1]] : null;
      const isTeleport = selectedPiece 
        ? ['random_move', 'teleport_anywhere', 'copy_and_teleport'].includes(getPieceLogicCode(selectedPiece))
        : false;
      
      const glowColor = isTeleport ? 'var(--neon-purple)' : 'var(--neon-pink)';
      const rgbaGlow = isTeleport ? 'rgba(209, 73, 73, 0.5)' : 'rgba(214, 108, 133, 0.5)';
      const rgbaBg = isTeleport ? 'rgba(209, 73, 73, 0.25)' : 'rgba(214, 108, 133, 0.25)';

      cellStyle.boxShadow = `0 0 8px ${rgbaGlow}, inset 0 0 6px ${rgbaGlow}`;
      cellStyle.borderColor = glowColor;
      cellStyle.background = rgbaBg;
    } else if (isSetupValid) {
      cellStyle.borderColor = turn === 'sente' ? 'rgba(86, 166, 191, 0.4)' : 'rgba(209, 73, 73, 0.4)';
      cellStyle.background = turn === 'sente' ? 'rgba(86, 166, 191, 0.08)' : 'rgba(209, 73, 73, 0.08)';
      cellStyle.borderStyle = 'dashed';
    }

    let pieceUI = null;
    if (piece) {
      const viewer: Player = onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : turn);
      const isMyPiece = piece.owner === viewer;
      const shouldHide = !isMyPiece && !piece.isRevealed;

      if (!shouldHide) {
        const isAutonomous = piece.trigger === 'ALWAYS' && (getPieceLogicCode(piece).includes('runaway') || piece.description.includes('操作不能'));
        const isCustom = !piece.isKing && !piece.isPawn && !piece.isHisha && !piece.isKaku;
        const isGote = piece.owner === 'gote';
        
        // 1. 敵味方の基本カラーテーマ（先手＝シアン/ブルー、後手＝ピンク/レッド）
        let baseBg = isGote ? '#1c0c12' : '#0d1520'; 
        let baseBorderColor = isGote ? 'rgba(255, 0, 85, 0.4)' : 'rgba(0, 243, 255, 0.4)';
        let insetShadow = isGote ? 'inset 0 0 6px rgba(255, 0, 85, 0.25)' : 'inset 0 0 6px rgba(0, 243, 255, 0.25)';

        let borderStyle = `1px solid ${baseBorderColor}`;
        let boxShadowStyle = insetShadow;
        let widthStyle = '92%';
        let heightStyle = '92%';
        let borderRadiusStyle = '2px';

        // 2. 駒の種類ごとの差別化（歩兵 vs 王将 vs カスタム駒）
        if (piece.isKing) {
          borderStyle = '2px solid var(--neon-yellow)';
          boxShadowStyle = `0 0 12px rgba(219, 188, 98, 0.65), ${insetShadow}`;
          borderRadiusStyle = '4px';
          baseBg = isGote ? '#261a10' : '#1c1c15';
        } else if (piece.isPawn) {
          borderStyle = '1px dashed rgba(255, 255, 255, 0.15)';
          boxShadowStyle = 'none';
          widthStyle = '78%';
          heightStyle = '78%';
          borderRadiusStyle = '1px';
        } else if (piece.isHisha || piece.isKaku) {
          borderStyle = `1.5px solid ${baseBorderColor}`;
          boxShadowStyle = `0 0 8px ${isGote ? 'rgba(255, 0, 85, 0.35)' : 'rgba(0, 243, 255, 0.35)'}, ${insetShadow}`;
          widthStyle = '90%';
          heightStyle = '90%';
          borderRadiusStyle = '3px';
        } else if (isCustom) {
          borderStyle = '1px solid #e6d0af';
          let glowColor = 'rgba(230, 208, 175, 0.2)';
          if (piece.mechanics_type === 'STEALTH_TRAP') {
            glowColor = 'rgba(168, 85, 247, 0.45)'; // 罠：紫
          } else if (piece.mechanics_type === 'MOVEMENT_HACK') {
            glowColor = 'rgba(34, 197, 94, 0.45)';  // 移動：緑
          } else if (piece.mechanics_type === 'RULE_BREAK') {
            glowColor = 'rgba(59, 130, 246, 0.45)';  // 環境：青
          } else if (piece.mechanics_type === 'DYNAMICS_HACK') {
            glowColor = 'rgba(236, 72, 153, 0.45)';  // 奇策：ピンク
          } else if (piece.mechanics_type === 'AUTOMATIC_DRIVE') {
            glowColor = 'rgba(249, 115, 22, 0.55)';   // 暴走：オレンジ
          }
          boxShadowStyle = `${insetShadow}, 0 0 8px ${glowColor}, 0 0 0 1px rgba(230, 208, 175, 0.25)`;
        }
        
        const pieceStyle: React.CSSProperties = {
          width: widthStyle,
          height: heightStyle,
          borderRadius: borderRadiusStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: borderStyle,
          boxShadow: boxShadowStyle,
          background: baseBg,
          transform: isMyPiece
            ? (shouldRotate ? 'rotate(180deg)' : 'none')
            : (shouldRotate ? 'none' : 'rotate(180deg)'),
          transition: 'all 0.2s ease',
          position: 'relative',
          overflow: 'hidden',
        };

        if (!piece.isRevealed && isMyPiece) {
          pieceStyle.opacity = 0.55;
          pieceStyle.borderStyle = 'dashed';
        }

        if (piece.coolDownTurnsRemaining > 0) {
          pieceStyle.borderStyle = 'dotted';
          pieceStyle.borderColor = '#00f3ff';
          pieceStyle.boxShadow = `${insetShadow}, 0 0 10px rgba(0, 243, 255, 0.4)`;
          pieceStyle.opacity = 0.75;
        }

        if (isAutonomous) {
          pieceStyle.borderStyle = 'dashed';
          pieceStyle.borderColor = '#ff007f';
          pieceStyle.boxShadow = '0 0 8px #ff007f';
        }

        if (piece.isKing && ((piece.owner === 'sente' && isSenteChecked) || (piece.owner === 'gote' && isGoteChecked))) {
          pieceStyle.animation = 'kingPulse 0.8s infinite alternate';
          pieceStyle.borderColor = '#ff003c';
          pieceStyle.boxShadow = '0 0 15px #ff003c, inset 0 0 8px rgba(255, 0, 60, 0.4)';
        }

        const triggerLetter = getPieceTrigger(piece).substring(0, 1);
        const isSpent = piece.coolDownTurnsRemaining > 0;

        let textColor = '#a1a1aa';
        if (piece.isKing) {
          textColor = 'var(--neon-yellow)';
        } else if (piece.isPawn) {
          textColor = isGote ? '#c07a84' : '#7ba1b3';
        } else if (piece.isPromoted) {
          textColor = 'var(--neon-yellow)';
        } else if (isCustom) {
          textColor = isGote ? '#ff79c6' : '#8ae9fd';
        }

        // Inner text wrapper that cancels rotation for Gote pieces
        const innerStyle: React.CSSProperties = {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'none',
          position: 'relative',
          overflow: 'hidden',
          boxSizing: 'border-box',
          padding: '2px',
        };

        pieceUI = (
          <div style={pieceStyle}>
            <div style={innerStyle}>
              {/* King Decoration Crown Icon */}
              {piece.isKing && (
                <div style={{
                  position: 'absolute',
                  top: '2px',
                  fontSize: '8px',
                  color: 'rgba(219, 188, 98, 0.4)',
                  textShadow: '0 0 4px rgba(219, 188, 98, 0.5)',
                  userSelect: 'none'
                }}>
                  👑
                </div>
              )}
              {/* Trigger Badge */}
              {!piece.isKing && !piece.isPawn && (
                <div style={{
                  position: 'absolute',
                  top: '1px',
                  left: '1px',
                  fontSize: '5px',
                  fontFamily: 'var(--font-cyber)',
                  color: isSpent ? 'var(--text-muted)' : (isCustom ? 'var(--shogi-wood)' : 'var(--neon-cyan)'),
                  border: `0.5px solid ${isSpent ? 'var(--text-muted)' : (isCustom ? 'var(--shogi-wood)' : 'var(--neon-cyan)')}`,
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.8)'
                }}>
                  {triggerLetter}
                </div>
              )}
              {/* Autonomous Badge */}
              {isAutonomous && (
                <div style={{
                  position: 'absolute',
                  top: '1px',
                  right: '1px',
                  fontSize: '5px',
                  fontFamily: 'var(--font-cyber)',
                  color: '#ff007f',
                  border: '0.5px solid #ff007f',
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.8)',
                  background: 'rgba(255, 0, 127, 0.2)'
                }}>
                  自律
                </div>
              )}
              {/* Piece Text - size locked with break-all to prevent cell warping */}
              <div style={{
                fontSize: piece.isKing ? '14px' : ((piece.isHisha || piece.isKaku) ? '12px' : (piece.isPawn ? '10px' : (piece.word.length > 5 ? '8px' : '11px'))),
                fontWeight: (piece.isKing || piece.isHisha || piece.isKaku) ? '900' : 'bold',
                color: textColor,
                textAlign: 'center',
                whiteSpace: 'normal',
                wordBreak: 'break-all',
                lineHeight: 1.1,
                textShadow: piece.isKing ? '0 0 8px rgba(219, 188, 98, 0.4)' : (isCustom ? `0 0 5px ${isGote ? 'rgba(255, 121, 198, 0.3)' : 'rgba(138, 233, 253, 0.3)'}` : 'none'),
                marginTop: piece.isKing ? '6px' : '0' // Push down slightly for the crown icon
              }}>
                {piece.isHisha && piece.isPromoted ? '竜王' : (piece.isKaku && piece.isPromoted ? '竜馬' : (piece.isPawn && piece.isPromoted ? 'と金' : piece.word))}
              </div>
              {/* Abbreviated logic label */}
              {!piece.isKing && !piece.isPawn && !piece.isHisha && !piece.isKaku && (
                <div style={{ fontSize: '5px', color: piece.isPromoted ? 'rgba(255,255,255,0.6)' : 'var(--shogi-wood)', transform: 'scale(0.8)', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-cyber)', marginTop: '1px' }}>
                  {piece.isPromoted ? piece.promoted_effect.effect_name.substring(0, 4) : piece.effect_name.split('「').pop()?.replace('」', '').substring(0, 4)}
                </div>
              )}
              {/* Promotion Tag */}
              {piece.isPromoted && (
                <div style={{
                  position: 'absolute',
                  top: '1px',
                  right: '1px',
                  fontSize: '5px',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-cyber)',
                  color: 'var(--neon-yellow)',
                  border: '0.5px solid var(--neon-yellow)',
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.7)',
                  background: 'rgba(0,0,0,0.8)'
                }}>
                  成
                </div>
              )}
              {/* Cooldown Tag */}
              {piece.coolDownTurnsRemaining > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: '1px',
                  right: '1px',
                  fontSize: '5px',
                  fontFamily: 'var(--font-cyber)',
                  color: 'var(--neon-pink)',
                  border: '0.5px solid var(--neon-pink)',
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.7)',
                  background: 'rgba(0,0,0,0.8)'
                }}>
                  充填:{piece.coolDownTurnsRemaining}
                </div>
              )}
            </div>
            {/* Camp Marker Line: rotated bottom:0 automatically becomes top:0 for Gote */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: '3px',
              backgroundColor: piece.owner === 'gote' ? 'var(--shogi-gote)' : 'var(--shogi-sente)',
              zIndex: 5,
            }} />
          </div>
        );
      }
    }

    return (
      <div
        key={`${y}-${x}`}
        className={cellClassName}
        style={cellStyle}
        onClick={() => onCellClick(y, x)}
        onTouchEnd={(e) => {
          e.preventDefault();
          onCellClick(y, x);
        }}
        onMouseEnter={() => {
          if (piece) {
            const viewer: Player = onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : turn);
            const isMyPiece = piece.owner === viewer;
            if (isMyPiece) {
              onHoverPiece?.(piece);
            } else {
              onHoverPiece?.(null);
            }
          }
        }}
        onMouseLeave={() => onHoverPiece?.(null)}
      >
        {pieceUI}
        
        {y === 0 && (
          <div style={{
            position: 'absolute',
            top: '-15px',
            left: '50%',
            transform: shouldRotate ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)',
            transition: 'transform 0.6s ease-in-out',
            fontSize: '8px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-cyber)'
          }}>
            {9 - x}
          </div>
        )}
        {x === BOARD_SIZE - 1 && (
          <div style={{
            position: 'absolute',
            right: '-15px',
            top: '50%',
            transform: shouldRotate ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)',
            transition: 'transform 0.6s ease-in-out',
            fontSize: '8px',
            color: 'var(--text-muted)'
          }}>
            {['一', '二', '三', '四', '五', '六', '七', '八', '九'][y]}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      transform: shouldRotate ? 'rotate(180deg)' : 'none',
      transition: 'transform 0.6s ease-in-out',
      transformOrigin: 'center center'
    }}>
      
      {/* Gote Captured Hand */}
      <div className="cyber-panel" style={{
        width: '100%',
        maxWidth: '620px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '44px',
        marginBottom: '8px',
        border: '1px solid rgba(189,0,255,0.2)',
        background: 'rgba(189, 0, 255, 0.03)',
        flexWrap: 'wrap',
        transform: shouldRotate ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.6s ease-in-out',
      }}>
        <div style={{ fontSize: '10px', color: 'var(--neon-purple)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} 持ち駒
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', flex: 1 }}>
          {capturedPieces.gote.map((piece, idx) => {
            const isSel = selectedCapturedPiece?.piece.id === piece.id && selectedCapturedPiece?.index === idx;
            return (
              <div
                key={piece.id}
                onClick={() => onCapturedPieceClick(piece, idx, 'gote')}
                onMouseEnter={() => { const viewer = vsAiMode ? 'sente' : turn; onHoverPiece?.(viewer === 'gote' ? piece : null); }}
                onMouseLeave={() => onHoverPiece?.(null)}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${isSel ? 'var(--neon-purple)' : 'rgba(189,0,255,0.25)'}`,
                  background: isSel ? 'rgba(189,0,255,0.2)' : 'rgba(189,0,255,0.05)',
                  cursor: turn === 'gote' && phase === 'playing' ? 'pointer' : 'default',
                  fontSize: '10px',
                  color: '#fff',
                }}
              >
                {piece.word}
              </div>
            );
          })}
          {capturedPieces.gote.length === 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>なし</span>
          )}
        </div>
      </div>

      {/* Gote Custom Deck */}
      <div className="cyber-panel" style={{
        width: '100%',
        maxWidth: '620px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '44px',
        marginBottom: '8px',
        border: '1px solid rgba(189,0,255,0.15)',
        background: 'rgba(189, 0, 255, 0.02)',
        flexWrap: 'wrap',
        transform: shouldRotate ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.6s ease-in-out',
      }}>
        <div style={{ fontSize: '10px', color: 'var(--neon-purple)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} 手札デッキ
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
          {customDecks.gote.map((piece, idx) => {
            const isSel = selectedCustomDeckPiece?.piece.id === piece.id && selectedCustomDeckPiece?.index === idx;
            return (
              <div
                key={piece.id}
                onClick={() => onCustomDeckPieceClick(piece, idx, 'gote')}
                onMouseEnter={() => { const viewer = vsAiMode ? 'sente' : turn; onHoverPiece?.(viewer === 'gote' ? piece : null); }}
                onMouseLeave={() => onHoverPiece?.(null)}
                className={`custom-deck-card gote-card ${isSel ? 'selected' : ''}`}
                style={{
                  border: isSel ? '1px solid var(--neon-purple)' : undefined,
                  background: isSel ? 'rgba(189,0,255,0.15)' : undefined,
                  boxShadow: isSel ? '0 0 12px rgba(189,0,255,0.4)' : undefined,
                  cursor: turn === 'gote' && phase === 'playing' ? 'pointer' : 'default',
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#ffffff' }}>{piece.word}</span>
                <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>{piece.ability_genre || '能力駒'}</span>
              </div>
            );
          })}
          {customDecks.gote.length === 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>なし</span>
          )}
        </div>
      </div>

      {/* Shared cooperative pool (Coexistence tray) */}
      <div className="cyber-panel pink-glow" style={{
        width: '100%',
        maxWidth: '620px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '44px',
        marginBottom: '8px',
        background: 'rgba(255, 0, 127, 0.03)',
        flexWrap: 'wrap',
        transform: shouldRotate ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.6s ease-in-out',
      }}>
        <div style={{ fontSize: '10px', color: 'var(--neon-pink)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          共有プール
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', flex: 1 }}>
          {sharedPieces.map((piece, idx) => {
            const isSel = selectedSharedPiece?.piece.id === piece.id && selectedSharedPiece?.index === idx;
            return (
              <div
                key={piece.id}
                onClick={() => onSharedPieceClick(piece, idx)}
                onMouseEnter={() => onHoverPiece?.(piece)}
                onMouseLeave={() => onHoverPiece?.(null)}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${isSel ? 'var(--neon-pink)' : 'rgba(255,0,127,0.25)'}`,
                  background: isSel ? 'rgba(255,0,127,0.2)' : 'rgba(255,0,127,0.05)',
                  cursor: phase === 'playing' ? 'pointer' : 'default',
                  fontSize: '10px',
                  color: '#fff',
                }}
                title={`もとの所有者: ${piece.owner === 'sente' ? (playerNames.sente || 'プレイヤー1') : (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'))}`}
              >
                {piece.word}
              </div>
            );
          })}
          {sharedPieces.length === 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>（共同幻想プールは現在空です）</span>
          )}
        </div>
      </div>

      {/* Main Shogi Grid (9x9) */}
      <div className="shogi-board-outer" style={{ width: '100%', maxWidth: '620px', position: 'relative', padding: '15px 15px 15px 5px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`,
          gap: '2px',
          background: '#d1a166',
          backgroundImage: 'radial-gradient(circle, #e3b67b 0%, #bd8c50 100%)',
          padding: '10px',
          borderRadius: '4px',
          border: '3px solid #6b4d2b',
          boxShadow: '0 15px 35px rgba(0,0,0,0.55), inset 0 0 10px rgba(0,0,0,0.15)',
          aspectRatio: '1',
          width: '100%',
        }}>
          {Array.from({ length: BOARD_SIZE }).map((_, y) => 
            Array.from({ length: BOARD_SIZE }).map((_, x) => renderCell(y, x))
          )}
        </div>
      </div>

      {/* Sente Captured Hand */}
      <div className="cyber-panel" style={{
        width: '100%',
        maxWidth: '620px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '44px',
        marginTop: '8px',
        border: '1px solid rgba(0,243,255,0.2)',
        background: 'rgba(0, 243, 255, 0.03)',
        flexWrap: 'wrap',
        transform: shouldRotate ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.6s ease-in-out',
      }}>
        <div style={{ fontSize: '10px', color: 'var(--neon-cyan)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {playerNames.sente || 'プレイヤー1'} 持ち駒
        </div>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', flex: 1 }}>
          {capturedPieces.sente.map((piece, idx) => {
            const isSel = selectedCapturedPiece?.piece.id === piece.id && selectedCapturedPiece?.index === idx;
            return (
              <div
                key={piece.id}
                onClick={() => onCapturedPieceClick(piece, idx, 'sente')}
                onMouseEnter={() => { const viewer = vsAiMode ? 'sente' : turn; onHoverPiece?.(viewer === 'sente' ? piece : null); }}
                onMouseLeave={() => onHoverPiece?.(null)}
                style={{
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: `1px solid ${isSel ? 'var(--neon-cyan)' : 'rgba(0,243,255,0.25)'}`,
                  background: isSel ? 'rgba(0,243,255,0.2)' : 'rgba(0,243,255,0.05)',
                  cursor: turn === 'sente' && phase === 'playing' ? 'pointer' : 'default',
                  fontSize: '10px',
                  color: '#fff',
                }}
              >
                {piece.word}
              </div>
            );
          })}
          {capturedPieces.sente.length === 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>なし</span>
          )}
        </div>
      </div>

      {/* Sente Custom Deck */}
      <div className="cyber-panel" style={{
        width: '100%',
        maxWidth: '620px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '44px',
        marginTop: '8px',
        border: '1px solid rgba(0,243,255,0.15)',
        background: 'rgba(0, 243, 255, 0.02)',
        flexWrap: 'wrap',
        transform: shouldRotate ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.6s ease-in-out',
      }}>
        <div style={{ fontSize: '10px', color: 'var(--neon-cyan)', fontFamily: 'var(--font-cyber)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
          {playerNames.sente || 'プレイヤー1'} 手札デッキ
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
          {customDecks.sente.map((piece, idx) => {
            const isSel = selectedCustomDeckPiece?.piece.id === piece.id && selectedCustomDeckPiece?.index === idx;
            return (
              <div
                key={piece.id}
                onClick={() => onCustomDeckPieceClick(piece, idx, 'sente')}
                onMouseEnter={() => { const viewer = vsAiMode ? 'sente' : turn; onHoverPiece?.(viewer === 'sente' ? piece : null); }}
                onMouseLeave={() => onHoverPiece?.(null)}
                className={`custom-deck-card sente-card ${isSel ? 'selected' : ''}`}
                style={{
                  border: isSel ? '1px solid var(--neon-cyan)' : undefined,
                  background: isSel ? 'rgba(0,243,255,0.15)' : undefined,
                  boxShadow: isSel ? '0 0 12px rgba(0,243,255,0.4)' : undefined,
                  cursor: turn === 'sente' && phase === 'playing' ? 'pointer' : 'default',
                }}
              >
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#ffffff' }}>{piece.word}</span>
                <span style={{ fontSize: '8px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>{piece.ability_genre || '能力駒'}</span>
              </div>
            );
          })}
          {customDecks.sente.length === 0 && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>なし</span>
          )}
        </div>
      </div>
      
    </div>
  );
};
