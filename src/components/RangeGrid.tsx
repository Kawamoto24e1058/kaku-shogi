import React from 'react';

interface RangeGridProps {
  gridStr: string; // 25 characters of '0', '1', '2'
  size?: number; // total pixel size
}

export const RangeGrid: React.FC<RangeGridProps> = ({ gridStr, size = 50 }) => {
  const chars = gridStr.split('');
  if (chars.length !== 25) {
    return <div style={{ fontSize: '9px', color: 'var(--color-murasaki)' }}>[無効な範囲幾何]</div>;
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: '1.5px',
      width: `${size}px`,
      height: `${size}px`,
      background: 'rgba(26, 26, 26, 0.4)',
      padding: '2.5px',
      border: '1px solid rgba(130, 110, 89, 0.25)',
      borderRadius: '2px',
    }}>
      {chars.map((char, index) => {
        let bg = 'rgba(255, 255, 255, 0.04)';
        let border = '0.5px solid rgba(255, 255, 255, 0.02)';

        if (char === '2') {
          // Self
          bg = 'var(--color-gold)';
          border = 'none';
        } else if (char === '1') {
          // Range target
          bg = 'var(--color-shinku)';
          border = 'none';
        }

        return (
          <div
            key={index}
            style={{
              background: bg,
              border: border,
              borderRadius: '1px',
            }}
          />
        );
      })}
    </div>
  );
};
