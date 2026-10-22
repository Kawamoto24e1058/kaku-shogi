import React from 'react';
import type { Piece } from '../types';
import { describeAbility } from '../../shared/abilityProgram';

/** 能力プログラム（v2）の駒の能力一覧。能力ごとに説明と充填中かどうかを出す */
export const ProgramAbilityList: React.FC<{ piece: Piece }> = ({ piece }) => {
  const abilities = piece.abilities ?? [];
  if (abilities.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
