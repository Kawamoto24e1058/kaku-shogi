import React, { useRef, useState, useEffect } from 'react';
import type { Board, Piece, Player, GamePhase, VisualEffect, TileState } from '../types';
import { BOARD_SIZE, getPieceLogicCode, getPieceTrigger, getEffectCells, getBoardPiece } from '../gameLogic';
import type { AbilityAnimationState } from '../App';

interface GameBoardProps {
  board: Board;
  tileBoard?: (TileState | null)[][];
  turn: Player;
  phase: GamePhase;
  capturedPieces: {
    sente: Piece[];
    gote: Piece[];
  };
  customDecks: {
    sente: Piece[];
    gote: Piece[];
  };
  destroyedPieces?: Piece[];
  sharedPieces: Piece[]; // Shared fantasy pool pieces
  customPiecesToPlace: Piece[];
  selectedCell: [number, number] | null;
  selectedCapturedPiece: { piece: Piece; index: number } | null;
  selectedSharedPiece: { piece: Piece; index: number } | null; // Shared pool selection
  selectedCustomDeckPiece: { piece: Piece; index: number } | null;
  validMoves: ( [number, number] & { moveType?: 'normal' | 'slide' | 'jump' } )[];
  activeAbilityTargets: [number, number][];
  activeAbilityMode: boolean;
  onCellClick: (y: number, x: number) => void;
  onCapturedPieceClick: (piece: Piece, index: number, owner: Player) => void;
  onCustomDeckPieceClick: (piece: Piece, index: number, owner: Player) => void;
  onSharedPieceClick: (piece: Piece, index: number) => void; // Shared pool callback
  onHoverPiece?: (piece: Piece | null) => void; // Hover popup callback
  vsAiMode: boolean;
  isSenteChecked?: boolean;
  isGoteChecked?: boolean;
  onlineMode?: boolean;
  myRole?: 'sente' | 'gote' | null;
  playerNames: { sente: string; gote: string };
  activeAbilityAnimation?: AbilityAnimationState;
  explosionEffects?: [number, number][];
}



