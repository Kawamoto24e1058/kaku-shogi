import React, { useEffect, useState } from 'react';

interface Petal {
  id: number;
  left: number; // percentage (0 - 100)
  size: number; // width in pixels
  duration: number; // seconds
  delay: number; // negative start offset
  swayDelay: number; // seconds
}

export const SakuraShower: React.FC = () => {
  const [petals, setPetals] = useState<Petal[]>([]);

  useEffect(() => {
    // Generate 18 scattered petals
    const newPetals: Petal[] = Array.from({ length: 18 }).map((_, idx) => ({
      id: idx,
      left: Math.random() * 100,
      size: Math.random() * 8 + 6, // 6px to 14px
      duration: Math.random() * 7 + 8, // slow, gentle fall (8s to 15s)
      delay: Math.random() * -15, // scattered instantly
      swayDelay: Math.random() * 5,
    }));
    setPetals(newPetals);
  }, []);

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {petals.map(p => (
        <div
          key={p.id}
          className="sakura-petal"
          style={{
            position: 'absolute',
            top: '-5%',
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.7}px`,
            backgroundColor: '#FFD3E2', // Pale cherry blossom pink
            borderRadius: '50% 0% 50% 50%',
            opacity: 0.75,
            animation: `sakura-fall ${p.duration}s linear infinite, sakura-sway 4s ease-in-out infinite`,
            animationDelay: `${p.delay}s, ${p.swayDelay}s`,
            transformOrigin: 'center center',
          }}
        />
      ))}
    </div>
  );
};
