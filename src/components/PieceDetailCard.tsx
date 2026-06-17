import React from 'react';
import type { Piece } from '../types';
import { RangeGrid } from './RangeGrid';

interface PieceDetailCardProps {
  piece: Partial<Piece>;
  isHoverPreview?: boolean;
}

export const PieceDetailCard: React.FC<PieceDetailCardProps> = ({ piece, isHoverPreview = false }) => {
  if (!piece) return null;

  const isCustom = !piece.isKing && !piece.isPawn && !piece.isHisha && !piece.isKaku;

  return (
    <div 
      className="cyber-panel" 
      style={{
        width: '100%',
        backgroundColor: '#24221f',
        border: isCustom ? '1px solid var(--shogi-wood)' : '1px solid rgba(219, 188, 98, 0.15)',
        borderRadius: '2px',
        padding: '20px',
        boxShadow: isCustom ? '0 0 15px rgba(230, 208, 175, 0.25), 0 10px 30px rgba(0, 0, 0, 0.6)' : '0 10px 30px rgba(0, 0, 0, 0.6)',
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
          backgroundColor: piece.owner === 'gote' ? 'var(--shogi-gote)' : 'var(--shogi-sente)' 
        }} 
      />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <h3 style={{ fontSize: '22px', color: 'var(--shogi-wood)', fontWeight: 'bold', letterSpacing: '0.05em', margin: 0, fontFamily: 'var(--font-cyber)' }}>
            {piece.isHisha && piece.isPromoted ? '竜王' : (piece.isKaku && piece.isPromoted ? '竜馬' : (piece.isPawn && piece.isPromoted ? 'と金' : piece.word))}
          </h3>
          <span style={{ fontSize: '11px', color: '#a1a1aa' }}>
            【{piece.effect_name || '通常能力'}】
          </span>
        </div>
        {isHoverPreview ? (
          <span style={{
            fontSize: '9px',
            fontFamily: 'monospace',
            backgroundColor: '#141311',
            color: '#71717a',
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
            backgroundColor: '#141311',
            color: '#71717a',
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
        borderTop: '1px solid rgba(219, 188, 98, 0.15)',
        borderBottom: '1px solid rgba(219, 188, 98, 0.15)',
        paddingTop: '10px',
        paddingBottom: '10px',
        marginBottom: '16px',
        fontFamily: 'monospace',
        fontSize: '12px',
        textAlign: 'center',
        backgroundColor: 'rgba(20, 19, 17, 0.5)'
      }}>
        <div style={{ borderRight: '1px solid rgba(219, 188, 98, 0.09)' }}>
          <span style={{ color: '#71717a', display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【属性】</span>
          <span style={{ color: 'var(--shogi-sente)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.ability_genre || (piece.mechanics_type === 'MOVEMENT_HACK' ? '変則移動' : piece.mechanics_type === 'STEALTH_TRAP' ? '正体隠蔽' : piece.mechanics_type === 'RULE_BREAK' ? '環境ハック' : piece.mechanics_type === 'DYNAMICS_HACK' ? 'ルール破壊' : '通常駒')}
          </span>
        </div>
        <div style={{ borderRight: '1px solid rgba(219, 188, 98, 0.09)' }}>
          <span style={{ color: '#71717a', display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【発動条件】</span>
          <span style={{ color: 'var(--shogi-wood)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.trigger === 'ALWAYS' ? '常時発動' : piece.trigger === 'ON_MOVE' ? '移動完了時' : piece.trigger === 'TURN_START' ? 'ターン開始時' : piece.trigger === 'ON_TAKEN' ? '被捕獲時' : piece.trigger === 'ON_APPROACH' ? '敵接近時' : '常時発動'}
          </span>
        </div>
        <div style={{ minWidth: 0 }}>
          <span style={{ color: '#71717a', display: 'block', fontSize: '9px', fontFamily: 'var(--font-cyber)', marginBottom: '2px' }}>【充填手番】</span>
          <span style={{ color: 'var(--neon-pink)', fontWeight: 'bold', fontSize: '11px' }}>
            {piece.cool_down_turns !== undefined ? `${piece.cool_down_turns}手番` : '0手番'}
            {piece.coolDownTurnsRemaining !== undefined && piece.coolDownTurnsRemaining > 0 && ` (残${piece.coolDownTurnsRemaining})`}
          </span>
        </div>
      </div>

      {/* Description Text Box */}
      <div style={{
        fontSize: '12px',
        color: '#e4e4e7',
        lineHeight: '1.6',
        marginBottom: '16px',
        textAlign: 'justify',
        backgroundColor: '#141311',
        padding: '12px',
        borderRadius: '2px',
        border: '1px solid rgba(219, 188, 98, 0.06)'
      }}>
        {piece.description}
      </div>

      {/* Range Geometry Mini Maps */}
      {piece.range_geometry && (
        <div style={{
          display: 'flex',
          gap: '12px',
          background: 'rgba(0,0,0,0.25)',
          padding: '8px',
          borderRadius: '2px',
          border: '1px solid rgba(255,255,255,0.02)',
          marginBottom: '16px',
          justifyContent: 'center'
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '8px', color: 'var(--neon-cyan)', fontFamily: 'var(--font-cyber)' }}>通常移動範囲</span>
            <RangeGrid gridStr={piece.range_geometry.normal_grid} size={36} />
          </div>
          {piece.range_geometry.charging_grid && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '8px', color: 'var(--neon-pink)', fontFamily: 'var(--font-cyber)' }}>充填中（十字移動）</span>
              <RangeGrid gridStr={piece.range_geometry.charging_grid} size={36} />
            </div>
          )}
          {piece.isPromoted && piece.range_geometry.promoted_grid && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '8px', color: 'var(--neon-yellow)', fontFamily: 'var(--font-cyber)' }}>成（覚醒）移動</span>
              <RangeGrid gridStr={piece.range_geometry.promoted_grid} size={36} />
            </div>
          )}
        </div>
      )}

      {/* Ultimate Effect */}


      {/* Promoted Effect */}
      {piece.promoted_effect && (
        <div style={{
          paddingLeft: '10px',
          borderLeft: '2px solid var(--neon-yellow)',
          marginBottom: '16px'
        }}>
          <div style={{ fontSize: '11px', color: 'var(--neon-yellow)', fontWeight: 'bold', marginBottom: '2px' }}>
            【覚醒効果：{piece.promoted_effect.effect_name}】
          </div>
          <p style={{ fontSize: '11px', color: '#a1a1aa', lineHeight: '1.5', margin: 0 }}>
            {piece.promoted_effect.description}
          </p>
        </div>
      )}

      {/* Deep Search Analysis */}
      {piece.deep_search_analysis && (
        <div style={{
          borderTop: '1px solid rgba(219, 188, 98, 0.1)',
          paddingTop: '10px',
          fontSize: '10px',
          color: '#71717a',
          lineHeight: '1.4',
          fontFamily: 'var(--font-ui)'
        }}>
          <span style={{ fontFamily: 'var(--font-cyber)', fontWeight: 'bold', color: '#a1a1aa' }}>本質解析：</span>
          {piece.deep_search_analysis}
        </div>
      )}
    </div>
  );
};
