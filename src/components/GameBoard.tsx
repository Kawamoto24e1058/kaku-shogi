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
  customPiecesToPlace: _customPiecesToPlace,
  selectedCell,
  validMoves,
  activeAbilityTargets,
  activeAbilityMode: _activeAbilityMode,
  onCellClick,
  onHoverPiece,
  vsAiMode,
  isSenteChecked = false,
  isGoteChecked = false,
  onlineMode = false,
  myRole = null,
}) => {
  const [localTurn, setLocalTurn] = useState<Player>(turn);
  const [shojiState, setShojiState] = useState<'open' | 'closing' | 'opening'>('open');
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    if (turn !== localTurn) {
      setShojiState('closing');
      const closeTimer = setTimeout(() => {
        setLocalTurn(turn);
        setShojiState('opening');
        
        const openTimer = setTimeout(() => {
          setShojiState('open');
        }, 350);
        return () => clearTimeout(openTimer);
      }, 350);
      return () => clearTimeout(closeTimer);
    }
  }, [turn]);

  const shouldRotate = onlineMode
    ? (myRole === 'gote')
    : (vsAiMode ? false : localTurn === 'gote');

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
    if (localTurn === 'sente') return y >= 6;
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
        if (piece.owner !== localTurn) {
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
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'rgba(244, 237, 226, 0.08)',
      background: 'rgba(255, 255, 255, 0.02)'
    };

    if (isFlashActive) {
      cellStyle.animation = 'damageFlash 0.4s ease-in-out forwards';
    }

    if (isSel) {
      cellStyle.borderColor = 'var(--color-gold)';
      cellStyle.background = 'rgba(212, 175, 55, 0.12)';
    } else if (isMove) {
      cellStyle.borderColor = 'var(--color-gold)';
      cellStyle.borderStyle = 'dashed';
      cellStyle.background = 'rgba(212, 175, 55, 0.06)';
    } else if (isActiveTarget) {
      cellStyle.borderColor = 'var(--color-murasaki)';
      cellStyle.background = 'rgba(74, 21, 75, 0.15)';
    } else if (isSetupValid) {
      cellStyle.borderColor = 'var(--color-gold)';
      cellStyle.background = 'rgba(244, 237, 226, 0.05)';
      cellStyle.borderStyle = 'dashed';
    }

    let pieceUI = null;
    if (piece) {
      const viewer: Player = onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : localTurn);
      const isMyPiece = piece.owner === viewer;
      const shouldHide = !isMyPiece && !piece.isRevealed;

      if (!shouldHide) {
        const isAutonomous = piece.trigger === 'ALWAYS' && (getPieceLogicCode(piece).includes('runaway') || piece.description.includes('操作不能'));
        const isCustom = !piece.isKing && !piece.isPawn && !piece.isHisha && !piece.isKaku;
        
        // 1. 白木の縦長木札テーマ
        let baseBg = 'var(--color-shiraki)'; 
        let baseBorderColor = 'rgba(26, 26, 26, 0.15)';
        let insetShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.6), inset 0 -1px 2px rgba(0, 0, 0, 0.08)';

        let borderWidthVal = '1px';
        let borderStyleVal = 'solid';
        let borderColorVal = baseBorderColor;
        let boxShadowStyle = `0 2px 4px rgba(0, 0, 0, 0.25), ${insetShadow}`;
        let widthStyle = '86%';
        let heightStyle = '92%';
        let borderRadiusStyle = '2px';

        // 2. 駒の種類ごとの差別化（歩兵 vs 王将 vs カスタム駒）
        if (piece.isKing) {
          borderWidthVal = '1.5px';
          borderColorVal = 'var(--color-gold)';
          boxShadowStyle = `0 3px 6px rgba(0, 0, 0, 0.3), ${insetShadow}`;
        } else if (piece.isPawn) {
          widthStyle = '76%';
          heightStyle = '82%';
          borderColorVal = 'rgba(26, 26, 26, 0.12)';
        } else if (piece.isHisha || piece.isKaku) {
          widthStyle = '84%';
          heightStyle = '90%';
        } else if (isCustom) {
          borderColorVal = 'rgba(26, 26, 26, 0.2)';
        }
        
        const pieceStyle: React.CSSProperties = {
          width: widthStyle,
          height: heightStyle,
          borderRadius: borderRadiusStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: borderWidthVal,
          borderStyle: borderStyleVal,
          borderColor: borderColorVal,
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
          pieceStyle.borderColor = 'var(--color-murasaki)';
          pieceStyle.opacity = 0.85;
        }

        if (isAutonomous) {
          pieceStyle.borderStyle = 'dashed';
          pieceStyle.borderColor = 'var(--color-shinku)';
        }

        if (piece.isKing && ((piece.owner === 'sente' && isSenteChecked) || (piece.owner === 'gote' && isGoteChecked))) {
          pieceStyle.borderColor = 'var(--color-shinku)';
          pieceStyle.boxShadow = '0 0 10px var(--color-shinku), inset 0 0 4px rgba(158, 42, 43, 0.4)';
        }

        const triggerLetter = getPieceTrigger(piece).substring(0, 1);
        const isSpent = piece.coolDownTurnsRemaining > 0;

        let textColor = 'var(--color-kurogane)';
        if (piece.isPromoted) {
          textColor = 'var(--color-shinku)';
        } else if (piece.isKing) {
          textColor = '#1A1A1A';
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
                  color: 'var(--color-gold)',
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
                  color: isSpent ? 'var(--text-muted)' : 'var(--color-kurogane)',
                  border: `0.5px solid ${isSpent ? 'var(--text-muted)' : 'rgba(26, 26, 26, 0.25)'}`,
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
                  color: 'var(--color-shinku)',
                  border: '0.5px solid var(--color-shinku)',
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.8)',
                  background: 'rgba(158, 42, 43, 0.05)'
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
                marginTop: piece.isKing ? '6px' : '0'
              }}>
                {piece.isHisha && piece.isPromoted ? '竜王' : (piece.isKaku && piece.isPromoted ? '竜馬' : (piece.isPawn && piece.isPromoted ? 'と金' : piece.word))}
              </div>
              {/* Abbreviated logic label */}
              {!piece.isKing && !piece.isPawn && !piece.isHisha && !piece.isKaku && (
                <div style={{ fontSize: '5px', color: 'rgba(26, 26, 26, 0.5)', transform: 'scale(0.8)', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-cyber)', marginTop: '1px' }}>
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
                  color: 'var(--color-gold)',
                  border: '0.5px solid var(--color-gold)',
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.7)',
                  background: 'var(--color-washi)'
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
                  color: 'var(--color-murasaki)',
                  border: '0.5px solid var(--color-murasaki)',
                  borderRadius: '1px',
                  padding: '0 1px',
                  transform: 'scale(0.7)',
                  background: 'var(--color-washi)'
                }}>
                  充填:{piece.coolDownTurnsRemaining}
                </div>
              )}
            </div>
            {/* Camp Marker Line */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '100%',
              height: '3px',
              backgroundColor: piece.owner === 'gote' ? 'var(--color-kurogane)' : 'var(--color-shinku)',
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
            const viewer: Player = onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : localTurn);
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
      
      {/* Main Shogi Grid (9x9) */}
      <div className="shogi-board-outer" style={{
        width: '100%',
        maxWidth: 'min(620px, max(360px, calc(100vh - 180px)))',
        position: 'relative',
        padding: '15px 15px 15px 5px',
        boxSizing: 'border-box'
      }}>
        {/* Shoji Sliding Transition Overlay */}
        <div className={`shoji-overlay ${shojiState !== 'open' ? shojiState : ''}`} style={{ display: shojiState === 'open' ? 'none' : 'flex' }}>
          <div className="shoji-door-left" />
          <div className="shoji-door-right" />
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`,
          gap: '1px',
          background: 'rgba(26, 26, 26, 0.85)',
          padding: '8px',
          borderRadius: '2px',
          border: '1.5px solid var(--color-gold)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
          aspectRatio: '1',
          width: '100%',
        }}>
          {Array.from({ length: BOARD_SIZE }).map((_, y) => 
            Array.from({ length: BOARD_SIZE }).map((_, x) => renderCell(y, x))
          )}
        </div>
      </div>
      
    </div>
  );
};
