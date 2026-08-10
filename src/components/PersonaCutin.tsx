import React, { useEffect, useState } from 'react';

export type CutinType = 'AMBUSH' | 'SKILL' | 'AWAKENED' | 'ONEMORE' | 'GAMBLE';

interface PersonaCutinProps {
  type: CutinType | null;
  title?: string;
  subtitle?: string;
  comboHits?: string[];
  gambleResult?: 'SUCCESS' | 'MISS';
  onComplete?: () => void;
}

export const PersonaCutin: React.FC<PersonaCutinProps> = ({
  type,
  title,
  subtitle,
  comboHits = [],
  gambleResult = 'SUCCESS',
  onComplete
}) => {
  const [active, setActive] = useState<boolean>(false);
  const [shatter, setShatter] = useState<boolean>(false);
  const [slotSpinning, setSlotSpinning] = useState<boolean>(false);

  useEffect(() => {
    if (type) {
      setActive(true);
      setShatter(false);

      if (type === 'GAMBLE') {
        setSlotSpinning(true);
        const spinTimer = setTimeout(() => setSlotSpinning(false), 300);
        const endTimer = setTimeout(() => {
          setActive(false);
          onComplete?.();
        }, 800);
        return () => {
          clearTimeout(spinTimer);
          clearTimeout(endTimer);
        };
      } else if (type === 'AMBUSH') {
        const shatterTimer = setTimeout(() => setShatter(true), 250);
        const endTimer = setTimeout(() => {
          setActive(false);
          onComplete?.();
        }, 700);
        return () => {
          clearTimeout(shatterTimer);
          clearTimeout(endTimer);
        };
      } else if (type === 'AWAKENED') {
        const endTimer = setTimeout(() => {
          setActive(false);
          onComplete?.();
        }, 750);
        return () => clearTimeout(endTimer);
      } else if (type === 'ONEMORE') {
        const endTimer = setTimeout(() => {
          setActive(false);
          onComplete?.();
        }, 550);
        return () => clearTimeout(endTimer);
      } else {
        const endTimer = setTimeout(() => {
          setActive(false);
          onComplete?.();
        }, 650);
        return () => clearTimeout(endTimer);
      }
    } else {
      setActive(false);
    }
  }, [type, onComplete]);

  if (!active || !type) return null;

  return (
    <div className="persona-ambush-overlay">
      {/* ─── 1. AMBUSH Cutin (Trap Trigger - Top Banner) ─────────────────── */}
      {type === 'AMBUSH' && (
        <div className="relative w-full flex flex-col items-center justify-start pt-12 md:pt-16 pointer-events-none select-none">
          {/* Compact Slanted Slash Red Band */}
          <div className="w-[120%] h-16 md:h-20 persona-slash-red flex items-center justify-center -rotate-3 z-10 shadow-xl">
            <div className="flex items-center justify-center space-x-4">
              <span className="persona-text-ambush text-3xl md:text-5xl tracking-wider font-black uppercase">
                AMBUSH!
              </span>
              <span className="text-black font-black text-xs md:text-sm tracking-widest bg-yellow-300 px-3 py-1 -skew-x-12 shadow-sm">
                奇襲作動
              </span>
            </div>
          </div>

          {/* Shatter Effect Graphic */}
          {shatter && (
            <div className="absolute top-20 flex items-center justify-center z-20 pointer-events-none animate-ping">
              <div className="w-48 h-48 border-4 border-red-600 rounded-full opacity-75 blur-sm" />
              <div className="w-40 h-40 border-4 border-yellow-400 rotate-45 transform opacity-90" />
            </div>
          )}
        </div>
      )}

      {/* ─── 2. SKILL EXECUTION Cutin (Slim Top Banner - Non-blocking) ───── */}
      {type === 'SKILL' && (
        <div className="relative w-full flex flex-col items-center justify-start pt-10 md:pt-14 pointer-events-none select-none">
          {/* Starburst Geometric Background (Slim) */}
          <div className="absolute top-10 w-48 h-48 border-4 border-cyan-400 rotate-45 opacity-25 animate-pulse" />
          
          {/* Slim Banner Band */}
          <div className="w-[110%] h-12 md:h-14 bg-black/95 border-y-2 border-cyan-400 -rotate-2 flex items-center justify-between px-6 md:px-16 z-10 shadow-xl max-w-5xl">
            <div className="flex items-center space-x-3 truncate">
              <span className="bg-red-600 text-yellow-300 font-black text-xs px-2.5 py-0.5 -skew-x-12 tracking-wider border border-yellow-300 shadow-sm shrink-0">
                SKILL
              </span>
              <span className="text-white font-black text-lg md:text-2xl tracking-wider truncate drop-shadow-sm">
                {title || '【能力発動】'}
              </span>
            </div>
            {subtitle && (
              <span className="text-cyan-300 font-bold text-xs md:text-sm tracking-wider hidden sm:block shrink-0 ml-4">
                {subtitle}
              </span>
            )}
          </div>

          {/* Combo Hits Popups */}
          {comboHits.length > 0 && (
            <div className="flex space-x-2 mt-2 z-20">
              {comboHits.map((hit, idx) => (
                <span
                  key={idx}
                  className="bg-yellow-400 text-black font-black text-xs md:text-sm px-3 py-0.5 border border-black -skew-x-12 shadow-md animate-bounce"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  {hit}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── 3. AWAKENED Cutin (ON_PROMOTE - Top Banner) ─────────────────── */}
      {type === 'AWAKENED' && (
        <div className="relative w-full flex flex-col items-center justify-start pt-10 md:pt-14 pointer-events-none select-none">
          <div className="w-[120%] h-16 md:h-20 bg-gradient-to-r from-blue-900/90 via-black to-yellow-600/90 border-y-2 border-yellow-400 -rotate-3 flex items-center justify-center space-x-4 z-10 shadow-xl">
            <span className="text-yellow-300 font-black text-2xl md:text-4xl tracking-wider uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] -skew-x-12">
              PERSONA AWAKENED!
            </span>
            <span className="text-cyan-300 font-bold text-xs md:text-sm tracking-wider bg-black/80 px-3 py-0.5 border border-cyan-400 -skew-x-12">
              {title ? `【${title} 覚醒】` : '能力開放'}
            </span>
          </div>
        </div>
      )}

      {/* ─── 4. ONEMORE Cutin (Cooldown Recovered - Top Right) ───────────── */}
      {type === 'ONEMORE' && (
        <div className="relative w-full flex items-start justify-end pr-8 pt-12 pointer-events-none select-none">
          <div className="persona-1more-badge text-xl md:text-2xl px-5 py-1.5 tracking-wider font-black uppercase z-10">
            1 MORE! READY!
          </div>
        </div>
      )}

      {/* ─── 5. GAMBLE / CHANCE Cutin (Probability Strike & Casino Slot) ── */}
      {type === 'GAMBLE' && (
        <div className="relative w-full flex flex-col items-center justify-start pt-10 md:pt-14 pointer-events-none select-none z-50">
          {slotSpinning ? (
            <div className="w-[110%] h-14 bg-yellow-500 text-black border-y-4 border-black -rotate-2 flex items-center justify-center space-x-4 shadow-2xl animate-pulse">
              <span className="font-black text-xl tracking-widest uppercase animate-bounce">
                🎰 CHANCE SLOT... 🎰
              </span>
              <span className="font-black text-sm bg-black text-yellow-300 px-3 py-1 -skew-x-12">
                7 7 7
              </span>
            </div>
          ) : (
            <div className={`w-[110%] h-14 md:h-16 ${gambleResult === 'SUCCESS' ? 'bg-gradient-to-r from-yellow-500 via-red-600 to-yellow-400 border-y-4 border-yellow-300' : 'bg-gradient-to-r from-purple-950 via-black to-indigo-950 border-y-4 border-cyan-400'} -rotate-2 flex items-center justify-between px-8 md:px-20 z-10 shadow-2xl transition-all duration-300`}>
              <div className="flex items-center space-x-3">
                <span className={`font-black text-xs md:text-sm px-3 py-1 -skew-x-12 ${gambleResult === 'SUCCESS' ? 'bg-black text-yellow-300 border border-yellow-300' : 'bg-red-900 text-white border border-red-500'}`}>
                  {gambleResult === 'SUCCESS' ? 'CHANCE COMPLETE!' : 'PROBABILITY FAIL'}
                </span>
                <span className={`font-black text-xl md:text-3xl tracking-wider uppercase ${gambleResult === 'SUCCESS' ? 'text-black drop-shadow-[0_2px_2px_rgba(255,255,255,0.8)]' : 'text-cyan-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'}`}>
                  {gambleResult === 'SUCCESS' ? 'CRITICAL SUCCESS!! 🎰' : 'MISS... 💀'}
                </span>
              </div>
              <span className={`font-bold text-xs md:text-sm px-3 py-1 -skew-x-12 ${gambleResult === 'SUCCESS' ? 'bg-yellow-300 text-black font-black' : 'bg-black text-purple-400 border border-purple-500'}`}>
                {title || (gambleResult === 'SUCCESS' ? '一撃粉砕' : '反動発動')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
