import React from 'react';
import type { Piece, Player } from '../types';
import { RangeGrid } from './RangeGrid';
import { ProgramAbilityList } from './ProgramAbilityList';
import { MOVE_STYLE_SPECS, type MoveStyle } from '../../shared/moveStyles';

/** 相手の駒の能力・性質を見せてよいか（一度使った能力・自分の駒・1台で交代に指すときは見える） */
export function canSeeDetails(piece: Piece, viewer: Player | null): boolean {
  if (!viewer || piece.owner === viewer) return true;
  return !!piece.abilityRevealed;
}

/**
 * 対局中の駒の情報（短く）。名前・動ける範囲・能力の3つだけ。
 * 相手の駒は、能力を一度使うまで中身を見せない（動ける範囲は将棋と同じく見える）
 */
export const PieceInfo: React.FC<{ piece: Piece; viewer: Player | null }> = ({ piece, viewer }) => {
  const mine = !viewer || piece.owner === viewer;
  const visible = canSeeDetails(piece, viewer);
  const grid = (piece.isPromoted && piece.range_geometry?.promoted_grid) || piece.range_geometry?.normal_grid;
  const style = piece.move_style && piece.move_style in MOVE_STYLE_SPECS ? MOVE_STYLE_SPECS[piece.move_style as MoveStyle].label : null;
  const hasProgram = !!piece.abilities?.length || !!piece.trait || !!piece.move_extra;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {grid && <RangeGrid gridStr={grid.replace(/\//g, '')} size={52} />}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 900, color: '#1a1a1a', lineHeight: 1.2 }}>
            {piece.word}
            {piece.isPromoted && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#9e2a2b' }}>成</span>}
          </div>
          <div style={{ fontSize: '11px', fontWeight: 700, color: mine ? '#9e2a2b' : '#57534e' }}>
            {viewer ? (mine ? '自分の駒' : '相手の駒') : piece.owner === 'sente' ? '先手の駒' : '後手の駒'}
            {style && <span style={{ color: '#78716c', fontWeight: 600 }}>・{style}</span>}
          </div>
        </div>
      </div>
      {hasProgram && visible && <ProgramAbilityList piece={piece} />}
      {hasProgram && !visible && (
        <div style={{ fontSize: '12px', lineHeight: 1.6, color: '#57534e', background: 'rgba(120, 113, 108, 0.08)', borderRadius: '10px', padding: '8px 10px' }}>
          能力は、まだ分からない（一度使われると見えます）
        </div>
      )}
      {!hasProgram && piece.description && (
        <div style={{ fontSize: '12px', lineHeight: 1.6, color: '#3f3a33' }}>{piece.description}</div>
      )}
    </div>
  );
};
