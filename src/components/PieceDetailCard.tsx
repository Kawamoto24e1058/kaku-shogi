import React from 'react';
import type { Piece } from '../types';
import { RangeGrid } from './RangeGrid';

interface PieceDetailCardProps {
  piece: Partial<Piece>;
  isHoverPreview?: boolean;
}

export const PieceDetailCard: React.FC<PieceDetailCardProps> = ({ piece, isHoverPreview = false }) => {
  if (!piece) return null;

  return (
    <div 
      className="cyber-panel" 
      style={{
        width: '100%',
        backgroundColor: 'var(--color-washi)',
        border: '1px solid rgba(130, 110, 89, 0.25)',
        borderRadius: '2px',
        padding: '20px',
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5)',
        position: 'relative',
        overflow: 'hidden',
        fontFamily: 'var(--font-cyber)',
        boxSizing: 'border-box',
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
          backgroundColor: piece.owner === 'gote' ? 'var(--color-kurogane)' : 'var(--color-shinku)' 
        }} 
      />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <h3 style={{ fontSize: '22px', color: 'var(--color-kurogane)', fontWeight: 'bold', letterSpacing: '0.05em', margin: 0, fontFamily: 'var(--font-cyber)' }}>
            {piece.isHisha && piece.isPromoted ? '竜王' : (piece.isKaku && piece.isPromoted ? '竜馬' : (piece.isPawn && piece.isPromoted ? 'と金' : piece.word))}
          </h3>
          <span style={{ fontSize: '11px', color: '#555555' }}>
            【{piece.effect_name || '通常能力'}】
          </span>
        </div>
        {isHoverPreview ? (
          <span style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            backgroundColor: 'rgba(26, 26, 26, 0.05)',
            color: 'var(--color-kurogane)',
            padding: '2px 6px',
            borderRadius: '2px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            プレビュー
          </span>
        ) : (
          <span style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            backgroundColor: 'rgba(26, 26, 26, 0.05)',
            color: 'var(--color-kurogane)',
            padding: '2px 6px',
            borderRadius: '2px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
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
        borderTop: '1px solid rgba(130, 110, 89, 0.2)',
        borderBottom: '1px solid rgba(130, 110, 89, 0.2)',
        paddingTop: '10px',
        paddingBottom: '10px',
        marginBottom: '16px',
        fontFamily: 'monospace',
        fontSize: '12px',
        textAlign: 'center',
        backgroundColor: 'rgba(26, 26, 26, 0.03)'
      }}>
        <div style={{ borderRight: '1px solid rgba(130, 110, 89, 0.15)' }}>
          <span style={{ color: '#666666', display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【属性】</span>
          <span style={{ color: 'var(--color-shinku)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.ability_genre || (piece.mechanics_type === 'MOVEMENT_HACK' ? '変則移動' : piece.mechanics_type === 'STEALTH_TRAP' ? '正体隠蔽' : piece.mechanics_type === 'RULE_BREAK' ? '環境ハック' : piece.mechanics_type === 'DYNAMICS_HACK' ? 'ルール破壊' : '通常駒')}
          </span>
        </div>
        <div style={{ borderRight: '1px solid rgba(130, 110, 89, 0.15)' }}>
          <span style={{ color: '#666666', display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【発動条件】</span>
          <span style={{ color: 'var(--color-kurogane)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.trigger === 'ALWAYS' ? '常時発動' : piece.trigger === 'ON_MOVE' ? '移動完了時' : piece.trigger === 'TURN_START' ? 'ターン開始時' : piece.trigger === 'ON_TAKEN' ? '被捕獲時' : piece.trigger === 'ON_APPROACH' ? '敵接近時' : '常時発動'}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ color: '#666666', display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【充填手番】</span>
          <span style={{ color: 'var(--color-murasaki)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.cool_down_turns !== undefined ? `${piece.cool_down_turns}手番` : '0手番'}
            {piece.coolDownTurnsRemaining !== undefined && piece.coolDownTurnsRemaining > 0 && ` (残${piece.coolDownTurnsRemaining})`}
          </span>
        </div>
      </div>

      {/* Description Text Box */}
      <div style={{
        fontSize: '12px',
        color: 'var(--color-kurogane)',
        lineHeight: '1.6',
        marginBottom: '16px',
        textAlign: 'justify',
        backgroundColor: 'rgba(26, 26, 26, 0.05)',
        padding: '12px',
        borderRadius: '2px',
        border: '1px solid rgba(130, 110, 89, 0.12)'
      }}>
        {piece.description}
      </div>

      {/* Range Geometry Mini Maps */}
      {piece.range_geometry && (
        <div style={{
          display: 'flex',
          gap: '12px',
          background: 'rgba(26, 26, 26, 0.03)',
          padding: '8px',
          borderRadius: '2px',
          border: '1px solid rgba(130, 110, 89, 0.1)',
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
          <p style={{ fontSize: '11px', color: '#555555', lineHeight: '1.5', margin: 0 }}>
            {piece.promoted_effect.description}
          </p>
        </div>
      )}

      {/* Deep Search Analysis */}
      {piece.deep_search_analysis && (
        <div style={{
          borderTop: '1px solid rgba(130, 110, 89, 0.15)',
          paddingTop: '10px',
          fontSize: '10px',
          color: '#666666',
          lineHeight: '1.4',
          fontFamily: 'var(--font-ui)'
        }}>
          <span style={{ fontFamily: 'var(--font-cyber)', fontWeight: 'bold', color: 'var(--color-kurogane)' }}>本質解析：</span>
          {piece.deep_search_analysis}
        </div>
      )}
    </div>
  );
};
