import React from 'react';

interface RangeGridProps {
  gridStr: string; // 25 characters of '0', '1', '2'
  size?: number; // total pixel size
}

export const RangeGrid: React.FC<RangeGridProps> = ({ gridStr, size = 50 }) => {
  const chars = gridStr.split('');
  if (chars.length !== 25) {
    return <div style={{ fontSize: '9px', color: 'var(--neon-purple)' }}>[無効な範囲幾何]</div>;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: '1.5px',
      width: `${size}px`,
      height: `${size}px`,
      background: 'rgba(0, 0, 0, 0.6)',
      padding: '2.5px',
      border: '1.2px solid rgba(219, 188, 98, 0.25)',
      borderRadius: '3px',
      boxShadow: 'inset 0 0 5px rgba(0,0,0,0.8)'
    }}>
      {chars.map((char, index) => {
        let bg = 'rgba(255, 255, 255, 0.04)';
        let border = '0.5px solid rgba(255, 255, 255, 0.02)';
        let shadow = '';

        if (char === '2') {
          // Self
          bg = 'var(--neon-yellow)';
          border = '0.8px solid rgba(219, 188, 98, 0.8)';
          shadow = '0 0 5px rgba(219, 188, 98, 0.6)';
        } else if (char === '1') {
          // Range target
          bg = 'var(--neon-cyan)';
          border = '0.8px solid rgba(86, 166, 191, 0.8)';
          shadow = '0 0 4px rgba(86, 166, 191, 0.6)';
        }

        return (
          <div
            key={index}
            style={{
              background: bg,
              border: border,
              borderRadius: '1.5px',
              boxShadow: shadow,
            }}
          />
        );
      })}
    </div>
  );
};
