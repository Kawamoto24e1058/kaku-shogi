import React from 'react';
import type { Piece } from '../types';
import { MoveDiagram } from './MoveDiagram';

interface AbilityTooltipProps {
  piece: Piece | null;
  visible: boolean;
  isViewerOpponent?: boolean;
}

// ─── バッジ日本語マッピング ────────────────────────────────────────────────
const TRIGGER_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  ON_MOVE:    { label: '移動時',         color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)' },
  TURN_START: { label: 'ターン開始',     color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
  ON_TAKEN:   { label: '被捕獲時',       color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  ON_APPROACH:{ label: '敵接近時',       color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  ALWAYS:     { label: '常時パッシブ',   color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  COOLDOWN_1: { label: '充填1手',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  COOLDOWN_2: { label: '充填2手',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  COOLDOWN_3: { label: '充填3手',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  COOLDOWN_4: { label: '充填4手',        color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  ONCE_PER_GAME:{ label: '1回限り',      color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
};

const TARGET_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  LINE_STRAIGHT: { label: '縦列全体',    color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  SQUARE_3X3:    { label: '3×3範囲',     color: '#ec4899', bg: 'rgba(236,72,153,0.12)' },
  SQUARE_5X5:    { label: '5×5範囲',     color: '#db2777', bg: 'rgba(219,39,119,0.12)' },
  CROSS:         { label: '十字範囲',    color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  POINT:         { label: '単体',         color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  SELF:          { label: '自身',         color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  ALL_BOARD:     { label: '全盤面',       color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' },
};

const ACTION_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  DESTROY:        { label: '破壊',           color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  FREEZE:         { label: '凍結',           color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  KNOCKBACK:      { label: '吹き飛ばし',     color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  KNOCKBACK_MAX:  { label: '極大吹き飛ばし', color: '#ea580c', bg: 'rgba(234,88,12,0.12)' },
  SWAP_POSITION:  { label: '位置交換',       color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
  PULL_1:         { label: '引き寄せ',       color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  RE_ACTION:      { label: '再行動',         color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  AUTO_FOLLOW_UP: { label: '自動追撃',       color: '#dc2626', bg: 'rgba(220,38,38,0.12)' },
  STUN:           { label: '行動封印',       color: '#6366f1', bg: 'rgba(99,102,241,0.12)' },
  DAMAGE:         { label: 'ダメージ',       color: '#f43f5e', bg: 'rgba(244,63,94,0.12)' },
};

const CONSTRAINT_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  SKIP_ALLY:    { label: '味方除外',     color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  SKIP_KING:    { label: '王将除外',     color: '#facc15', bg: 'rgba(250,204,21,0.12)' },
  ENEMY_ONLY:   { label: '敵のみ',       color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  ALLY_ONLY:    { label: '味方のみ',     color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  EMPTY_ONLY:   { label: '空きマスのみ', color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

const Badge: React.FC<{ label: string; color: string; bg: string }> = ({ label, color, bg }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 7px',
    borderRadius: '20px',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.03em',
    color,
    backgroundColor: bg,
    border: `1px solid ${color}40`,
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-cyber)',
    lineHeight: '1.5',
  }}>
    {label}
  </span>
);

const resolveBadge = (
  id: string,
  map: Record<string, { label: string; color: string; bg: string }>
): { label: string; color: string; bg: string } =>
  map[id] ?? { label: id, color: '#9ca3af', bg: 'rgba(156,163,175,0.1)' };

export const AbilityTooltip: React.FC<AbilityTooltipProps> = ({ piece, visible, isViewerOpponent = false }) => {
  if (!visible || !piece) return null;

  const ca = piece.custom_ability;
  const isNormalPiece = piece.isKing || piece.isPawn || piece.isHisha || piece.isKaku;

  // 通常駒・カスタム能力なし は非表示（安全ガード）
  if (isNormalPiece || !ca) return null;

  const cdRemaining = piece.coolDownTurnsRemaining;
  const isCharging = cdRemaining > 0 && cdRemaining !== 99;
  const isWeathered = cdRemaining === 99;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        borderRadius: '14px',
        overflow: 'hidden',
        background: 'rgba(255, 253, 249, 0.88)',
        backdropFilter: 'blur(20px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.5)',
        boxShadow:
          '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(139,92,26,0.08), inset 0 1px 0 rgba(255,255,255,0.9)',
        border: '1px solid rgba(212, 175, 55, 0.22)',
        animation: 'tooltipFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        transform: isViewerOpponent ? 'rotate(180deg)' : 'none',
        transition: 'transform 0.6s ease-in-out',
      }}
    >
      {/* ─── Top accent bar ─── */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: '3px',
        background: isWeathered
          ? 'linear-gradient(90deg, #9ca3af, #d1d5db)'
          : isCharging
          ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
          : 'linear-gradient(90deg, #d4af37, #f5d878, #d4af37)',
      }} />

      <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>

        {/* ─── Header: ability_name + status chip ─── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '15px',
              fontWeight: '800',
              color: '#1a1a1a',
              letterSpacing: '0.04em',
              fontFamily: 'var(--font-cyber)',
              lineHeight: 1.2,
              marginBottom: '3px',
            }}>
              {ca.ability_name}
            </div>
            <div style={{
              fontSize: '10px',
              fontFamily: 'var(--font-ui, serif)',
              color: '#6b7280',
              fontStyle: 'italic',
              lineHeight: 1.55,
            }}>
              {ca.flavor_text}
            </div>
          </div>

          {/* Status chip */}
          <div style={{ flexShrink: 0 }}>
            {isWeathered ? (
              <span style={{
                fontSize: '9px', fontWeight: '700',
                color: '#6b7280', background: 'rgba(107,114,128,0.1)',
                border: '1px solid rgba(107,114,128,0.3)',
                borderRadius: '6px', padding: '2px 7px',
                fontFamily: 'var(--font-cyber)',
              }}>風化済</span>
            ) : isCharging ? (
              <span style={{
                fontSize: '9px', fontWeight: '700',
                color: '#7c3aed', background: 'rgba(124,58,237,0.1)',
                border: '1px solid rgba(124,58,237,0.3)',
                borderRadius: '6px', padding: '2px 7px',
                fontFamily: 'var(--font-cyber)',
              }}>⏳ 残{cdRemaining}</span>
            ) : (
              <span style={{
                fontSize: '9px', fontWeight: '700',
                color: '#059669', background: 'rgba(5,150,105,0.1)',
                border: '1px solid rgba(5,150,105,0.3)',
                borderRadius: '6px', padding: '2px 7px',
                fontFamily: 'var(--font-cyber)',
              }}>✓ 発動可</span>
            )}
          </div>
        </div>

        {/* ─── Divider ─── */}
        <div style={{ height: '1px', background: 'rgba(139,92,26,0.1)', margin: '0 -4px' }} />

        {/* ─── Triggers ─── */}
        {ca.triggers && ca.triggers.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{
              fontSize: '8.5px', fontWeight: '700', color: '#b0b8c4',
              fontFamily: 'var(--font-cyber)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              トリガー
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ca.triggers.map((t, i) => <Badge key={i} {...resolveBadge(t, TRIGGER_LABELS)} />)}
            </div>
          </div>
        )}

        {/* ─── Targets ─── */}
        {ca.targets && ca.targets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{
              fontSize: '8.5px', fontWeight: '700', color: '#b0b8c4',
              fontFamily: 'var(--font-cyber)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              ターゲット範囲
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ca.targets.map((t, i) => <Badge key={i} {...resolveBadge(t, TARGET_LABELS)} />)}
            </div>
          </div>
        )}

        {/* ─── Actions ─── */}
        {ca.actions && ca.actions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{
              fontSize: '8.5px', fontWeight: '700', color: '#b0b8c4',
              fontFamily: 'var(--font-cyber)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              アクション
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ca.actions.map((a, i) => <Badge key={i} {...resolveBadge(a, ACTION_LABELS)} />)}
            </div>
          </div>
        )}

        {/* ─── Constraints ─── */}
        {ca.constraints && ca.constraints.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{
              fontSize: '8.5px', fontWeight: '700', color: '#b0b8c4',
              fontFamily: 'var(--font-cyber)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              制約
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ca.constraints.map((c, i) => <Badge key={i} {...resolveBadge(c, CONSTRAINT_LABELS)} />)}
            </div>
          </div>
        )}

        {/* ─── Move Diagram ─── */}
        {((piece.custom_moves && piece.custom_moves.length > 0) || (ca.custom_moves && ca.custom_moves.length > 0)) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '4px' }}>
            <div style={{
              fontSize: '8.5px', fontWeight: '700', color: '#b0b8c4',
              fontFamily: 'var(--font-cyber)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              カスタム移動ベクトル
            </div>
            <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
              <MoveDiagram customMoves={piece.custom_moves || ca.custom_moves} />
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                fontSize: '9px',
                color: '#4b5563',
                fontFamily: 'var(--font-ui, sans-serif)',
                fontWeight: '600'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#10b981', fontSize: '11px' }}>●</span> 通常移動 (dx, dy)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#0891b2', fontSize: '11px' }}>↑</span> 滑走移動 (slide)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ color: '#7c3aed', fontSize: '10px' }}>✦</span> 跳躍移動 (jump)
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
