import React from 'react';
import type { Piece } from '../types';
import { RangeGrid } from './RangeGrid';

interface PieceDetailCardProps {
  piece: Partial<Piece>;
  isHoverPreview?: boolean;
}

export const PieceDetailCard: React.FC<PieceDetailCardProps> = ({ piece, isHoverPreview = false }) => {
  if (!piece) return null;

  const themeStyles: Record<string, {
    backgroundColor: string;
    border: string;
    boxShadow: string;
    badge: string;
    badgeColor: string;
    barColor: string;
    textColor: string;
    subTextColor: string;
    boxBg: string;
    boxBorder: string;
    accentColor?: string;
  }> = {
    WARRIOR_IRON: {
      backgroundColor: '#E8E1D5', // Rusted clay/weathered paper
      border: '1.5px solid #8A725D', // Darker clay border
      boxShadow: '0 8px 30px rgba(0, 0, 0, 0.55), inset 0 0 30px rgba(158, 42, 43, 0.04)',
      badge: '【武家鉄鉱】',
      badgeColor: 'var(--color-shinku)',
      barColor: 'var(--color-shinku)',
      textColor: 'var(--color-kurogane)',
      subTextColor: '#5A524A',
      boxBg: 'rgba(158, 42, 43, 0.03)',
      boxBorder: 'rgba(130, 110, 89, 0.2)'
    },
    MYSTIC_MIST: {
      backgroundColor: '#ECE7F0', // Soft purple mist
      border: '1.5px solid var(--color-murasaki)',
      boxShadow: '0 8px 30px rgba(74, 21, 75, 0.15)',
      badge: '【幽冥神秘】',
      badgeColor: 'var(--color-murasaki)',
      barColor: 'var(--color-murasaki)',
      textColor: '#2E2230',
      subTextColor: '#5B4E60',
      boxBg: 'rgba(74, 21, 75, 0.03)',
      boxBorder: 'rgba(74, 21, 75, 0.15)'
    },
    SHADOW_NIGHT: {
      backgroundColor: '#242424', // Pitch black / deep night charcoal
      border: '1.5px solid #141414',
      boxShadow: '0 10px 35px rgba(0, 0, 0, 0.75)',
      badge: '【影身黒夜】',
      badgeColor: 'var(--color-gold)',
      barColor: '#E0E0E0',
      textColor: '#E0E0E0',
      subTextColor: '#A0A0A0',
      boxBg: 'rgba(255, 255, 255, 0.05)',
      boxBorder: 'rgba(255, 255, 255, 0.1)',
      accentColor: 'var(--color-gold)'
    },
    NATURE_STONE: {
      backgroundColor: '#E5E5DA', // Moss-stone green
      border: '1.5px solid var(--color-matsuba)',
      boxShadow: '0 8px 30px rgba(47, 82, 51, 0.15)',
      badge: '【山河自然】',
      badgeColor: 'var(--color-matsuba)',
      barColor: 'var(--color-matsuba)',
      textColor: '#222A23',
      subTextColor: '#525B53',
      boxBg: 'rgba(47, 82, 51, 0.03)',
      boxBorder: 'rgba(47, 82, 51, 0.15)'
    }
  };

  const theme = piece.visual_theme && themeStyles[piece.visual_theme] ? themeStyles[piece.visual_theme] : null;

  // Resolve layout style variables
  const bg = theme ? theme.backgroundColor : 'var(--color-washi)';
  const borderStyle = theme ? theme.border : '1px solid rgba(130, 110, 89, 0.25)';
  const shadow = theme ? theme.boxShadow : '0 8px 30px rgba(0, 0, 0, 0.5)';
  const text = theme ? theme.textColor : 'var(--color-kurogane)';
  const subText = theme ? theme.subTextColor : '#555555';
  const boxBg = theme ? theme.boxBg : 'rgba(26, 26, 26, 0.05)';
  const boxBorder = theme ? theme.boxBorder : 'rgba(130, 110, 89, 0.12)';
  const barColor = theme ? theme.barColor : (piece.owner === 'gote' ? 'var(--color-kurogane)' : 'var(--color-shinku)');

  return (
    <div 
      className="cyber-panel" 
      style={{
        width: '100%',
        backgroundColor: bg,
        border: borderStyle,
        borderRadius: '2px',
        padding: '20px',
        boxShadow: shadow,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'var(--font-cyber)',
        boxSizing: 'border-box',
        transition: 'all 0.3s ease'
      }}
    >
      {/* Camp Marker Line */}
      <div 
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '3px', 
          backgroundColor: barColor
        }} 
      />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '22px', color: text, fontWeight: 'bold', letterSpacing: '0.05em', margin: 0, fontFamily: 'var(--font-cyber)' }}>
            {piece.isHisha && piece.isPromoted ? '竜王' : (piece.isKaku && piece.isPromoted ? '竜馬' : (piece.isPawn && piece.isPromoted ? 'と金' : piece.word))}
          </h3>
          {theme && (
            <span style={{ 
              fontSize: '9px', 
              color: theme.badgeColor, 
              fontWeight: 'bold', 
              fontFamily: 'var(--font-cyber)',
              border: `1px solid ${theme.badgeColor}`,
              borderRadius: '2px',
              padding: '1px 4px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              lineHeight: 1
            }}>
              {theme.badge}
            </span>
          )}
          <span style={{ fontSize: '11px', color: subText }}>
            【{piece.effect_name || '通常能力'}】
          </span>
        </div>
        {isHoverPreview ? (
          <span style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            backgroundColor: boxBg,
            color: text,
            padding: '2px 6px',
            borderRadius: '2px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            border: `1px solid ${boxBorder}`
          }}>
            プレビュー
          </span>
        ) : (
          <span style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            backgroundColor: boxBg,
            color: text,
            padding: '2px 6px',
            borderRadius: '2px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            border: `1px solid ${boxBorder}`
          }}>
            {piece.trigger === 'ON_MOVE' ? '移動時自動発動' : piece.trigger === 'TURN_START' ? '自ターン開始時発動' : piece.trigger === 'ON_TAKEN' ? '被捕獲時（罠）' : piece.trigger === 'ON_APPROACH' ? '敵接近時（罠）' : '常時パッシブ'}
          </span>
        )}
      </div>

      {/* Stats Tiling Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        borderTop: `1px solid ${boxBorder}`,
        borderBottom: `1px solid ${boxBorder}`,
        paddingTop: '10px',
        paddingBottom: '10px',
        marginBottom: '16px',
        fontFamily: 'monospace',
        fontSize: '12px',
        textAlign: 'center',
        backgroundColor: boxBg
      }}>
        <div style={{ borderRight: `1px solid ${boxBorder}` }}>
          <span style={{ color: subText, display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【属性】</span>
          <span style={{ color: theme?.badgeColor || 'var(--color-shinku)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.ability_genre || (piece.mechanics_type === 'MOVEMENT_HACK' ? '変則移動' : piece.mechanics_type === 'STEALTH_TRAP' ? '正体隠蔽' : piece.mechanics_type === 'RULE_BREAK' ? '環境ハック' : piece.mechanics_type === 'DYNAMICS_HACK' ? 'ルール破壊' : '通常駒')}
          </span>
        </div>
        <div style={{ borderRight: `1px solid ${boxBorder}` }}>
          <span style={{ color: subText, display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【発動条件】</span>
          <span style={{ color: text, fontWeight: 'bold', fontSize: '11px' }}>
            {piece.trigger === 'ALWAYS' ? '常時発動' : piece.trigger === 'ON_MOVE' ? '移動完了時' : piece.trigger === 'TURN_START' ? 'ターン開始時' : piece.trigger === 'ON_TAKEN' ? '被捕獲時' : piece.trigger === 'ON_APPROACH' ? '敵接近時' : '常時発動'}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ color: subText, display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【充填手番】</span>
          <span style={{ color: 'var(--color-murasaki)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.cool_down_turns !== undefined ? `${piece.cool_down_turns}手番` : '0手番'}
            {piece.coolDownTurnsRemaining !== undefined && piece.coolDownTurnsRemaining > 0 && ` (残${piece.coolDownTurnsRemaining})`}
          </span>
        </div>
      </div>

      {/* Description Text Box */}
      <div style={{
        fontSize: '12px',
        color: text,
        lineHeight: '1.6',
        marginBottom: '16px',
        textAlign: 'justify',
        backgroundColor: boxBg,
        padding: '12px',
        borderRadius: '2px',
        border: `1px solid ${boxBorder}`
      }}>
        {piece.description}
      </div>

      {/* Range Geometry Mini Maps */}
      {piece.range_geometry && (
        <div style={{
          display: 'flex',
          gap: '12px',
          background: boxBg,
          padding: '8px',
          borderRadius: '2px',
          border: `1px solid ${boxBorder}`,
          marginBottom: '16px',
          justifyContent: 'center'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '8px', color: 'var(--color-shinku)', fontFamily: 'var(--font-cyber)' }}>通常移動範囲</span>
            <RangeGrid gridStr={piece.range_geometry.normal_grid} size={36} />
          </div>
          {piece.range_geometry.charging_grid && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '8px', color: 'var(--color-murasaki)', fontFamily: 'var(--font-cyber)' }}>充填中（十字移動）</span>
              <RangeGrid gridStr={piece.range_geometry.charging_grid} size={36} />
            </div>
          )}
          {piece.isPromoted && piece.range_geometry.promoted_grid && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '8px', color: 'var(--color-gold)', fontFamily: 'var(--font-cyber)' }}>成（覚醒）移動</span>
              <RangeGrid gridStr={piece.range_geometry.promoted_grid} size={36} />
            </div>
          )}
        </div>
      )}

      {/* Promoted Effect */}
      {piece.promoted_effect && (
        <div style={{
          paddingLeft: '10px',
          borderLeft: '2px solid var(--color-gold)',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--color-gold)', fontWeight: 'bold', marginBottom: '2px' }}>
            【覚醒効果：{piece.promoted_effect.effect_name}】
          </div>
          <p style={{ fontSize: '11px', color: subText, lineHeight: '1.5', margin: 0 }}>
            {piece.promoted_effect.description}
          </p>
        </div>
      )}

      {/* Deep Search Analysis */}
      {piece.deep_search_analysis && (
        <div style={{
          borderTop: `1px solid ${boxBorder}`,
          paddingTop: '10px',
          fontSize: '10px',
          color: subText,
          lineHeight: '1.4',
          fontFamily: 'var(--font-ui)'
        }}>
          <span style={{ fontFamily: 'var(--font-cyber)', fontWeight: 'bold', color: text }}>本質解析：</span>
          {piece.deep_search_analysis}
        </div>
      )}
    </div>
  );
};