export const GameBoard: React.FC<GameBoardProps> = ({
  board,
  tileBoard,
  turn,
  phase,
  customPiecesToPlace: _customPiecesToPlace,
  selectedCell,
  validMoves,
  activeAbilityTargets,
  activeAbilityMode: _activeAbilityMode,
  onCellClick,
  onHoverPiece,
  vsAiMode,
  isSenteChecked = false,
  isGoteChecked = false,
  onlineMode = false,
  myRole = null,
  activeAbilityAnimation,
  explosionEffects = [],
}) => {
  // ── Particle System Canvas ──
  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    size: number;
    life: number;
    decay: number;
    shape?: 'circle' | 'square' | 'ring' | 'ice';
  }

  interface Projectile {
    x: number;
    y: number;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    progress: number;
    speed: number;
    color: string;
    theme: string;
    effectType: string;
    trajectoryType?: string;
    onArrive: () => void;
  }

  interface ActiveLaser {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    life: number;
    color: string;
  }

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const lasersRef = useRef<ActiveLaser[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  const getCellCenterPixel = (cellX: number, cellY: number): { x: number, y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const cellWidth = rect.width / 9;
    const cellHeight = rect.height / 9;
    
    return {
      x: (cellX + 0.5) * cellWidth,
      y: (cellY + 0.5) * cellHeight
    };
  };

  const getThemeColor = (theme: string, effectType: string): string => {
    if (effectType === 'DESTROY') return '#ef4444'; // Red fiery
    if (effectType === 'IMMOBILIZE') return '#38bdf8'; // Frosty blue
    if (effectType === 'SWAP') return '#a855f7'; // Swirling purple
    if (effectType === 'PULL' || effectType === 'PUSH') return '#10b981'; // Green wind
    if (effectType === 'RE_ACTION') return '#ffd700'; // Gold/Yellow aura
    
    switch (theme) {
      case 'WARRIOR_IRON': return '#06b6d4'; // Cyan
      case 'MYSTIC_MIST':
      case 'SHADOW_NIGHT': return '#8b5cf6'; // Indigo shadow
      case 'SPACE_NATURE':
      case 'NATURE_STONE': return '#f59e0b'; // Amber gold
      default: return '#fbbf24'; // Yellow gold
    }
  };

  const spawnLaserParticles = (start: { x: number, y: number }, end: { x: number, y: number }) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.floor(dist / 12);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = start.x + dx * t;
      const py = start.y + dy * t;

      // Laser sparks core
      particlesRef.current.push({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 1.0,
        vy: (Math.random() - 0.5) * 1.0,
        color: '#ffffff',
        size: Math.random() * 3 + 1,
        life: 0.8 + Math.random() * 0.2,
        decay: 0.05 + Math.random() * 0.05,
        shape: 'circle'
      });

      // Glow cyan particles
      particlesRef.current.push({
        x: px,
        y: py,
        vx: (Math.random() - 0.5) * 2.0,
        vy: (Math.random() - 0.5) * 2.0,
        color: '#22d3ee',
        size: Math.random() * 5 + 2,
        life: 0.7 + Math.random() * 0.3,
        decay: 0.04 + Math.random() * 0.04,
        shape: 'circle'
      });
    }
  };

  const spawnExplosion = (pos: { x: number, y: number }, theme: string, effectType: string, visualEffect?: VisualEffect) => {
    // --- DATA-DRIVEN PATH: Use AI-designed visual_effect if available ---
    if (visualEffect) {
      const count = Math.max(10, Math.min(100, visualEffect.particle_count));
      const speed = Math.max(0.3, Math.min(5.0, visualEffect.particle_speed));
      const color = visualEffect.particle_color || '#ffffff';
      const ttype = visualEffect.trajectory_type;

      if (ttype === 'BURST') {
        // Full-power burst in every direction
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const s = (Math.random() * 0.6 + 0.4) * speed * 3.5;
          particlesRef.current.push({
            x: pos.x, y: pos.y,
            vx: Math.cos(angle) * s, vy: Math.sin(angle) * s,
            color,
            size: Math.random() * 5 + 1.5,
            life: 1.0,
            decay: Math.random() * 0.025 + 0.018,
            shape: Math.random() < 0.3 ? 'square' : 'circle'
          });
        }
        particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color, size: 6, life: 0.8, decay: 0.04, shape: 'ring' });

      } else if (ttype === 'SPIRAL') {
        // Spiral vortex from orbit outward
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * 20 + 4;
          const px = pos.x + Math.cos(angle) * dist;
          const py = pos.y + Math.sin(angle) * dist;
          const vx = -Math.sin(angle) * speed * 1.2 - Math.cos(angle) * 0.4;
          const vy = Math.cos(angle) * speed * 1.2 - Math.sin(angle) * 0.4;
          particlesRef.current.push({
            x: px, y: py, vx, vy, color,
            size: Math.random() * 3 + 1,
            life: 1.0,
            decay: Math.random() * 0.03 + 0.02,
            shape: 'circle'
          });
        }
        particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color, size: 8, life: 0.9, decay: 0.035, shape: 'ring' });

      } else if (ttype === 'STRIKE') {
        // Vertical lightning strike splash
        for (let i = 0; i < count; i++) {
          const angle = Math.PI + (Math.random() - 0.5) * Math.PI; // downward fan
          const s = (Math.random() * 0.6 + 0.4) * speed * 3;
          particlesRef.current.push({
            x: pos.x, y: pos.y,
            vx: Math.cos(angle) * s, vy: Math.abs(Math.sin(angle) * s),
            color,
            size: Math.random() * 4 + 1.5,
            life: 1.0,
            decay: Math.random() * 0.03 + 0.02,
            shape: Math.random() < 0.25 ? 'ice' : 'circle'
          });
        }
        particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color, size: 10, life: 0.7, decay: 0.05, shape: 'ring' });

      } else {
        // BEAM and PARABOLA: compact arrival explosion at target
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const s = (Math.random() * 0.6 + 0.4) * speed * 2.5;
          particlesRef.current.push({
            x: pos.x, y: pos.y,
            vx: Math.cos(angle) * s, vy: Math.sin(angle) * s,
            color,
            size: Math.random() * 4 + 1,
            life: 1.0,
            decay: Math.random() * 0.03 + 0.022,
            shape: 'circle'
          });
        }
        particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color, size: 5, life: 0.8, decay: 0.04, shape: 'ring' });
      }
      return;
    }

    // --- FALLBACK PATH: Effect-type based presets for old pieces without visual_effect ---
    const count = 30;
    const color = getThemeColor(theme, effectType);

    if (effectType === 'DESTROY') {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3.5 + 1.5;
        particlesRef.current.push({
          x: pos.x, y: pos.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          color: Math.random() < 0.4 ? '#ef4444' : (Math.random() < 0.7 ? '#f97316' : '#facc15'),
          size: Math.random() * 5 + 1.5,
          life: 1.0, decay: Math.random() * 0.03 + 0.02,
          shape: Math.random() < 0.35 ? 'square' : 'circle'
        });
      }
      particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color: '#ef4444', size: 5, life: 0.8, decay: 0.04, shape: 'ring' });

    } else if (effectType === 'IMMOBILIZE') {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 1.8 + 0.8;
        particlesRef.current.push({
          x: pos.x, y: pos.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          color: Math.random() < 0.5 ? '#38bdf8' : '#e0f2fe',
          size: Math.random() * 4 + 2, life: 1.0,
          decay: Math.random() * 0.02 + 0.015, shape: 'ice'
        });
      }
      particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color: '#38bdf8', size: 8, life: 0.9, decay: 0.035, shape: 'ring' });

    } else if (effectType === 'SWAP') {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 18 + 4;
        const px = pos.x + Math.cos(angle) * dist;
        const py = pos.y + Math.sin(angle) * dist;
        const vx = -Math.sin(angle) * 1.6 - Math.cos(angle) * 0.4;
        const vy = Math.cos(angle) * 1.6 - Math.sin(angle) * 0.4;
        particlesRef.current.push({ x: px, y: py, vx, vy, color: Math.random() < 0.5 ? '#a855f7' : '#d946ef', size: Math.random() * 3 + 1, life: 1.0, decay: Math.random() * 0.03 + 0.02, shape: 'circle' });
      }
      particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color: '#a855f7', size: 8, life: 0.8, decay: 0.04, shape: 'ring' });

    } else if (effectType === 'PULL' || effectType === 'PUSH') {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3.0 + 1.0;
        particlesRef.current.push({ x: pos.x, y: pos.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color: Math.random() < 0.6 ? '#34d399' : '#a7f3d0', size: Math.random() * 4 + 1, life: 1.0, decay: Math.random() * 0.04 + 0.025, shape: 'circle' });
      }

    } else if (effectType === 'RE_ACTION') {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 1.5 + 0.5;
        const vx = Math.cos(angle) * speed * 0.5;
        const vy = -Math.abs(Math.sin(angle) * speed) - 0.5;
        particlesRef.current.push({
          x: pos.x + (Math.random() - 0.5) * 15,
          y: pos.y + (Math.random() - 0.5) * 15,
          vx,
          vy,
          color: Math.random() < 0.6 ? '#ffd700' : '#fbbf24',
          size: Math.random() * 4 + 2,
          life: 1.0,
          decay: Math.random() * 0.03 + 0.02,
          shape: 'circle'
        });
      }
      particlesRef.current.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, color: '#ffd700', size: 10, life: 0.9, decay: 0.03, shape: 'ring' });

    } else {
      for (let i = 0; i < 20; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2.2 + 0.8;
        particlesRef.current.push({ x: pos.x, y: pos.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, size: Math.random() * 3.5 + 1.5, life: 1.0, decay: Math.random() * 0.04 + 0.02, shape: 'circle' });
      }
    }
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }
  };

  const updateAndDraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    resizeCanvas();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Projectiles
    const projectiles = projectilesRef.current;
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      proj.progress += proj.speed * 0.016;
      if (proj.progress >= 1.0) {
        proj.progress = 1.0;
        proj.onArrive();
        projectiles.splice(i, 1);
        continue;
      }

      proj.x = proj.startX + (proj.endX - proj.startX) * proj.progress;
      let targetY = proj.startY + (proj.endY - proj.startY) * proj.progress;
      if (proj.trajectoryType === 'PARABOLA') {
        const dist = Math.sqrt((proj.endX - proj.startX) ** 2 + (proj.endY - proj.startY) ** 2);
        const height = Math.min(120, dist * 0.35);
        targetY -= Math.sin(proj.progress * Math.PI) * height;
      }
      proj.y = targetY;

      ctx.save();
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = proj.color;
      ctx.shadowColor = proj.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.restore();

      // Trailing sparks
      if (Math.random() < 0.6) {
        particlesRef.current.push({
          x: proj.x,
          y: proj.y,
          vx: (Math.random() - 0.5) * 1.2,
          vy: (Math.random() - 0.5) * 1.2,
          color: proj.color,
          size: Math.random() * 2.5 + 1.0,
          life: 0.8,
          decay: Math.random() * 0.04 + 0.03,
          shape: 'circle'
        });
      }
    }

    // 2. Lasers
    const lasers = lasersRef.current;
    for (let i = lasers.length - 1; i >= 0; i--) {
      const laser = lasers[i];
      laser.life -= 0.04;
      if (laser.life <= 0) {
        lasers.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = laser.life;
      ctx.strokeStyle = laser.color;
      ctx.lineWidth = 5;
      ctx.shadowColor = laser.color;
      ctx.shadowBlur = 10;
      
      ctx.beginPath();
      ctx.moveTo(laser.startX, laser.startY);
      ctx.lineTo(laser.endX, laser.endY);
      ctx.stroke();

      // Laser inner white core
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();
    }

    // 3. Particles
    const particles = particlesRef.current;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.shape === 'ring') {
        p.size += 0.8;
      }

      p.life -= p.decay;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;

      if (p.shape === 'square') {
        ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      } else if (p.shape === 'ring') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (p.shape === 'ice') {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - p.size);
        ctx.lineTo(p.x + p.size * 0.7, p.y);
        ctx.lineTo(p.x, p.y + p.size);
        ctx.lineTo(p.x - p.size * 0.7, p.y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();

    if (projectilesRef.current.length > 0 || particlesRef.current.length > 0 || lasersRef.current.length > 0) {
      animationFrameRef.current = requestAnimationFrame(updateAndDraw);
    } else {
      animationFrameRef.current = null;
    }
  };

  useEffect(() => {
    if (activeAbilityAnimation?.active) {
      const source = activeAbilityAnimation.source;
      const targets = activeAbilityAnimation.targets || [];
      const theme = activeAbilityAnimation.theme || 'DEFAULT';
      const effectType = activeAbilityAnimation.effectType || 'DEFAULT';
      const visualEffect = activeAbilityAnimation.visualEffect;

      // Determine projectile color – prefer AI color over fallback
      const projColor = visualEffect?.particle_color || getThemeColor(theme, effectType);
      // Scale projectile speed by AI particle_speed; default 4.8
      const projSpeed = visualEffect ? Math.max(2.0, Math.min(8.0, visualEffect.particle_speed * 3)) : 4.8;

      if (source && targets.length > 0) {
        const [sy, sx] = source;
        targets.forEach(([ty, tx]) => {
          const start = getCellCenterPixel(sx, sy);
          const end = getCellCenterPixel(tx, ty);

          const isBeam = visualEffect?.trajectory_type === 'BEAM';
          const isStrike = visualEffect?.trajectory_type === 'STRIKE';

          if (isBeam) {
            // Instant laser beam & explosion
            lasersRef.current.push({
              startX: start.x,
              startY: start.y,
              endX: end.x,
              endY: end.y,
              life: 1.0,
              color: projColor
            });
            spawnLaserParticles(start, end);
            spawnExplosion(end, theme, effectType, visualEffect);
          } else {
            // Traveling projectile
            const startX = isStrike ? end.x : start.x;
            const startY = isStrike ? -50 : start.y;

            projectilesRef.current.push({
              x: startX,
              y: startY,
              startX,
              startY,
              endX: end.x,
              endY: end.y,
              progress: 0,
              speed: projSpeed,
              color: projColor,
              theme,
              effectType,
              trajectoryType: visualEffect?.trajectory_type,
              onArrive: () => {
                spawnExplosion(end, theme, effectType, visualEffect);
                
                if (theme === 'WARRIOR_IRON' || isStrike) {
                  lasersRef.current.push({
                    startX: isStrike ? end.x : start.x,
                    startY: isStrike ? 0 : start.y,
                    endX: end.x,
                    endY: end.y,
                    life: 1.0,
                    color: projColor
                  });
                  spawnLaserParticles(isStrike ? { x: end.x, y: 0 } : start, end);
                }
              }
            });
          }
        });
      } else if (targets.length > 0) {
        targets.forEach(([ty, tx]) => {
          const pos = getCellCenterPixel(tx, ty);
          spawnExplosion(pos, theme, effectType, visualEffect);
        });
      }

      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(updateAndDraw);
      }
    }
  }, [activeAbilityAnimation]);

  useEffect(() => {
    if (explosionEffects && explosionEffects.length > 0) {
      explosionEffects.forEach(([ey, ex]) => {
        const pos = getCellCenterPixel(ex, ey);
        spawnExplosion(pos, 'DEFAULT', 'DESTROY');
      });
      if (!animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(updateAndDraw);
      }
    }
  }, [explosionEffects]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const isProtectedByNullifier = (y: number, x: number, owner: Player): boolean => {
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = getBoardPiece(board, { x: c, y: r });
        if (
          p &&
          p.owner === owner &&
          p.coolDownTurnsRemaining === 0 &&
          (p.logic_code === 'nullify' || p.description.includes('無効化') || p.description.includes('結界') || p.description.includes('NULLIFY'))
        ) {
          const dist = Math.max(Math.abs(r - y), Math.abs(c - x));
          if (dist <= 2) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const localTurn = turn;

  // ── ホバープレビューステート（ability_spec 用）──
  // activeAbilityMode 中にセルをホバーしたとき、着弾範囲を動的プレビューする
  const [hoveredAbilityCell, setHoveredAbilityCell] = useState<[number, number] | null>(null);

  const shouldRotate = onlineMode
    ? (myRole === 'gote')
    : (vsAiMode ? false : localTurn === 'gote');

  const prevBoardRef = useRef<Board | null>(null);
  const [damageFlashCells, setDamageFlashCells] = useState<Record<string, boolean>>({});
  const [dyingPieces, setDyingPieces] = useState<Record<string, Piece>>({});

  // Detect HP reduction, captures, or destructions to trigger visual effects
  useEffect(() => {
    let timer: any = null;
    let dyingTimer: any = null;

    if (prevBoardRef.current) {
      const newFlashCells: Record<string, boolean> = {};
      const newDyingPieces: Record<string, Piece> = {};
      let hasChanges = false;
      let hasDying = false;

      const pieceExistsOnNewBoard = (pieceId: string) => {
        return board.some(row => row.some(p => p?.id === pieceId));
      };

      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          const prevPiece = prevBoardRef.current[y]?.[x];
          const currPiece = getBoardPiece(board, { x, y });

          if (prevPiece) {
            if (!currPiece) {
              // Piece vanished from cell. If it is no longer anywhere on the board, it was captured or destroyed.
              if (!pieceExistsOnNewBoard(prevPiece.id)) {
                newFlashCells[`${y},${x}`] = true;
                newDyingPieces[`${y},${x}`] = prevPiece;
                hasChanges = true;
                hasDying = true;
              }
            } else if (currPiece.id !== prevPiece.id) {
              // Piece replaced by opponent (capture)
              newFlashCells[`${y},${x}`] = true;
              newDyingPieces[`${y},${x}`] = prevPiece;
              hasChanges = true;
              hasDying = true;
            }
          }
        }
      }

      if (hasChanges) {
        setDamageFlashCells(prev => ({ ...prev, ...newFlashCells }));
        timer = setTimeout(() => {
          setDamageFlashCells(prev => {
            const updated = { ...prev };
            Object.keys(newFlashCells).forEach(key => {
              delete updated[key];
            });
            return updated;
          });
        }, 400);
      }

      if (hasDying) {
        setDyingPieces(prev => ({ ...prev, ...newDyingPieces }));
        dyingTimer = setTimeout(() => {
          setDyingPieces(prev => {
            const updated = { ...prev };
            Object.keys(newDyingPieces).forEach(key => {
              delete updated[key];
            });
            return updated;
          });
        }, 500);
      }
    }
    prevBoardRef.current = board;

    return () => {
      if (timer) clearTimeout(timer);
      if (dyingTimer) clearTimeout(dyingTimer);
    };
  }, [board]);
  
  // Helpers to check highlights
  const isMoveHighlight = (y: number, x: number) => {
    return validMoves.some(([my, mx]) => my === y && mx === x);
  };

  const getMoveHighlightType = (y: number, x: number): 'normal' | 'slide' | 'jump' | undefined => {
    const move = validMoves.find(([my, mx]) => my === y && mx === x);
    return move?.moveType;
  };

  const isActiveAbilityHighlight = (y: number, x: number) => {
    return activeAbilityTargets.some(([dy, dx]) => dy === y && dx === x);
  };

  const isSelected = (y: number, x: number) => {
    return selectedCell !== null && selectedCell[0] === y && selectedCell[1] === x;
  };

  // ── ホバープレビューマスの計算（ability_spec area_shape 対応）──
  // activeAbilityMode 中に射程内のセルをホバーすると、
  // 着弾範囲（area_shape）を赤枠でプレビュー表示する
  const isAbilityEffectPreview = (y: number, x: number): boolean => {
    if (!hoveredAbilityCell) return false;
    const [hy, hx] = hoveredAbilityCell;
    // ホバーしているセルが射程内かチェック
    if (!isActiveAbilityHighlight(hy, hx)) return false;
    // GameBoard は board を直接持つのでそこから ability_spec を探す
    let spec: import('../types').AbilitySpec | undefined;
    let sy: number | undefined;
    let sx: number | undefined;
    let owner: Player | undefined;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = getBoardPiece(board, { x: c, y: r });
        if (p && p.ability_spec && p.ability_spec.target_selection === 'CLICK_ZONE') {
          const isOwner = p.owner === (onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : localTurn));
          if (isOwner) { 
            spec = p.ability_spec; 
            sy = r;
            sx = c;
            owner = p.owner;
            break; 
          }
        }
      }
      if (spec) break;
    }
    if (!spec) return false;
    const effectCells = getEffectCells(hy, hx, spec.area_shape, sy, sx, owner, board, spec.effect_offsets);
    return effectCells.some(([ey, ex]) => ey === y && ex === x);
  };

  const isValidSetupCell = (y: number, x: number) => {
    if (phase !== 'placement') return false;
    if (getBoardPiece(board, { x, y }) !== null) return false;
    // Sente places on bottom 3 ranks (y=6, 7, 8)
    if (localTurn === 'sente') return y >= 6;
    // Gote places on top 3 ranks (y=0, 1, 2)
    return y <= 2;
  };

  // Render cell
  const renderCell = (y: number, x: number) => {
    const piece = getBoardPiece(board, { x, y });
    const isSel = isSelected(y, x);
    const isMove = isMoveHighlight(y, x);
    const isActiveTarget = isActiveAbilityHighlight(y, x);
    const isSetupValid = isValidSetupCell(y, x);
    const isFlashActive = damageFlashCells[`${y},${x}`];

    let cellClassName = '';
    if (isActiveTarget) {
      if (piece) {
        if (piece.owner !== localTurn) {
          cellClassName = 'ability-target-red';
        } else {
          cellClassName = 'ability-target-yellow';
        }
      }
    }

    let cellStyle: React.CSSProperties = {
      width: '100%',
      minWidth: 0,
      aspectRatio: '1',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      cursor: 'pointer',
      fontSize: '11px',
      userSelect: 'none',
      transition: 'all 0.15s ease',
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'rgba(139, 92, 26, 0.12)',
      background: 'rgba(255, 255, 255, 0.45)'
    };

    if (isFlashActive) {
      cellStyle.animation = 'damageFlash 0.4s ease-in-out forwards';
    }

    const isEffectPreview = isAbilityEffectPreview(y, x);

    if (isSel) {
      cellStyle.borderColor = 'var(--color-gold)';
      cellStyle.background = 'rgba(212, 175, 55, 0.12)';
    } else if (isMove) {
      const moveType = getMoveHighlightType(y, x) || 'normal';
      if (moveType === 'slide') {
        cellClassName += ' move-highlight-slide';
      } else if (moveType === 'jump') {
        cellClassName += ' move-highlight-jump';
      } else {
        cellClassName += ' move-highlight-normal';
      }
    } else if (isEffectPreview) {
      // 着弾範囲プレビュー（赤枠）
      cellStyle.borderColor = 'rgba(220, 38, 38, 0.85)';
      cellStyle.borderStyle = 'solid';
      cellStyle.borderWidth = '2px';
      cellStyle.background = 'rgba(220, 38, 38, 0.12)';
    } else if (isActiveTarget) {
      cellStyle.borderColor = 'var(--color-murasaki)';
      cellStyle.background = 'rgba(74, 21, 75, 0.15)';
    } else if (isSetupValid) {
      cellStyle.borderColor = 'var(--color-gold)';
    }

    const currentTile = tileBoard?.[y]?.[x];
    const showTileGraphic = currentTile && (!currentTile.isStealth || currentTile.ownerPlayer === (myRole || turn));
    if (showTileGraphic && currentTile) {
      if (currentTile.effectType === 'FIRE_ZONE') {
        cellStyle.background = 'radial-gradient(circle, rgba(239, 68, 68, 0.45) 0%, rgba(185, 28, 28, 0.25) 100%)';
        cellStyle.borderColor = '#ef4444';
      } else if (currentTile.effectType === 'POISON_MUD') {
        cellStyle.background = 'radial-gradient(circle, rgba(168, 85, 247, 0.45) 0%, rgba(126, 34, 206, 0.25) 100%)';
        cellStyle.borderColor = '#a855f7';
      } else if (currentTile.effectType === 'ICE_FLOOR') {
        cellStyle.background = 'radial-gradient(circle, rgba(56, 189, 248, 0.45) 0%, rgba(3, 105, 161, 0.25) 100%)';
        cellStyle.borderColor = '#38bdf8';
      } else if (currentTile.effectType === 'TIME_BOMB') {
        cellStyle.background = 'radial-gradient(circle, rgba(234, 179, 8, 0.45) 0%, rgba(161, 98, 7, 0.25) 100%)';
        cellStyle.borderColor = '#eab308';
      }
    }

    const isActiveSource = activeAbilityAnimation?.active && 
      activeAbilityAnimation.source?.[0] === y && 
      activeAbilityAnimation.source?.[1] === x;

    if (isActiveSource) {
      cellStyle.borderColor = 'rgba(0, 0, 0, 0.4)';
      cellStyle.boxShadow = '0 0 30px 10px rgba(0, 0, 0, 0.65)';
      cellStyle.transform = 'scale(1.06)';
      cellStyle.zIndex = 50;
      cellStyle.transition = 'all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    }

    const dyingPiece = dyingPieces[`${y},${x}`];
    const activePiece = piece || dyingPiece;

    let pieceUI = null;
    if (activePiece) {
      const viewer: Player = onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : localTurn);
      const isMyPiece = activePiece.owner === viewer;
      const shouldHide = activePiece.isStealth === true && !activePiece.isRevealed && activePiece.owner !== viewer;

      if (!shouldHide) {
        const isAutonomous = activePiece.trigger === 'ALWAYS' && (getPieceLogicCode(activePiece).includes('runaway') || activePiece.description.includes('操作不能'));
        const isCustom = !activePiece.isKing && !activePiece.isPawn && !activePiece.isHisha && !activePiece.isKaku;
        const isAnimating = activeAbilityAnimation?.active && 
          activeAbilityAnimation.source?.[0] === y && 
          activeAbilityAnimation.source?.[1] === x;
        
        // 1. 白木の縦長木札テーマ
        let baseBg = 'linear-gradient(135deg, #FFFDF9 0%, #FDFBF7 50%, #F3EEE0 100%)'; 
        let baseBorderColor = 'rgba(139, 92, 26, 0.2)';
        let insetShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.6), inset 0 -1px 2px rgba(0, 0, 0, 0.08)';

        let borderWidthVal = '2px';
        let borderStyleVal = 'solid';
        let borderColorVal = baseBorderColor;
        let boxShadowStyle = insetShadow;
        let widthStyle = '86%';
        let heightStyle = '92%';

        // 2. 駒の種類ごとの差別化（歩兵 vs 王将 vs カスタム駒）
        if (activePiece.isKing) {
          borderColorVal = 'var(--color-gold)';
        } else if (activePiece.isPawn) {
          widthStyle = '76%';
          heightStyle = '82%';
          borderColorVal = 'rgba(139, 92, 26, 0.15)';
        } else if (activePiece.isHisha || activePiece.isKaku) {
          widthStyle = '84%';
          heightStyle = '90%';
        }

        // Define shape border-radius, borders, and padding based on themes and special rules
        let innerPadding = '4px 2px';
        let borderTopLeftRadius = '2px';
        let borderTopRightRadius = '2px';
        let borderBottomLeftRadius = '2px';
        let borderBottomRightRadius = '2px';

        let borderTopWidthStyle = borderWidthVal;
        let borderBottomWidthStyle = borderWidthVal;
        let borderLeftWidthStyle = borderWidthVal;
        let borderRightWidthStyle = borderWidthVal;

        let borderTopColorStyle = borderColorVal;
        let borderBottomColorStyle = borderColorVal;
        let borderLeftColorStyle = borderColorVal;
        let borderRightColorStyle = borderColorVal;

        if (!isCustom) {
          // 1. 通常将棋駒 (ベーシック五角形風)
          borderTopLeftRadius = '30% 50%';
          borderTopRightRadius = '30% 50%';
          borderBottomLeftRadius = '6px';
          borderBottomRightRadius = '6px';
          borderBottomWidthStyle = '4px';
          borderBottomColorStyle = 'rgba(67, 20, 7, 0.4)'; // border-amber-955/40
          innerPadding = '4px 2px';
        } else if (activePiece.is_once_per_game) {
          // 4. 伝説・大技系 (八咫鏡・縦長大楕円)
          borderTopLeftRadius = '50% 35%';
          borderTopRightRadius = '50% 35%';
          borderBottomLeftRadius = '50% 35%';
          borderBottomRightRadius = '50% 35%';
          borderTopWidthStyle = '4px';
          borderBottomWidthStyle = '4px';
          borderLeftWidthStyle = '4px';
          borderRightWidthStyle = '4px';
          borderColorVal = '#92400e'; // border-amber-800
          borderTopColorStyle = '#92400e';
          borderBottomColorStyle = '#92400e';
          borderLeftColorStyle = '#92400e';
          borderRightColorStyle = '#92400e';
          boxShadowStyle = `inset 0 0 10px rgba(120, 53, 4, 0.4), ${insetShadow}`;
          innerPadding = '8px 6px';
        } else if (activePiece.visual_theme === 'MYSTIC_MIST' || activePiece.visual_theme === 'SHADOW_NIGHT') {
          // 3. 呪術・罠系 (霊符・角落とし長方形)
          borderTopLeftRadius = '4px';
          borderTopRightRadius = '4px';
          borderBottomLeftRadius = '4px';
          borderBottomRightRadius = '4px';
          borderLeftWidthStyle = '2px';
          borderRightWidthStyle = '2px';
          borderTopWidthStyle = '4px';
          borderBottomWidthStyle = '4px';
          borderColorVal = 'rgba(120, 53, 4, 0.4)'; // border-amber-900/40
          borderTopColorStyle = 'rgba(120, 53, 4, 0.4)';
          borderBottomColorStyle = 'rgba(120, 53, 4, 0.4)';
          borderLeftColorStyle = 'rgba(120, 53, 4, 0.4)';
          borderRightColorStyle = 'rgba(120, 53, 4, 0.4)';
          innerPadding = '6px 6px';
        } else {
          // 2. 近未来・兵器系 (WARRIOR_IRON/その他) - 楔型シャープ木札
          borderTopLeftRadius = '6px';
          borderTopRightRadius = '6px';
          borderBottomLeftRadius = '40% 100%';
          borderBottomRightRadius = '40% 100%';
          borderTopWidthStyle = '4px';
          borderTopColorStyle = 'rgba(67, 20, 7, 0.3)'; // border-amber-950/30
          innerPadding = '4px 4px 8px 4px';
        }

        // Apply dynamic runtime overlays / state overrides
        let opacityVal = 1.0;
        let animationStyle = '';

        if (dyingPiece) {
          animationStyle = 'inkFadeOut 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards';
        }

        const isStunned = activePiece.stunTurnsRemaining !== undefined && activePiece.stunTurnsRemaining > 0;
        const isWeathered = activePiece.coolDownTurnsRemaining === 99;

        if (!activePiece.isRevealed && isMyPiece) {
          opacityVal = 0.55;
          borderStyleVal = 'dashed';
        }

        if (isStunned) {
          baseBg = 'linear-gradient(135deg, #e0f2fe 0%, #dbeafe 50%, #c7d2fe 100%)';
          borderStyleVal = 'double';
          borderWidthVal = '3px';
          borderColorVal = '#818cf8';
          borderTopColorStyle = '#818cf8';
          borderBottomColorStyle = '#818cf8';
          borderLeftColorStyle = '#818cf8';
          borderRightColorStyle = '#818cf8';
          boxShadowStyle = '0 0 8px rgba(129, 140, 248, 0.4), inset 0 1px 1px white';
        } else if (isWeathered) {
          baseBg = 'linear-gradient(135deg, #f5f5f5 0%, #e5e5e5 100%)';
          borderStyleVal = 'dashed';
          borderColorVal = '#a3a3a3';
          borderTopColorStyle = '#a3a3a3';
          borderBottomColorStyle = '#a3a3a3';
          borderLeftColorStyle = '#a3a3a3';
          borderRightColorStyle = '#a3a3a3';
          opacityVal = 0.65;
        } else if (activePiece.coolDownTurnsRemaining > 0) {
          baseBg = '#D2D0C8';
          borderTopColorStyle = '#8A8880';
          borderBottomColorStyle = '#8A8880';
          borderLeftColorStyle = '#8A8880';
          borderRightColorStyle = '#8A8880';
          borderStyleVal = 'dotted';
          opacityVal = 0.75;
        }

        if (isAutonomous) {
          borderStyleVal = 'dashed';
          borderTopColorStyle = 'var(--color-shinku)';
          borderBottomColorStyle = 'var(--color-shinku)';
          borderLeftColorStyle = 'var(--color-shinku)';
          borderRightColorStyle = 'var(--color-shinku)';
        }

        if (activePiece.isKing && ((activePiece.owner === 'sente' && isSenteChecked) || (activePiece.owner === 'gote' && isGoteChecked))) {
          borderTopColorStyle = 'var(--color-shinku)';
          borderBottomColorStyle = 'var(--color-shinku)';
          borderLeftColorStyle = 'var(--color-shinku)';
          borderRightColorStyle = 'var(--color-shinku)';
          boxShadowStyle = '0 0 10px var(--color-shinku), inset 0 0 4px rgba(158, 42, 43, 0.4)';
        }

        const pieceStyle: React.CSSProperties = {
          width: widthStyle,
          height: heightStyle,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          
          borderStyle: borderStyleVal,
          borderTopWidth: borderTopWidthStyle,
          borderBottomWidth: borderBottomWidthStyle,
          borderLeftWidth: borderLeftWidthStyle,
          borderRightWidth: borderRightWidthStyle,
          
          borderTopColor: borderTopColorStyle,
          borderBottomColor: borderBottomColorStyle,
          borderLeftColor: borderLeftColorStyle,
          borderRightColor: borderRightColorStyle,
          
          borderTopLeftRadius: borderTopLeftRadius,
          borderTopRightRadius: borderTopRightRadius,
          borderBottomLeftRadius: borderBottomLeftRadius,
          borderBottomRightRadius: borderBottomRightRadius,
          
          boxShadow: boxShadowStyle,
          background: baseBg,
          opacity: opacityVal,
          animation: animationStyle || undefined,
          transform: isMyPiece
            ? (shouldRotate ? 'rotate(180deg)' : 'none')
            : (shouldRotate ? 'none' : 'rotate(180deg)'),
          transition: 'all 0.2s ease',
          position: 'relative',
          overflow: 'hidden',
        };

        const isTargetOfDestroy = activeAbilityAnimation?.active &&
          activeAbilityAnimation.targets.some(([ty, tx]) => ty === y && tx === x) &&
          activeAbilityAnimation.effectType === 'DESTROY';

        if (isTargetOfDestroy) {
          pieceStyle.opacity = 0;
          pieceStyle.transform = `${pieceStyle.transform} scale(0)`;
          pieceStyle.transition = 'all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        }

        const isSwapPiece = activeAbilityAnimation?.active &&
          activeAbilityAnimation.effectType === 'SWAP' &&
          (activeAbilityAnimation.targets.some(([ty, tx]) => ty === y && tx === x) ||
           (activeAbilityAnimation.source?.[0] === y && activeAbilityAnimation.source?.[1] === x));

        if (isSwapPiece) {
          pieceStyle.transform = `${pieceStyle.transform} rotate(180deg)`;
          pieceStyle.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        }

        const isBuffed = isProtectedByNullifier(y, x, activePiece.owner);
        if (isBuffed) {
          pieceStyle.borderTopColor = '#10b981';
          pieceStyle.borderBottomColor = '#10b981';
          pieceStyle.borderLeftColor = '#10b981';
          pieceStyle.borderRightColor = '#10b981';
          pieceStyle.borderTopWidth = '2px';
          pieceStyle.borderBottomWidth = '2px';
          pieceStyle.borderLeftWidth = '2px';
          pieceStyle.borderRightWidth = '2px';
          pieceStyle.borderStyle = 'solid';
          pieceStyle.boxShadow = `0 0 10px rgba(16, 185, 129, 0.45), ${insetShadow}`;
        }

        const triggerLetter = getPieceTrigger(activePiece).substring(0, 1);
        const isSpent = activePiece.coolDownTurnsRemaining > 0;

        let textColor = activePiece.coolDownTurnsRemaining > 0 ? '#7A7870' : 'var(--color-kurogane)';
        if (activePiece.coolDownTurnsRemaining <= 0) {
          if (activePiece.isPromoted) {
            textColor = 'var(--color-shinku)';
          } else if (activePiece.isKing) {
            textColor = '#1A1A1A';
          }
        }

        // Inner text wrapper that cancels rotation for Gote pieces
        const innerStyle: React.CSSProperties = {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'none',
          position: 'relative',
          overflow: 'hidden',
          boxSizing: 'border-box',
          padding: innerPadding,
        };

        const isRealPawn = activePiece.isPawn && (activePiece.word === '歩' || activePiece.word === '歩兵' || activePiece.word === 'と金' || activePiece.word === '封印歩兵');
        let wordStr = (activePiece.isHisha && activePiece.isPromoted) ? '竜王' : 
                      (activePiece.isKaku && activePiece.isPromoted) ? '竜馬' : 
                      (isRealPawn && activePiece.isPromoted) ? 'と金' : 
                      (activePiece.isPromoted && activePiece.promoted_effect?.effect_name ? activePiece.promoted_effect.effect_name : activePiece.word);
        let fontSizeVal = '11px';
        let letterSpacingVal = 'normal';
        let wordPadding = '0px';

        if (activePiece.isKing) {
          fontSizeVal = '13px';
        } else if (activePiece.isHisha || activePiece.isKaku) {
          fontSizeVal = '11px';
        } else if (activePiece.isPawn) {
          fontSizeVal = '9px';
        } else {
          const len = wordStr.length;
          if (len <= 3) {
            fontSizeVal = '11px';
            letterSpacingVal = '0.05em';
          } else if (len >= 4 && len <= 6) {
            fontSizeVal = '9px';
          } else {
            fontSizeVal = '7.5px';
            wordPadding = '1px 0';
          }
        }

        pieceUI = (
          <div key={`${activePiece.id}_${y}_${x}`} className="relative transition-all duration-500" style={{ filter: 'drop-shadow(0 6px 10px rgba(139, 92, 26, 0.14))', display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%' }}>
            <div style={pieceStyle}>
              <div style={innerStyle}>
                {/* Trigger Badge */}
                {!activePiece.isKing && !activePiece.isPawn && (
                  <div style={{
                    position: 'absolute',
                    top: '1px',
                    left: '1px',
                    fontSize: '5px',
                    fontFamily: 'var(--font-cyber)',
                    color: isSpent ? 'var(--text-muted)' : 'var(--color-kurogane)',
                    border: `0.5px solid ${isSpent ? 'var(--text-muted)' : 'rgba(26, 26, 26, 0.25)'}`,
                    borderRadius: '1px',
                    padding: '0 1px',
                    transform: 'scale(0.8)'
                  }}>
                    {triggerLetter}
                  </div>
                )}
                {/* Autonomous Badge */}
                {isAutonomous && (
                  <div style={{
                    position: 'absolute',
                    top: '1px',
                    right: '1px',
                    fontSize: '5px',
                    fontFamily: 'var(--font-cyber)',
                    color: 'var(--color-shinku)',
                    border: '0.5px solid var(--color-shinku)',
                    borderRadius: '1px',
                    padding: '0 1px',
                    transform: 'scale(0.8)',
                    background: 'rgba(158, 42, 43, 0.05)'
                  }}>
                    自律
                  </div>
                )}
                {/* Protection Buff Badge */}
                {isBuffed && (
                  <div style={{
                    position: 'absolute',
                    bottom: '2px',
                    right: '2px',
                    fontSize: '7px',
                    fontWeight: 'bold',
                    color: '#ffffff',
                    backgroundColor: '#10b981',
                    borderRadius: '50%',
                    width: '12px',
                    height: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 5px rgba(16, 185, 129, 0.7)',
                    border: '0.5px solid #ffffff',
                    transform: 'scale(0.95)',
                    zIndex: 10
                  }}>
                    護
                  </div>
                )}

                {/* Piece Text - size locked with break-all to prevent cell warping */}
                {(() => {
                  const isPieceRotated = isMyPiece
                    ? (shouldRotate)
                    : (!shouldRotate);
                  return (
                    <div style={{
                      fontSize: fontSizeVal,
                      letterSpacing: letterSpacingVal,
                      fontWeight: (activePiece.isKing || activePiece.isHisha || activePiece.isKaku) ? '900' : 'bold',
                      color: textColor,
                      textAlign: 'center',
                      writingMode: 'vertical-rl',
                      textOrientation: 'upright',
                      lineHeight: 1.0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: wordPadding,
                      marginTop: activePiece.isKing ? '6px' : '0',
                      transform: isPieceRotated ? 'rotate(180deg)' : 'none',
                    }}>
                      {wordStr}
                    </div>
                  );
                })()}
                {/* Abbreviated logic label */}
                {!activePiece.isKing && !activePiece.isPawn && !activePiece.isHisha && !activePiece.isKaku && (
                  <div style={{ fontSize: '5px', color: 'rgba(26, 26, 26, 0.5)', transform: 'scale(0.8)', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-cyber)', marginTop: '1px' }}>
                    {activePiece.isPromoted ? activePiece.promoted_effect.effect_name.substring(0, 4) : activePiece.effect_name.split('「').pop()?.replace('」', '').substring(0, 4)}
                  </div>
                )}
                {/* Status Badges Overlay */}
                {showTileGraphic && currentTile && (
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '2px', zIndex: 10 }}>
                    {currentTile.effectType === 'FIRE_ZONE' && (
                      <span className="text-red-500 font-black text-[9px] animate-bounce drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        🔥 炎 ({currentTile.duration})
                      </span>
                    )}
                    {currentTile.effectType === 'POISON_MUD' && (
                      <span className="text-purple-400 font-black text-[9px] animate-pulse drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        ☠️ 毒 ({currentTile.duration})
                      </span>
                    )}
                    {currentTile.effectType === 'ICE_FLOOR' && (
                      <span className="text-sky-300 font-black text-[9px] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        🧊 氷 ({currentTile.duration})
                      </span>
                    )}
                    {currentTile.effectType === 'TIME_BOMB' && (
                      <span className="text-yellow-300 font-black text-[9px] animate-ping drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                        💣 {currentTile.duration}
                      </span>
                    )}
                  </div>
                )}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '2px',
                  zIndex: 5
                }}>
                  {/* Top Row Badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    {/* Left: Promoted / Stealth */}
                    <div style={{ display: 'flex', gap: '1px' }}>
                      {activePiece.isPromoted && (
                        <span style={{
                          fontSize: '8px',
                          fontWeight: 'bold',
                          color: '#b45309', // amber-700
                          background: 'rgba(254, 243, 199, 0.95)', // amber-100
                          border: '1px solid #d97706',
                          borderRadius: '3px',
                          padding: '1px 2px',
                          transform: 'scale(0.8)',
                          transformOrigin: 'top left',
                          whiteSpace: 'nowrap'
                        }}>
                          成
                        </span>
                      )}
                      {!activePiece.isRevealed && (
                        <span style={{
                          fontSize: '8px',
                          fontWeight: 'bold',
                          color: '#4b5563', // gray-600
                          background: 'rgba(243, 244, 246, 0.95)', // gray-100
                          border: '1px solid #6b7280',
                          borderRadius: '3px',
                          padding: '1px 2px',
                          transform: 'scale(0.8)',
                          transformOrigin: 'top left',
                          whiteSpace: 'nowrap'
                        }}>
                          潜伏
                        </span>
                      )}
                    </div>
                    {/* Right: Autonomous */}
                    {isAutonomous && (
                      <span style={{
                        fontSize: '8px',
                        fontWeight: 'bold',
                        color: '#dc2626', // red-600
                        background: 'rgba(254, 226, 226, 0.95)', // red-100
                        border: '1px solid #ef4444',
                        borderRadius: '3px',
                        padding: '1px 2px',
                        transform: 'scale(0.8)',
                        transformOrigin: 'top right',
                        whiteSpace: 'nowrap'
                      }}>
                        暴走
                      </span>
                    )}
                  </div>

                  {/* Bottom Row Badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-end' }}>
                    {/* Left: Stun/Immobilize */}
                    {activePiece.stunTurnsRemaining !== undefined && activePiece.stunTurnsRemaining > 0 && (
                      <span style={{
                        fontSize: '8px',
                        fontWeight: 'bold',
                        color: '#4f46e5', // indigo-600
                        background: 'rgba(238, 242, 255, 0.95)', // indigo-50
                        border: '1px solid #6366f1',
                        borderRadius: '3px',
                        padding: '1px 2px',
                        transform: 'scale(0.8)',
                        transformOrigin: 'bottom left',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 0 4px rgba(99, 102, 241, 0.3)'
                      }}>
                        呪縛:{activePiece.stunTurnsRemaining}
                      </span>
                    )}
                    {/* Right: Cooldown / DOWN Status (Persona P5/P3R Style) */}
                    {(activePiece.coolDownTurnsRemaining > 0 || (activePiece.cooldownTurnsRemaining !== undefined && activePiece.cooldownTurnsRemaining > 0)) && (
                      activePiece.coolDownTurnsRemaining === 99 ? (
                        <span className="persona-down-badge tracking-tighter">
                          DOWN!
                        </span>
                      ) : (
                        <span className="persona-cd-badge tracking-tight">
                          CD:{activePiece.coolDownTurnsRemaining ?? activePiece.cooldownTurnsRemaining}
                        </span>
                      )
                    )}

                    {/* Awakened Badge for Promoted Pieces */}
                    {activePiece.isPromoted && (
                      <span className="bg-cyan-500 text-black font-black text-[7px] px-1 py-0.5 border border-yellow-300 transform -skew-x-12 shadow-sm">
                        AWAKENED
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Inner Ability Trigger Animations */}
                {isAnimating && activeAbilityAnimation?.theme === 'WARRIOR_IRON' && (
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    height: '2px',
                    backgroundColor: '#000000',
                    transform: 'translateY(-50%)',
                    animation: 'inkSlash 0.8s ease-in-out infinite',
                    pointerEvents: 'none',
                    zIndex: 10,
                  }} />
                )}
                {isAnimating && (activeAbilityAnimation?.theme === 'MYSTIC_MIST' || activeAbilityAnimation?.theme === 'SHADOW_NIGHT') && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.45)',
                    filter: 'blur(4px)',
                    animation: 'pulse 0.6s ease-in-out infinite',
                    pointerEvents: 'none',
                    zIndex: 10,
                  }} />
                )}
              </div>
              {/* Camp Marker Line */}
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: '100%',
                height: '3px',
                backgroundColor: activePiece.owner === 'gote' ? 'var(--color-kurogane)' : 'var(--color-shinku)',
                zIndex: 5,
              }} />
            </div>
          </div>
        );
      }
    }

    const isTarget = activeAbilityAnimation?.active &&
      activeAbilityAnimation.targets.some(([ty, tx]) => ty === y && tx === x);

    let finalCellClassName = cellClassName;
    if (activeAbilityAnimation?.active && isTarget && activeAbilityAnimation.effectType === 'DESTROY') {
      finalCellClassName += ' cell-shake';
    }

    return (
      <div
        key={`${y}-${x}`}
        className={finalCellClassName}
        style={cellStyle}
        onClick={() => onCellClick(y, x)}
        onTouchEnd={(e) => {
          e.preventDefault();
          onCellClick(y, x);
        }}
        onMouseEnter={() => {
          // activeAbilityMode 中のホバープレビュー
          if (_activeAbilityMode) {
            setHoveredAbilityCell([y, x]);
          }
          if (piece) {
            const viewer: Player = onlineMode ? (myRole || 'sente') : (vsAiMode ? 'sente' : localTurn);
            // ステルス未公開の敵駒は除く（それ以外は敵駒も含めて全駒渡す）
            const isHiddenStealth = piece.isStealth === true && piece.owner !== viewer;
            if (!isHiddenStealth) {
              onHoverPiece?.(piece);
            } else {
              onHoverPiece?.(null);
            }
          }
        }}
        onMouseLeave={() => {
          setHoveredAbilityCell(null);
          onHoverPiece?.(null);
        }}
      >
        {pieceUI}


        
        {y === 0 && (
          <div style={{
            position: 'absolute',
            top: '-15px',
            left: '50%',
            transform: shouldRotate ? 'translateX(-50%) rotate(180deg)' : 'translateX(-50%)',
            transition: 'transform 0.6s ease-in-out',
            fontSize: '8px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-cyber)'
          }}>
            {9 - x}
          </div>
        )}
        {x === BOARD_SIZE - 1 && (
          <div style={{
            position: 'absolute',
            right: '-15px',
            top: '50%',
            transform: shouldRotate ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)',
            transition: 'transform 0.6s ease-in-out',
            fontSize: '8px',
            color: 'var(--text-muted)'
          }}>
            {['一', '二', '三', '四', '五', '六', '七', '八', '九'][y]}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      transform: shouldRotate ? 'rotate(180deg)' : 'none',
      transition: 'transform 0.6s ease-in-out',
      transformOrigin: 'center center'
    }}>
      
      {/* Main Shogi Grid (9x9) */}
      <div className="shogi-board-outer" style={{
        width: '100%',
        maxWidth: 'min(620px, max(360px, calc(100vh - 180px)))',
        position: 'relative',
        padding: '15px 15px 15px 5px',
        boxSizing: 'border-box'
      }}>
        {/* 暗転オーバーレイ（発動時の「間」の演出） */}
        {activeAbilityAnimation?.active && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.12)',
            backdropFilter: 'brightness(0.75)',
            zIndex: 40,
            borderRadius: '12px',
            pointerEvents: 'none',
            animation: 'fadeIn 0.3s ease-out forwards'
          }} />
        )}

        <div style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`,
          gap: '1px',
          background: 'rgba(139, 92, 26, 0.2)',
          padding: '8px',
          borderRadius: '12px',
          border: '1.5px solid var(--color-gold)',
          boxShadow: '0 12px 36px rgba(139, 92, 26, 0.08)',
          aspectRatio: '1',
          width: '100%',
        }}>
          {/* Transparent dynamic particle canvas overlay */}
          <canvas 
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 100
            }}
          />
          {Array.from({ length: BOARD_SIZE }).map((_, y) => 
            Array.from({ length: BOARD_SIZE }).map((_, x) => renderCell(y, x))
          )}
        </div>
      </div>
    </div>
  );
};
