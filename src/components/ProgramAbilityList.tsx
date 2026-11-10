import React from 'react';
import type { Piece } from '../types';
import { describeAbility, describeTrait, TRAIT_SPECS } from '../../shared/abilityProgram';

/** 性質の今の状態（寿命の残り・鈍足の休み・不死身を使ったか・成長の段階） */
function traitStatus(piece: Piece): { text: string; color: string } {
  const kind = piece.trait?.kind;
  if (kind === 'LIFESPAN') return { text: `残り${piece.traitLife ?? piece.trait?.value ?? TRAIT_SPECS.LIFESPAN.value![2]}手番`, color: '#b45309' };
  if (kind === 'SLOW' && (piece.traitRest ?? 0) > 0) return { text: '休み中', color: '#7c3aed' };
  if (kind === 'UNDYING' || kind === 'SPLIT' || kind === 'REFLECT') return piece.traitUsed ? { text: '使用済み', color: '#9ca3af' } : { text: 'あと1回', color: '#059669' };
  if (kind === 'INVISIBLE' && piece.isStealth) return { text: '姿を消している', color: '#7c3aed' };
  if (kind === 'GROWTH') return { text: `成長${piece.traitLevel ?? 0}/2`, color: '#059669' };
  return { text: 'ずっと', color: '#6b7280' };
}

/** 能力プログラム（v2）の駒の能力一覧。性質を先頭に、能力ごとに説明と充填中かどうかを出す */
export const ProgramAbilityList: React.FC<{ piece: Piece }> = ({ piece }) => {
  const abilities = piece.abilities ?? [];
  if (abilities.length === 0 && !piece.trait) return null;
  const status = piece.trait ? traitStatus(piece) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {piece.trait && status && (
        <div style={{ borderRadius: '10px', border: '1px solid rgba(180, 83, 9, 0.3)', background: 'rgba(255, 247, 237, 0.95)', padding: '8px 10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
            <span style={{ fontWeight: 800, fontSize: '13px', color: '#1a1a1a' }}>
              <span style={{ fontSize: '10px', color: '#b45309', marginRight: '6px' }}>性質</span>{TRAIT_SPECS[piece.trait.kind].label}
            </span>
            <span style={{ fontSize: '10px', fontWeight: 700, color: status.color, whiteSpace: 'nowrap' }}>{status.text}</span>
          </div>
          <div style={{ fontSize: '12px', lineHeight: 1.6, color: '#3f3a33' }}>{describeTrait(piece.trait).replace(/^【[^】]*】/, '')}</div>
        </div>
      )}
      {abilities.map((a, i) => {
        const cd = piece.abilityCooldowns?.[i] ?? 0;
        const status = cd >= 99 ? '使用済み' : cd > 0 ? `充填中 あと${cd}手番` : '使える';
        const statusColor = cd >= 99 ? '#9ca3af' : cd > 0 ? '#7c3aed' : '#059669';
        // 説明文の先頭の【能力名】は見出しと重なるので外す
        const text = describeAbility(a).replace(/^【[^】]*】/, '');
        return (
          <div key={i} style={{
            borderRadius: '10px',
            border: '1px solid rgba(139, 92, 26, 0.15)',
            background: 'rgba(255, 253, 249, 0.9)',
            padding: '8px 10px',
            opacity: cd >= 99 ? 0.6 : 1,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
              <span style={{ fontWeight: 800, fontSize: '13px', color: '#1a1a1a' }}>{a.name}</span>
              <span style={{ fontSize: '10px', fontWeight: 700, color: statusColor, whiteSpace: 'nowrap' }}>{status}</span>
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.6, color: '#3f3a33' }}>{text}</div>
          </div>
        );
      })}
    </div>
  );
};
