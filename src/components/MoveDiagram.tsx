import React from 'react';
import type { CustomMoveDef } from '../types';

interface MoveDiagramProps {
  customMoves?: CustomMoveDef[];
}

export const MoveDiagram: React.FC<MoveDiagramProps> = ({ customMoves }) => {
  if (!customMoves || customMoves.length === 0) return null;

  const GRID_SIZE = 7;
  const CENTER = 3;

  // Helper to determine the arrow symbol for a sliding move direction
  const getSlideArrow = (dx: number, dy: number): string => {
    if (dy < 0 && dx === 0) return '↑';
    if (dy > 0 && dx === 0) return '↓';
    if (dy === 0 && dx < 0) return '←';
    if (dy === 0 && dx > 0) return '→';
    if (dy < 0 && dx < 0) return '↖';
    if (dy < 0 && dx > 0) return '↗';
    if (dy > 0 && dx < 0) return '↙';
    if (dy > 0 && dx > 0) return '↘';
    return '➔';
  };

  // Helper to check if a grid cell (dx, dy) is targeted by a custom move
  const getCellTarget = (dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return 'center';

    for (const move of customMoves) {
      if (move.slide) {
        // A cell (dx, dy) is on the sliding ray if it is a positive integer multiple of (move.dx, move.dy)
        const s_dx = move.dx;
        const s_dy = move.dy;
        if (s_dx === 0 && s_dy === 0) continue;

        const isMultipleX = s_dx === 0 ? dx === 0 : (dx % s_dx === 0 && dx / s_dx > 0);
        const isMultipleY = s_dy === 0 ? dy === 0 : (dy % s_dy === 0 && dy / s_dy > 0);

        if (isMultipleX && isMultipleY) {
          const ratioX = s_dx !== 0 ? dx / s_dx : null;
          const ratioY = s_dy !== 0 ? dy / s_dy : null;
          if (ratioX !== null && ratioY !== null) {
            if (ratioX === ratioY) return 'slide';
          } else {
            return 'slide';
          }
        }
      } else {
        if (move.dx === dx && move.dy === dy) {
          return move.jump ? 'jump' : 'normal';
        }
      }
    }
    return null;
  };

  const gridCells = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const dy = r - CENTER;
      const dx = c - CENTER;
      const target = getCellTarget(dx, dy);
      gridCells.push({ r, c, dx, dy, target });
    }
  }

  return (
    <div style={{
      display: 'inline-block',
      padding: '6px',
      background: 'rgba(26, 26, 26, 0.05)',
      borderRadius: '8px',
      border: '1px solid rgba(139, 92, 26, 0.15)',
      boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.05)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${GRID_SIZE}, 16px)`,
        gridTemplateRows: `repeat(${GRID_SIZE}, 16px)`,
        gap: '2px',
      }}>
        {gridCells.map((cell, index) => {
          let bg = 'rgba(255, 255, 255, 0.65)';
          let color = '#374151';
          let content = '';
          let fontSize = '9px';
          let fontWeight = 'normal';

          if (cell.target === 'center') {
            bg = '#d4af37'; // gold center
            color = '#ffffff';
            content = '☖';
            fontSize = '11px';
            fontWeight = 'bold';
          } else if (cell.target === 'normal') {
            bg = 'rgba(16, 185, 129, 0.15)';
            color = '#10b981';
            content = '●';
            fontSize = '10px';
          } else if (cell.target === 'slide') {
            bg = 'rgba(6, 182, 212, 0.15)';
            color = '#0891b2';
            content = getSlideArrow(cell.dx, cell.dy);
            fontSize = '10px';
            fontWeight = 'bold';
          } else if (cell.target === 'jump') {
            bg = 'rgba(139, 92, 246, 0.15)';
            color = '#7c3aed';
            content = '✦';
            fontSize = '10px';
            fontWeight = 'bold';
          }

          return (
            <div
              key={index}
              style={{
                width: '16px',
                height: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: bg,
                color,
                borderRadius: cell.target === 'center' ? '4px' : '2px',
                fontSize,
                fontWeight,
                border: '1px solid rgba(0,0,0,0.03)',
                boxSizing: 'border-box',
                transition: 'all 0.2s ease',
              }}
              title={cell.target ? `${cell.target} (dx:${cell.dx}, dy:${cell.dy})` : undefined}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
};
