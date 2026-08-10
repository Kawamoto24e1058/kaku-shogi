import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { GameState, Piece, Player, Board, GameLog, HistoryState, AbilityEvent, VisualEffect } from './types';
import {
  initializeBoard,
  getValidMoves,
  executeMove,
  applyAutomatedEffect,
  interpretAbilitySpec,
  executeDrop,
  BOARD_SIZE,
  getCellLabel,
  getPieceLogicCode,
  getPieceAbilitySpec,
  getPieceTrigger,
  isTriggerMatching,
  generateId,
  getValidDropCells,
  isKingInCheck,
  getAbilityTargets,
  getPieceDescription,
  isStealthPiece,
  getEffectCells,
  getSelectableRangeCells,
  requiresTargeting,
  createEmptyTileBoard,
  applyTileEffects
} from './gameLogic';
import { PieceCreator } from './components/PieceCreator';
import { GameBoard } from './components/GameBoard';
import { ControlPanel } from './components/ControlPanel';
import { getRandomCachedPieces } from './aiGenerator';
import { StartScreen } from './components/StartScreen';
import { SakuraShower } from './components/SakuraShower';
import { PersonaCutin, type CutinType } from './components/PersonaCutin';
import { db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, collection, query, where, orderBy, limit, getDocs, deleteDoc } from 'firebase/firestore';

const getOrCreateDeviceId = (): string => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return Math.random().toString(36).substring(2, 11);
  }
  let id = localStorage.getItem('shogi_client_device_id');
  if (!id) {
    id = Math.random().toString(36).substring(2, 11);
    localStorage.setItem('shogi_client_device_id', id);
  }
  return id;
};

const AI_PIECE_WORDS = ['賢い人間', '訓練された猟犬', '防護プレート', '延焼ダイナマイト'];

const k1 = 'AQ.Ab8RN6';
const k2 = 'IgROzcO0hWqYuoeB9Olf';
const k3 = 'R-sjK6i76fvZomSfj2mvmDzw';
const geminiDefaultKey = k1 + k2 + k3;

export interface AbilityAnimationState {
  source: [number, number] | null;
  targets: [number, number][];
  theme: string | null;
  active: boolean;
  effectType?: string;
  visualEffect?: VisualEffect;
}

export const App: React.FC = () => {
  // ユーザー名の読み込み（localStorage から）
  const savedSenteName = typeof window !== 'undefined' ? (localStorage.getItem('shogi_player_name_sente') || '') : '';
  const savedGoteName  = typeof window !== 'undefined' ? (localStorage.getItem('shogi_player_name_gote')  || '') : '';

  const [activeAbilityAnimation, setActiveAbilityAnimation] = useState<AbilityAnimationState>({
    source: null,
    targets: [],
    theme: null,
    active: false,
    effectType: 'DEFAULT',
    visualEffect: undefined
  });

  const [playerNames, setPlayerNames] = useState<{ sente: string; gote: string }>({
    sente: savedSenteName,
    gote: savedGoteName,
  });

  const sanitizeForFirestore = <T,>(obj: T): T => {
    if (obj === undefined || obj === null) return obj;
    return JSON.parse(JSON.stringify(obj));
  };

  const getPlayerName = (owner: 'sente' | 'gote') => {
    return owner === 'sente'
      ? (playerNames.sente || 'プレイヤー1')
      : (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'));
  };

  const [state, setState] = useState<GameState>({
    board: initializeBoard(),
    tileBoard: createEmptyTileBoard(),
    turn: 'sente',
    phase: 'start',
    customPieces: { sente: [], gote: [] },
    customDecks: { sente: [], gote: [] },
    destroyedPieces: [],
    capturedPieces: { sente: [], gote: [] },
    sharedPieces: [],
    selectedCell: null,
    activeAbilityMode: false,
    activeAbilitySource: null,
    activeAbilityTargets: [],
    winner: null,
    logs: [],
    historyStates: [],
    geminiApiKey: geminiDefaultKey,
    playerNames: { sente: savedSenteName, gote: savedGoteName },
    promotionPending: null,
  });

  const [setupSubPhase, setSetupSubPhase] = useState<'sente_create' | 'gote_create'>('sente_create');
  const [turnChangeAlert, setTurnChangeAlert] = useState<'sente' | 'gote' | null>(null);

  // ターン交代サイバーアラートのトリガー
  useEffect(() => {
    if (state.phase === 'playing' && !state.winner) {
      setTurnChangeAlert(state.turn);
      const timer = setTimeout(() => {
        setTurnChangeAlert(null);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [state.turn, state.phase, state.winner]);

  const [piecesToPlace, setPiecesToPlace] = useState<{ sente: Piece[]; gote: Piece[] }>({
    sente: [],
    gote: [],
  });
  
  const [selectedCapturedPiece, setSelectedCapturedPiece] = useState<{ piece: Piece; index: number } | null>(null);
  const [selectedSharedPiece, setSelectedSharedPiece] = useState<{ piece: Piece; index: number } | null>(null);
  const [selectedCustomDeckPiece, setSelectedCustomDeckPiece] = useState<{ piece: Piece; index: number } | null>(null);
  const [hoveredPiece, setHoveredPiece] = useState<Piece | null>(null);
  const [validMoves, setValidMoves] = useState<[number, number][]>([]);
  const [vsAiMode, setVsAiMode] = useState<boolean>(true);
  const [onlineMode, setOnlineMode] = useState<boolean>(false);
  const [roomCode, setRoomCode] = useState<string>('');
  const [myRole, setMyRole] = useState<'sente' | 'gote' | null>(null);
  const [isWaitingForOpponent, setIsWaitingForOpponent] = useState<boolean>(false);
  const [isSearchingMatch, setIsSearchingMatch] = useState<boolean>(false);
  const [isRandomMatch, setIsRandomMatch] = useState<boolean>(false);
  const [isConnectingHandshake, setIsConnectingHandshake] = useState<boolean>(false);
  const [matchmakingError, setMatchmakingError] = useState<string>('');
  const [matchDoc, setMatchDoc] = useState<any>(null);
  const matchmakingTimeoutRef = useRef<any>(null);

  const [suspendedAbility, setSuspendedAbility] = useState<{
    source: [number, number];
    targets: [number, number][];
    type: 'transform' | 'mind_control' | 'swap' | 'resurrect';
    triggerType: 'ON_MOVE' | 'TURN_START';
    fromPosition?: [number, number];
    board: Board;
    capturedPieces: typeof state.capturedPieces;
    logs: GameLog[];
    customStateUpdates?: Partial<GameState>;
    remainingEvents?: AbilityEvent[];
  } | null>(null);

  const isPieceOwnerHuman = (owner: Player): boolean => {
    if (onlineMode) {
      return owner === myRole;
    }
    if (vsAiMode) {
      return owner === 'sente';
    }
    return true; // Local PvP: both Sente and Gote are human
  };

  const processAbilityEventsQueue = async (
    currentBoard: Board,
    eventQueue: AbilityEvent[],
    currentCaptured: typeof state.capturedPieces,
    currentShared: Piece[],
    currentLogs: GameLog[],
    currentDestroyed: Piece[]
  ) => {
    // Sort events: (1) ON_TAKEN (priority 1), (2) ON_MOVE (priority 2), (3) others (priority 3)
    eventQueue.sort((a, b) => {
      const getPriority = (trigger: string) => {
        if (trigger === 'ON_TAKEN') return 1;
        if (trigger === 'ON_MOVE') return 2;
        return 3;
      };
      return getPriority(a.triggerType) - getPriority(b.triggerType);
    });

    const isPieceAlive = (board: Board, id: string): [number, number] | null => {
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c]?.id === id) {
            return [r, c];
          }
        }
      }
      return null;
    };

    // Scan original king positions before processing for explosion effects
    let prevSenteKingPos: [number, number] | null = null;
    let prevGoteKingPos: [number, number] | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = currentBoard[r][c];
        if (p?.isKing) {
          if (p.owner === 'sente') prevSenteKingPos = [r, c];
          else prevGoteKingPos = [r, c];
        }
      }
    }

    let boardState = currentBoard;
    let capturedState = { sente: [...currentCaptured.sente], gote: [...currentCaptured.gote] };
    let sharedState = [...currentShared];
    let logsState = [...currentLogs];
    let destroyedState = [...currentDestroyed];
    let reActionTriggered = false;

    const delayVal = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const triggerAnimationsBackground = async (
      list: {
        source: [number, number] | null;
        targets: [number, number][];
        theme: string | null;
        effectType?: string;
        visualEffect?: VisualEffect;
      }[]
    ) => {
      for (const anim of list) {
        setActiveAbilityAnimation({
          source: anim.source,
          targets: anim.targets,
          theme: anim.theme,
          active: true,
          effectType: anim.effectType || 'DEFAULT',
          visualEffect: anim.visualEffect
        });
        const shakePower = anim.visualEffect ? anim.visualEffect.screen_shake : 0;
        if (shakePower > 0) {
          setScreenShakeIntensity(shakePower * 2.5);
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 400);
        }
        await delayVal(500);
      }
      setActiveAbilityAnimation({
        source: null,
        targets: [],
        theme: null,
        active: false,
        effectType: 'DEFAULT',
        visualEffect: undefined
      });
    };

    const animationsToPlay: {
      source: [number, number] | null;
      targets: [number, number][];
      theme: string | null;
      effectType?: string;
      visualEffect?: VisualEffect;
    }[] = [];

    let suspended = false;

    for (let i = 0; i < eventQueue.length; i++) {
      const event = eventQueue[i];

      // 1. "死人に口なしルール" (No speech for the dead)
      if (event.triggerType === 'ON_TAKEN') {
        const [ay, ax] = event.attackerPiecePos!;
        const attackerOnBoard = boardState[ay][ax];
        if (!attackerOnBoard || attackerOnBoard.id !== event.attackerPieceId) {
          console.log(`Skipping ON_TAKEN event ${event.id}: Attacker piece is no longer at position.`);
          continue;
        }
      } else if (event.triggerType === 'ON_APPROACH') {
        const [ty, tx] = event.position;
        const trapOnBoard = boardState[ty][tx];
        if (!trapOnBoard || trapOnBoard.id !== event.pieceId) {
          console.log(`Skipping ON_APPROACH event ${event.id}: Trap piece is no longer at position.`);
          continue;
        }
        const [ay, ax] = event.attackerPiecePos!;
        const attackerOnBoard = boardState[ay][ax];
        if (!attackerOnBoard || attackerOnBoard.id !== event.attackerPieceId) {
          console.log(`Skipping ON_APPROACH event ${event.id}: Attacker piece is no longer at position.`);
          continue;
        }
      } else if (event.triggerType !== 'ON_DEATH') {
        const livePos = isPieceAlive(boardState, event.pieceId);
        if (!livePos) {
          console.log(`Skipping ${event.triggerType} event ${event.id}: Piece is no longer alive on board (dead).`);
          continue;
        }
        // Update coordinates in case it was relocated by a previous ability
        event.position = livePos;
      }

      // 1.5 Collect animation details
      const animPos = (event.triggerType === 'ON_TAKEN' || event.triggerType === 'ON_APPROACH' || event.triggerType === 'ON_DEATH') 
        ? event.position 
        : isPieceAlive(boardState, event.pieceId);
      const animPiece = (event.triggerType === 'ON_DEATH' && event.targetCellPiece)
        ? event.targetCellPiece
        : (animPos ? boardState[animPos[0]][animPos[1]] : null);
      let animTargets: [number, number][] = [];

      const isCustomAnimStart = animPiece && !animPiece.isKing && !animPiece.isPawn && !animPiece.isHisha && !animPiece.isKaku;
      if (animPiece && isCustomAnimStart) {
        const spec = getPieceAbilitySpec(animPiece);
        if (event.triggerType === 'ON_TAKEN' || event.triggerType === 'ON_DEATH') {
          if (spec) {
            animTargets = getEffectCells(event.position[0], event.position[1], spec.area_shape, event.position[0], event.position[1], event.owner, boardState, spec.effect_offsets);
          } else if (animPiece.custom_ability) {
            const affected: [number, number][] = [];
            const seen = new Set<string>();
            for (const shape of animPiece.custom_ability.targets) {
              const cells = getEffectCells(event.position[0], event.position[1], shape, event.position[0], event.position[1], event.owner, boardState, animPiece.custom_ability.effect_offsets);
              for (const cell of cells) {
                const key = `${cell[0]},${cell[1]}`;
                if (!seen.has(key)) { seen.add(key); affected.push(cell); }
              }
            }
            animTargets = affected;
          } else {
            animTargets = [event.position];
          }
        } else if (event.triggerType === 'ON_APPROACH') {
          if (spec) {
            animTargets = getEffectCells(event.position[0], event.position[1], spec.area_shape, event.position[0], event.position[1], event.owner, boardState, spec.effect_offsets);
          } else if (animPiece.custom_ability) {
            const affected: [number, number][] = [];
            const seen = new Set<string>();
            for (const shape of animPiece.custom_ability.targets) {
              const cells = getEffectCells(event.position[0], event.position[1], shape, event.position[0], event.position[1], event.owner, boardState, animPiece.custom_ability.effect_offsets);
              for (const cell of cells) {
                const key = `${cell[0]},${cell[1]}`;
                if (!seen.has(key)) { seen.add(key); affected.push(cell); }
              }
            }
            animTargets = affected;
          } else {
            animTargets = [event.position];
          }
        } else if (animPos) {
          const targetsInfo = getAbilityTargets(boardState, animPos, event.owner, sharedState);
          const willSuspend = targetsInfo && isPieceOwnerHuman(event.owner);
          if (willSuspend) {
            animTargets = [];
          } else if (spec) {
            let cy = animPos[0], cx = animPos[1];
            if (spec.target_selection !== 'SELF') {
              const selectable = getSelectableRangeCells(animPos[0], animPos[1], spec.range, spec.affects_who, boardState, event.owner);
              if (selectable.length > 0) {
                [cy, cx] = selectable[0];
              }
            }
            animTargets = getEffectCells(cy, cx, spec.area_shape, animPos[0], animPos[1], event.owner, boardState, spec.effect_offsets);
          } else if (animPiece.custom_ability) {
            const affected: [number, number][] = [];
            const seen = new Set<string>();
            for (const shape of animPiece.custom_ability.targets) {
              const cells = getEffectCells(animPos[0], animPos[1], shape, animPos[0], animPos[1], event.owner, boardState, animPiece.custom_ability.effect_offsets);
              for (const cell of cells) {
                const key = `${cell[0]},${cell[1]}`;
                if (!seen.has(key)) { seen.add(key); affected.push(cell); }
              }
            }
            animTargets = affected;
          } else {
            if (targetsInfo) {
              animTargets = targetsInfo.targets;
            }
          }
        }
        
        let effectType = 'DEFAULT';
        if (spec) {
          effectType = spec.effect_type;
        } else if (animPiece.custom_ability) {
          const actions = animPiece.custom_ability.actions;
          if (actions.includes('DESTROY')) {
            effectType = 'DESTROY';
          } else if (actions.includes('FREEZE')) {
            effectType = 'IMMOBILIZE';
          } else if (actions.includes('KNOCKBACK') || actions.includes('KNOCKBACK_MAX')) {
            effectType = 'PUSH';
          } else if (actions.includes('SWAP_POSITION')) {
            effectType = 'SWAP';
          } else if (actions.includes('PULL_1')) {
            effectType = 'PULL';
          } else if (actions.includes('RE_ACTION')) {
            effectType = 'RE_ACTION';
          }
        } else {
          const logic = getPieceLogicCode(animPiece);
          const desc = getPieceDescription(animPiece);
          if (logic.includes('blast') || logic.includes('explode') || desc.includes('爆発') || desc.includes('爆破') || desc.includes('自爆')) {
            effectType = 'DESTROY';
          } else if (logic.includes('stun') || desc.includes('スタン') || desc.includes('封印') || desc.includes('行動封印') || desc.includes('呪縛')) {
            effectType = 'IMMOBILIZE';
          } else if (logic.includes('swap') || desc.includes('交代') || desc.includes('入替') || desc.includes('瞬間移動')) {
            effectType = 'SWAP';
          } else if (logic.includes('pull') || desc.includes('引き寄せ')) {
            effectType = 'PULL';
          } else if (logic.includes('push') || desc.includes('押し出し') || logic.includes('charge')) {
            effectType = 'PUSH';
          }
        }
        
        const visualEffect = animPiece.isPromoted ? animPiece.promoted_effect?.visual_effect : animPiece.visual_effect;
        animationsToPlay.push({
          source: animPos,
          targets: animTargets,
          theme: animPiece.visual_theme || null,
          effectType,
          visualEffect
        });
      }

      // 2. Check if the ability is interactive (needs human target selection during THEIR OWN TURN only)
      if ((event.triggerType === 'ON_MOVE' || event.triggerType === 'TURN_START') && event.owner === state.turn) {
        const animPiece = boardState[event.position[0]][event.position[1]];
        const needsTargeting = animPiece ? requiresTargeting(animPiece) : false;
        const targetsInfo = needsTargeting ? getAbilityTargets(boardState, event.position, event.owner, sharedState) : null;
        if (needsTargeting && targetsInfo && isPieceOwnerHuman(event.owner)) {
          // Suspend queue execution & enter SELECTING_ABILITY_TARGET phase!
          const remainingEvents = eventQueue.slice(i + 1);
          setSuspendedAbility({
            source: event.position,
            targets: targetsInfo.targets,
            type: targetsInfo.type,
            triggerType: event.triggerType,
            fromPosition: event.fromPosition,
            board: boardState,
            capturedPieces: capturedState,
            logs: logsState,
            customStateUpdates: {
              destroyedPieces: destroyedState
            },
            remainingEvents: remainingEvents
          });

          setState(prev => ({
            ...prev,
            phase: 'SELECTING_ABILITY_TARGET',
            board: boardState,
            capturedPieces: capturedState,
            destroyedPieces: destroyedState,
            sharedPieces: sharedState,
            selectedCell: null,
            activeAbilityMode: true,
            activeAbilitySource: event.position,
            activeAbilityTargets: targetsInfo.targets,
            logs: logsState
          }));

          // Trigger animation queue built up to this point in the background
          triggerAnimationsBackground(animationsToPlay);

          suspended = true;
          break; // Stop queue execution, wait for user click!
        }
      }

      // 3. Automated Ability Execution
      if (event.triggerType === 'ON_TAKEN') {
        const [ty, tx] = event.position;
        const trapPiece = event.targetCellPiece!;
        const tempBoard = boardState.map(row => [...row]);
        tempBoard[ty][tx] = { ...trapPiece, isRevealed: true };
        
        const trapEffectRes = applyAutomatedEffect(
          tempBoard,
          [ty, tx],
          'ON_TAKEN',
          event.owner,
          [],
          undefined,
          undefined,
          [...destroyedState],
          sharedState,
          undefined,
          event.targetCellPiece,
          capturedState[event.owner === 'sente' ? 'gote' : 'sente']
        );

        if (trapEffectRes.triggered) {
          boardState = trapEffectRes.board;
          if (trapEffectRes.capturedPieces && trapEffectRes.capturedPieces.length > 0) {
            capturedState[event.owner] = [...capturedState[event.owner], ...trapEffectRes.capturedPieces];
          }
          if (trapEffectRes.opponentCapturedPieces) {
            capturedState[event.owner === 'sente' ? 'gote' : 'sente'] = trapEffectRes.opponentCapturedPieces;
          }
          if (trapEffectRes.graveyard) {
            sharedState = trapEffectRes.graveyard;
          }
          logsState.push(...trapEffectRes.logs.map(l => ({
            ...l,
            id: generateId(),
            timestamp: new Date().toLocaleTimeString()
          })));

          // Remove the captured trap from hands
          capturedState[event.owner] = capturedState[event.owner].filter(p => p.id !== event.pieceId);
          capturedState[event.owner === 'sente' ? 'gote' : 'sente'] = capturedState[event.owner === 'sente' ? 'gote' : 'sente'].filter(p => p.id !== event.pieceId);
        } else if (
          (trapPiece.trigger === 'ON_TAKEN' || (trapPiece.custom_ability?.triggers && trapPiece.custom_ability.triggers.includes('ON_TAKEN'))) &&
          (
            trapPiece.logic_code === 'self_destruct_trap' ||
            trapPiece.logic_code === 'curse_retaliation' ||
            (trapPiece.description || '').includes('道連れ') ||
            (trapPiece.description || '').includes('自爆')
          )
        ) {
          // Default self-destruct if no custom effect triggered:
          const attackerOnBoard = boardState[ty][tx];
          if (attackerOnBoard) {
            destroyedState.push({ ...attackerOnBoard });
            sharedState.push({
              ...attackerOnBoard,
              isPromoted: attackerOnBoard.isPromoted,
              coolDownTurnsRemaining: 0,
              isRevealed: true,
              stunTurnsRemaining: 0,
              deathCountdown: 0
            });
          }
          destroyedState.push({ ...trapPiece });
          sharedState.push({
            ...trapPiece,
            isPromoted: trapPiece.isPromoted,
            coolDownTurnsRemaining: 0,
            isRevealed: true,
            stunTurnsRemaining: 0,
            deathCountdown: 0
          });

          boardState[ty][tx] = null;

          const logMsg = isStealthPiece(trapPiece)
            ? `【罠発動】移動先の駒は罠「${trapPiece.effect_name}」でした！道連れになり、両者消滅しました！`
            : `【呪詛発動】呪い「${trapPiece.effect_name}」が発動！道連れになり、両者消滅しました！`;
          logsState.push({
            id: generateId(),
            timestamp: new Date().toLocaleTimeString(),
            player: event.owner,
            message: logMsg,
            type: 'ability'
          });

          // Remove the captured trap from hands
          capturedState[event.owner] = capturedState[event.owner].filter(p => p.id !== event.pieceId);
          capturedState[event.owner === 'sente' ? 'gote' : 'sente'] = capturedState[event.owner === 'sente' ? 'gote' : 'sente'].filter(p => p.id !== event.pieceId);

          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 300);
        }

      } else if (event.triggerType === 'ON_APPROACH') {
        const [ny, nx] = event.position;
        const trapPiece = boardState[ny][nx]!;

        // Reveal the trap first
        boardState[ny][nx] = {
          ...trapPiece,
          isRevealed: true
        };

        logsState.push({
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: event.owner,
          message: `【接近開示】${getCellLabel(ny, nx)} に潜む罠「${trapPiece.effect_name}」が接近により発動し、姿が露見しました！`,
          type: 'ability'
        });

        const trapEffectRes = applyAutomatedEffect(
          boardState,
          [ny, nx],
          'ON_APPROACH',
          event.owner,
          [],
          undefined,
          undefined,
          [...destroyedState],
          sharedState,
          undefined,
          undefined,
          capturedState[event.owner === 'sente' ? 'gote' : 'sente']
        );

        if (trapEffectRes.triggered) {
          boardState = trapEffectRes.board;
          if (trapEffectRes.capturedPieces && trapEffectRes.capturedPieces.length > 0) {
            capturedState[event.owner] = [...capturedState[event.owner], ...trapEffectRes.capturedPieces];
          }
          if (trapEffectRes.opponentCapturedPieces) {
            capturedState[event.owner === 'sente' ? 'gote' : 'sente'] = trapEffectRes.opponentCapturedPieces;
          }
          if (trapEffectRes.graveyard) {
            sharedState = trapEffectRes.graveyard;
          }
          logsState.push(...trapEffectRes.logs.map(l => ({
            ...l,
            id: generateId(),
            timestamp: new Date().toLocaleTimeString()
          })));
        }
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 300);

      } else {
        const graveyardCandidates = [
          ...capturedState[event.owner],
          ...destroyedState.filter(piece => piece.owner !== event.owner)
        ];

        const effectRes = applyAutomatedEffect(
          boardState,
          event.position,
          event.triggerType,
          event.owner,
          capturedState[event.owner],
          event.fromPosition,
          undefined,
          graveyardCandidates,
          sharedState,
          undefined,
          event.targetCellPiece,
          capturedState[event.owner === 'sente' ? 'gote' : 'sente']
        );

        if (effectRes.triggered || effectRes.logs.length > 0) {
          if (effectRes.triggered) {
            boardState = effectRes.board;
            capturedState[event.owner] = effectRes.capturedPieces;
            if (effectRes.opponentCapturedPieces) {
              capturedState[event.owner === 'sente' ? 'gote' : 'sente'] = effectRes.opponentCapturedPieces;
            }
            if (effectRes.graveyard) {
              sharedState = effectRes.graveyard;
            }
            if (effectRes.reAction) {
              reActionTriggered = true;
            }
            setScreenShake(true);
            setTimeout(() => setScreenShake(false), 300);
          }
          logsState.push(...effectRes.logs.map(l => ({
            ...l,
            id: generateId(),
            timestamp: new Date().toLocaleTimeString()
          })));
        }
      }
    }

    if (suspended) {
      return;
    }

    // Trigger all collected background animations (fire-and-forget)
    triggerAnimationsBackground(animationsToPlay);

    // 4. Finalize the turn once all events have processed
    const senteKing = boardState.some(row => row.some(p => p?.isKing && p.owner === 'sente'));
    const goteKing = boardState.some(row => row.some(p => p?.isKing && p.owner === 'gote'));
    let isGameOver = false;
    let finalWinner: Player | null = null;

    if (!senteKing && !goteKing) {
      isGameOver = true;
      finalWinner = state.turn === 'sente' ? 'gote' : 'sente';
    } else if (!senteKing) {
      isGameOver = true;
      finalWinner = 'gote';
    } else if (!goteKing) {
      isGameOver = true;
      finalWinner = 'sente';
    }

    // === ステルス近接スキャンを実行 ===
    boardState = scanStealthPieces(boardState, logsState);

    const isTurnStartQueue = eventQueue.some(e => e.triggerType === 'TURN_START');

    if (isGameOver) {
      // Trigger multi-glitch explosion effects at the position of the destroyed King
      const destroyedKingPositions: [number, number][] = [];
      if (!senteKing && prevSenteKingPos) destroyedKingPositions.push(prevSenteKingPos);
      if (!goteKing && prevGoteKingPos) destroyedKingPositions.push(prevGoteKingPos);

      if (destroyedKingPositions.length > 0) {
        for (const [ky, kx] of destroyedKingPositions) {
          setExplosionEffects(prev => [...prev, [ky, kx]]);
          setTimeout(() => setExplosionEffects(prev => [...prev, [ky - 1 >= 0 ? ky - 1 : ky, kx], [ky, kx + 1 < BOARD_SIZE ? kx + 1 : kx]]), 150);
          setTimeout(() => setExplosionEffects(prev => [...prev, [ky + 1 < BOARD_SIZE ? ky + 1 : ky, kx], [ky, kx - 1 >= 0 ? kx - 1 : kx]]), 300);
        }
        
        setScreenShake(true);
        setTimeout(() => {
          setScreenShake(false);
          for (const [ky, kx] of destroyedKingPositions) {
            setExplosionEffects(prev => prev.filter(coord => Math.abs(coord[0] - ky) > 1 || Math.abs(coord[1] - kx) > 1));
          }
        }, 1200);
      }

      setState(prev => ({
        ...prev,
        board: boardState,
        capturedPieces: capturedState,
        destroyedPieces: destroyedState,
        selectedCell: null,
        promotionPending: null,
        winner: finalWinner
      }));

      saveHistorySnapshot(boardState, capturedState, state.turn, logsState, state.customDecks, destroyedState);
      syncOnlineState(
        boardState,
        state.turn,
        'finished',
        finalWinner,
        capturedState,
        sharedState,
        state.customDecks,
        destroyedState,
        logsState
      );
    } else {
      if (isTurnStartQueue) {
        const activePlayer = eventQueue[0].owner;
        const isChecked = isKingInCheck(boardState, activePlayer);
        if (isChecked) {
          logsState.push({
            id: generateId(),
            timestamp: new Date().toLocaleTimeString(),
            player: activePlayer,
            message: `🚨 王手！${getPlayerName(activePlayer)}の玉将が狙われています！`,
            type: 'system'
          });
          setShowCheckOverlay(true);
        }

        setState(prev => {
          const nextState = {
            ...prev,
            board: boardState,
            capturedPieces: capturedState,
            sharedPieces: sharedState,
            destroyedPieces: destroyedState,
            turn: activePlayer,
            selectedCell: null,
            activeAbilityMode: false,
            activeAbilitySource: null,
            activeAbilityTargets: [],
            logs: logsState,
          };
          saveHistorySnapshot(boardState, capturedState, activePlayer, logsState, state.customDecks, destroyedState);
          return nextState;
        });

        setValidMoves([]);

        syncOnlineState(
          boardState,
          activePlayer,
          'playing',
          null,
          capturedState,
          sharedState,
          state.customDecks,
          destroyedState,
          logsState
        );
      } else if (reActionTriggered) {
        // Skip switching players! Keep current player (state.turn)
        setState(prev => {
          const nextState = {
            ...prev,
            board: boardState,
            capturedPieces: capturedState,
            sharedPieces: sharedState,
            destroyedPieces: destroyedState,
            selectedCell: null,
            activeAbilityMode: false,
            activeAbilitySource: null,
            activeAbilityTargets: [],
            logs: logsState,
          };
          saveHistorySnapshot(boardState, capturedState, state.turn, logsState, state.customDecks, destroyedState);
          return nextState;
        });

        syncOnlineState(
          boardState,
          state.turn,
          'playing',
          null,
          capturedState,
          sharedState,
          state.customDecks,
          destroyedState,
          logsState
        );
      } else {
        finalizeTurn(
          boardState,
          capturedState,
          sharedState,
          logsState,
          { promotionPending: null },
          state.customDecks,
          destroyedState,
          true
        );
      }
    }
  };

  const adjacentOffsets: [number, number][] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  const scanStealthPieces = (board: Board, logs: GameLog[]): Board => {
    return board.map((row, y) =>
      row.map((piece, x) => {
        if (
          piece &&
          isStealthPiece(piece) &&
          piece.owner !== undefined &&
          (piece.owner === 'sente' || piece.owner === 'gote')
        ) {
          let hasAdjacentOpponent = false;
          for (const [dy, dx] of adjacentOffsets) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < BOARD_SIZE && nx >= 0 && nx < BOARD_SIZE) {
              const adjPiece = board[ny][nx];
              if (
                adjPiece &&
                adjPiece.owner !== undefined &&
                (adjPiece.owner === 'sente' || adjPiece.owner === 'gote') &&
                adjPiece.owner !== piece.owner
              ) {
                hasAdjacentOpponent = true;
                break;
              }
            }
          }

          if (!piece.isRevealed && hasAdjacentOpponent) {
            logs.push({
              id: generateId(),
              timestamp: new Date().toLocaleTimeString(),
              player: piece.owner,
              message: `👁️ 【気配感知】${getPlayerName(piece.owner)}の『${piece.word}』の周囲1マス以内に敵が侵入したため、ステルスが解除され姿が露見しました！`,
              type: 'ability'
            });
            return { ...piece, isRevealed: true, isStealth: false };
          }

          if (piece.isRevealed && !hasAdjacentOpponent) {
            logs.push({
              id: generateId(),
              timestamp: new Date().toLocaleTimeString(),
              player: piece.owner,
              message: `🌫️ 【再隠蔽】${getPlayerName(piece.owner)}の『${piece.word}』の周囲から敵が立ち去ったため、再びステルス状態（透明）に戻りました。`,
              type: 'ability'
            });
            return { ...piece, isRevealed: false, isStealth: true };
          }
        }
        return piece;
      })
    );
  };

  const isPromotionEligible = (
    piece: Piece,
    fromY: number,
    toY: number,
    owner: Player
  ): boolean => {
    if (piece.isKing || piece.isPromoted) return false;
    if (owner === 'sente') {
      return fromY <= 2 || toY <= 2;
    } else {
      return fromY >= 6 || toY >= 6;
    }
  };

  const mustPromote = (
    piece: Piece,
    toY: number,
    owner: Player
  ): boolean => {
    const isRealPawn = piece.isPawn && (piece.word === '歩' || piece.word === '歩兵' || piece.word === 'と金' || piece.word === '封印歩兵');
    if (isRealPawn) {
      if (owner === 'sente' && toY === 0) return true;
      if (owner === 'gote' && toY === 8) return true;
    }
    return false;
  };

  const isAutoNormalMover = (p: Piece | null): boolean => {
    if (!p) return false;
    if (p.isAutonomous === true || p.custom_ability?.isAutonomous === true) return true;
    const logicCode = getPieceLogicCode(p);
    const desc = p.description || '';
    return (p.trigger === 'ALWAYS' && (logicCode.includes('runaway') || desc.includes('操作不能'))) ||
           desc.includes('勝手に動く') || desc.includes('暴れ馬') || desc.includes('指示を聞かない') || desc.includes('気まぐれ');
  };

  const isAutonomous = (p: Piece | null): boolean => {
    if (!p) return false;
    if (p.isAutonomous === true || p.custom_ability?.isAutonomous === true) return true;
    const logicCode = getPieceLogicCode(p);
    return logicCode === 'random_teleport' || isAutoNormalMover(p);
  };


  const executeMoveWithPromotion = async (
    sy: number,
    sx: number,
    y: number,
    x: number,
    promote: boolean
  ) => {
    let res;
    try {
      res = executeMove(state.board, [sy, sx], [y, x], state.turn, promote, playerNames, vsAiMode, true, state.capturedPieces);
    } catch (err) {
      console.error("Failed to execute move:", err);
      setState(prev => ({
        ...prev,
        promotionPending: null,
        selectedCell: null
      }));
      return;
    }

    if (res.bombTriggered) {
      setExplosionEffects(prev => [...prev, [y, x]]);
      setScreenShake(true);
      setTimeout(() => {
        setScreenShake(false);
        setExplosionEffects(prev => prev.filter(coord => coord[0] !== y || coord[1] !== x));
      }, 600);
    }

    let nextCaptured = { ...state.capturedPieces };
    const capturedList: Piece[] = [];
    if (res.capturedPieces && res.capturedPieces.length > 0) {
      capturedList.push(...res.capturedPieces);
    } else if (res.capturedPiece) {
      capturedList.push(res.capturedPiece);
    }

    for (const cap of capturedList) {
      if (cap) {
        const isStillOnBoard = res.board.some(row => row.some(p => p?.id === cap.id));
        if (!isStillOnBoard) {
          const cleanCap = {
            ...cap,
            isPromoted: false,
            coolDownTurnsRemaining: 0,
            isRevealed: true
          };
          if (!nextCaptured[cleanCap.owner].some(p => p.id === cleanCap.id)) {
            nextCaptured[cleanCap.owner] = [...nextCaptured[cleanCap.owner], cleanCap];
          }
        }
      }
    }

    let nextShared = [...state.sharedPieces];
    if (res.destroyedPieces && res.destroyedPieces.length > 0) {
      for (const p of res.destroyedPieces) {
        if (p && !p.isKing) {
          if (!nextShared.some(s => s.id === p.id)) {
            nextShared.push({
              ...p,
              isPromoted: p.isPromoted,
              coolDownTurnsRemaining: 0,
              isRevealed: true,
              stunTurnsRemaining: 0,
              deathCountdown: 0
            });
          }
        }
      }
    }

    const nextDestroyedPieces = [...state.destroyedPieces, ...(res.destroyedPieces || [])];
    const finalLogs = [...state.logs, ...res.logs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() }))];

    const events = [...(res.abilityEvents || [])];
    const landingPiece = res.board[y][x];
    if (landingPiece && landingPiece.owner === state.turn) {
      const cd = landingPiece.coolDownTurnsRemaining ?? landingPiece.cooldownTurnsRemaining ?? 0;
      const uses = landingPiece.remaining_uses ?? landingPiece.usesRemaining ?? 3;
      if (cd === 0 && uses > 0) {
        if (isTriggerMatching(landingPiece, 'ON_MOVE')) {
          events.push({
            id: generateId(),
            priority: 2,
            triggerType: 'ON_MOVE',
            pieceId: landingPiece.id,
            position: [y, x],
            owner: landingPiece.owner,
            fromPosition: [sy, sx]
          });
        }
        if (promote || landingPiece.isPromoted) {
          if (isTriggerMatching(landingPiece, 'ON_PROMOTE')) {
            events.push({
              id: generateId(),
              priority: 1,
              triggerType: 'ON_PROMOTE',
              pieceId: landingPiece.id,
              position: [y, x],
              owner: landingPiece.owner,
              fromPosition: [sy, sx]
            });
          }
        }
      }
    }

    // Apply tile effects (fire, poison, ice, bomb)
    const tileRes = applyTileEffects(res.board, state.tileBoard, state.turn, finalLogs);
    res.board = tileRes.board;

    // Process the asynchronous queue!
    await processAbilityEventsQueue(res.board, events, nextCaptured, nextShared, finalLogs, nextDestroyedPieces);
  };

  const handlePromotionDecision = (promote: boolean) => {
    if (!state.promotionPending) return;
    const { from, to } = state.promotionPending;
    const [sy, sx] = from;
    const [y, x] = to;

    const movingPiece = state.board[sy][sx];
    if (!movingPiece || movingPiece.owner !== state.turn) {
      console.warn("handlePromotionDecision ignored: piece is no longer at start coordinates or turn has changed.");
      setState(prev => ({ ...prev, promotionPending: null }));
      return;
    }

    executeMoveWithPromotion(sy, sx, y, x, promote);
  };

  // FX visual states
  const [screenShake, setScreenShake] = useState(false);
  const [screenShakeIntensity, setScreenShakeIntensity] = useState(4);
  const [laserEffect] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [explosionEffects, setExplosionEffects] = useState<[number, number][]>([]);
  const [showCheckOverlay, setShowCheckOverlay] = useState<boolean>(false);

  // Persona 5 / P3R Styled Cutin State + Async Execution Gate
  const [cutinState, setCutinState] = useState<{
    type: CutinType | null;
    title?: string;
    subtitle?: string;
    comboHits?: string[];
    gambleResult?: 'SUCCESS' | 'MISS';
  }>({ type: null });
  const [isCutinPlaying, setIsCutinPlaying] = useState<boolean>(false);
  const cutinResolverRef = useRef<(() => void) | null>(null);

  const triggerCutinWithGate = (params: {
    type: CutinType;
    title?: string;
    subtitle?: string;
    comboHits?: string[];
    gambleResult?: 'SUCCESS' | 'MISS';
  }): Promise<void> => {
    return new Promise(resolve => {
      cutinResolverRef.current = resolve;
      setIsCutinPlaying(true);
      setCutinState(params);
    });
  };

  const handleCutinComplete = () => {
    setCutinState({ type: null });
    setIsCutinPlaying(false);
    if (cutinResolverRef.current) {
      cutinResolverRef.current();
      cutinResolverRef.current = null;
    }
  };

  useEffect(() => {
    if (showCheckOverlay) {
      const timer = setTimeout(() => setShowCheckOverlay(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [showCheckOverlay]);

  // ─── Firebase オンライン対局同期 ───

  // 1. 部屋作成処理
  const handleCreateRoom = async () => {
    setMatchmakingError('');
    try {
      let code = '';
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 10) {
        code = Math.floor(100000 + Math.random() * 900000).toString();
        const docRef = doc(db, 'matches', code);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
          isUnique = true;
        }
        attempts++;
      }

      if (!isUnique) {
        throw new Error('部屋コードの生成に失敗しました。もう一度お試しください。');
      }

      const clientDeviceId = getOrCreateDeviceId();
      const initialB = initializeBoard();
      const senteName = playerNames.sente || 'プレイヤー1';

      const docRef = doc(db, 'matches', code);
      await setDoc(docRef, {
        id: code,
        status: 'waiting',
        senteDeviceId: clientDeviceId,
        goteDeviceId: null,
        senteName: senteName,
        goteName: '',
        senteWords: [],
        goteWords: [],
        sentePiecesReady: false,
        gotePiecesReady: false,
        sentePieces: null,
        gotePieces: null,
        board: JSON.stringify(initialB),
        turn: 'sente',
        winner: null,
        logsJson: JSON.stringify([]),
        capturedPieces: JSON.stringify({ sente: [], gote: [] }),
        sharedPieces: JSON.stringify([]),
        logs: [
          { player: 'system', message: `対局室 (部屋コード: ${code}) が作成されました。`, type: 'system' },
          { player: 'system', message: '対戦相手の入室を待っています…', type: 'system' }
        ],
        lastUpdated: Date.now()
      });

      setRoomCode(code);
      setMyRole('sente');
      setIsWaitingForOpponent(true);
      setIsRandomMatch(false);
      setVsAiMode(false);
      setOnlineMode(true);
    } catch (err: any) {
      console.error(err);
      setMatchmakingError(err.message || '部屋の作成中にエラーが発生しました。');
    }
  };

  // 2. 部屋入室処理
  const handleJoinRoom = async (code: string) => {
    setMatchmakingError('');
    if (code.length !== 6) {
      setMatchmakingError('部屋コードは6桁の数字です。');
      return;
    }
    try {
      const docRef = doc(db, 'matches', code);
      const snap = await getDoc(docRef);
      if (!snap.exists()) {
        setMatchmakingError('指定された対局室が見つかりません。');
        return;
      }

      const data = snap.data();
      if (data.status !== 'waiting') {
        setMatchmakingError('この対局室はすでに満室か、対局が開始されています。');
        return;
      }

      const clientDeviceId = getOrCreateDeviceId();
      const goteName = playerNames.gote || 'プレイヤー2';
      await updateDoc(docRef, {
        status: 'setup',
        goteDeviceId: clientDeviceId,
        goteName: goteName,
        logs: arrayUnion({ player: 'system', message: `${goteName} が入室しました。能力駒の構築を開始します。`, type: 'system' }),
        lastUpdated: Date.now()
      });

      setRoomCode(code);
      setMyRole('gote');
      setIsRandomMatch(false);
      setVsAiMode(false);
      setOnlineMode(true);
    } catch (err: any) {
      console.error(err);
      setMatchmakingError('入室中にエラーが発生しました。');
    }
  };

  // 2.5. ランダムマッチング処理 (通信ハンドシェイク ＆ 10秒タイムアウト付き)
  const handleRandomMatchmaking = async () => {
    setMatchmakingError('');
    setIsSearchingMatch(true);
    setIsConnectingHandshake(false);

    if (matchmakingTimeoutRef.current) {
      clearTimeout(matchmakingTimeoutRef.current);
    }

    // 10秒タイムアウト監視を設定
    matchmakingTimeoutRef.current = setTimeout(() => {
      handleCancelMatchmaking();
      setMatchmakingError('通信に失敗しました。もう一度お試しください。');
    }, 10000);

    try {
      const queueRef = collection(db, 'matchmaking_queue');
      const q = query(queueRef, where('status', '==', 'waiting'), orderBy('createdAt', 'asc'), limit(1));
      const querySnapshot = await getDocs(q);
      
      const clientDeviceId = getOrCreateDeviceId();
      
      if (!querySnapshot.empty) {
        const opponentDoc = querySnapshot.docs[0];
        const opponentData = opponentDoc.data();
        const code = opponentData.roomCode;
        
        if (opponentData.deviceId === clientDeviceId) {
          await deleteDoc(doc(db, 'matchmaking_queue', opponentDoc.id));
          setIsSearchingMatch(false);
          handleRandomMatchmaking();
          return;
        }

        await deleteDoc(doc(db, 'matchmaking_queue', opponentDoc.id));
        
        const docRef = doc(db, 'matches', code);
        const goteName = playerNames.gote || 'プレイヤー2';
        
        // 接続確立中 (connecting) & ゲスト側ハンドシェイク済みを記録
        await updateDoc(docRef, {
          status: 'connecting',
          goteDeviceId: clientDeviceId,
          goteName: goteName,
          goteReadyHandshake: true,
          logs: arrayUnion({ player: 'system', message: `${goteName} が入室しました。通信同期中…`, type: 'system' }),
          lastUpdated: Date.now()
        });
        
        setRoomCode(code);
        setMyRole('gote');
        setIsRandomMatch(false);
        setVsAiMode(false);
        setOnlineMode(true);
        setIsSearchingMatch(false);
        setIsConnectingHandshake(true);
      } else {
        let code = '';
        let isUnique = false;
        let attempts = 0;
        while (!isUnique && attempts < 10) {
          code = Math.floor(100000 + Math.random() * 900000).toString();
          const docRef = doc(db, 'matches', code);
          const snap = await getDoc(docRef);
          if (!snap.exists()) {
            isUnique = true;
          }
          attempts++;
        }

        if (!isUnique) {
          throw new Error('部屋コードの生成に失敗しました。もう一度お試しください。');
        }

        const initialB = initializeBoard();
        const senteName = playerNames.sente || '先手プレイヤー';

        const matchRef = doc(db, 'matches', code);
        await setDoc(matchRef, {
          id: code,
          status: 'waiting',
          senteDeviceId: clientDeviceId,
          goteDeviceId: null,
          senteName: senteName,
          goteName: '',
          senteReadyHandshake: true,
          goteReadyHandshake: false,
          senteWords: [],
          goteWords: [],
          sentePiecesReady: false,
          gotePiecesReady: false,
          sentePieces: null,
          gotePieces: null,
          board: JSON.stringify(initialB),
          turn: 'sente',
          winner: null,
          logsJson: JSON.stringify([]),
          capturedPieces: JSON.stringify({ sente: [], gote: [] }),
          sharedPieces: JSON.stringify([]),
          logs: [
            { player: 'system', message: `対局室 (部屋コード: ${code}) が作成されました。`, type: 'system' },
            { player: 'system', message: 'ランダムな対戦相手の入室を待っています…', type: 'system' }
          ],
          lastUpdated: Date.now()
        });

        const myQueueRef = doc(db, 'matchmaking_queue', clientDeviceId);
        await setDoc(myQueueRef, {
          deviceId: clientDeviceId,
          roomCode: code,
          status: 'waiting',
          createdAt: Date.now()
        });

        setRoomCode(code);
        setMyRole('sente');
        setIsWaitingForOpponent(true);
        setIsRandomMatch(true);
        setVsAiMode(false);
        setOnlineMode(true);
        setIsSearchingMatch(false);
      }
    } catch (err: any) {
      console.error(err);
      if (matchmakingTimeoutRef.current) clearTimeout(matchmakingTimeoutRef.current);
      setMatchmakingError(err.message || 'マッチング中にエラーが発生しました。');
      setIsSearchingMatch(false);
      setIsConnectingHandshake(false);
    }
  };

  const handleCancelMatchmaking = async () => {
    if (matchmakingTimeoutRef.current) {
      clearTimeout(matchmakingTimeoutRef.current);
      matchmakingTimeoutRef.current = null;
    }
    setMatchmakingError('');
    setIsSearchingMatch(false);
    setIsWaitingForOpponent(false);
    setIsRandomMatch(false);
    setIsConnectingHandshake(false);
    
    const clientDeviceId = getOrCreateDeviceId();
    
    try {
      await deleteDoc(doc(db, 'matchmaking_queue', clientDeviceId));
      
      if (roomCode && myRole === 'sente') {
        const matchRef = doc(db, 'matches', roomCode);
        const snap = await getDoc(matchRef);
        if (snap.exists() && (snap.data().status === 'waiting' || snap.data().status === 'connecting')) {
          await deleteDoc(matchRef);
        }
      }
    } catch (err) {
      console.warn('Error cleaning up matchmaking/match documents on cancel:', err);
    }
    
    setRoomCode('');
    setMyRole(null);
    setOnlineMode(false);
  };

  // 3. リアルタイムFirestoreリスナーおよび再同期ロジック (Mutual Confirmation)
  const updateLocalStateFromMatchData = useCallback((data: any) => {
    setMatchDoc(data);

    // 相手のユーザー名を反映
    setPlayerNames(prev => {
      const newNames = { ...prev };
      if (myRole === 'sente' && data.goteName) newNames.gote = data.goteName;
      if (myRole === 'gote' && data.senteName) newNames.sente = data.senteName;
      return newNames;
    });

    // 相互ハンドシェイク通信確認
    if (data.status === 'connecting') {
      setIsConnectingHandshake(true);
      // 先手側も後手側入室を確認した時点で senteReadyHandshake を記録
      if (myRole === 'sente' && !data.senteReadyHandshake && roomCode) {
        updateDoc(doc(db, 'matches', roomCode), {
          senteReadyHandshake: true,
          status: 'setup'
        });
      }
    }

    if (data.status === 'setup' || (data.senteReadyHandshake && data.goteReadyHandshake && data.status === 'connecting')) {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setIsConnectingHandshake(false);
      setIsWaitingForOpponent(false);

      setState(prev => {
        if (prev.phase !== 'setup') {
          return {
            ...prev,
            phase: 'setup',
            turn: myRole || prev.turn
          };
        }
        return prev;
      });
    } else if (data.status === 'playing') {
      if (matchmakingTimeoutRef.current) {
        clearTimeout(matchmakingTimeoutRef.current);
        matchmakingTimeoutRef.current = null;
      }
      setIsConnectingHandshake(false);
      setIsWaitingForOpponent(false);

      setState(prev => {
        const newTurn = data.turn as Player;
        const newBoard = JSON.parse(data.board) as Board;
        // 自手番になった時に王手チェック
        if (newTurn !== prev.turn && newTurn === myRole) {
          const isChecked = isKingInCheck(newBoard, myRole);
          if (isChecked) {
            setShowCheckOverlay(true);
          }
        }
        return {
          ...prev,
          board: newBoard,
          turn: newTurn,
          phase: 'playing',
          customPieces: data.customPieces,
          customDecks: data.customDecksJson ? JSON.parse(data.customDecksJson) : { sente: [], gote: [] },
          capturedPieces: JSON.parse(data.capturedPieces),
          sharedPieces: JSON.parse(data.sharedPieces),
          logs: data.logs || [],
          winner: data.winner,
        };
      });
    } else if (data.status === 'finished') {
      setState(prev => ({
        ...prev,
        board: JSON.parse(data.board),
        turn: data.turn,
        phase: 'finished',
        customPieces: data.customPieces,
        capturedPieces: JSON.parse(data.capturedPieces),
        sharedPieces: JSON.parse(data.sharedPieces),
        logs: data.logs || [],
        winner: data.winner,
      }));
    }
  }, [myRole, roomCode]);

  const forceResyncGame = useCallback(async () => {
    if (!onlineMode || !roomCode) return;
    try {
      const docRef = doc(db, 'matches', roomCode);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        updateLocalStateFromMatchData(data);
        console.log('--- [📱スマホ復帰検知] データベースから最新の盤面を強制再同期します ---');
      }
    } catch (err) {
      console.error('Error force-resyncing game on visibility change:', err);
    }
  }, [onlineMode, roomCode, updateLocalStateFromMatchData]);

  // visibilitychange検知によるスマホ復帰対策
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        await forceResyncGame();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [forceResyncGame]);

  // リアルタイムFirestoreリスナー
  useEffect(() => {
    if (!onlineMode || !roomCode) return;

    const docRef = doc(db, 'matches', roomCode);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        updateLocalStateFromMatchData(data);
      }
    });

    return () => unsubscribe();
  }, [onlineMode, roomCode, updateLocalStateFromMatchData]);


  // 4. 先手側：両者の概念構築完了検知と自動配置
  useEffect(() => {
    if (!onlineMode || !roomCode || myRole !== 'sente' || !matchDoc) return;
    if (matchDoc.status !== 'setup') return;

    if (matchDoc.sentePiecesReady && matchDoc.gotePiecesReady && matchDoc.sentePieces && matchDoc.gotePieces) {
      const sentePieces: Piece[] = matchDoc.sentePieces;
      const gotePieces: Piece[] = matchDoc.gotePieces;
      
      const nextBoard = initializeBoard();

      // 1. Auto-place Sente pieces on Sente's territory (ranks 6, 7, 8)
      const senteAvailable: [number, number][] = [];
      for (let y = 6; y <= 8; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (nextBoard[y][x] === null) {
            senteAvailable.push([y, x]);
          }
        }
      }
      senteAvailable.sort(() => Math.random() - 0.5);

      const initializedSente = sentePieces.map((piece, index) => {
        const position = index < senteAvailable.length ? senteAvailable[index] : null;
        const isStealth = isStealthPiece(piece);
        const initializedPiece = {
          ...piece,
          originalPosition: position,
          coolDownTurnsRemaining: 0,
          isRevealed: isStealth ? false : true,
          isStealth: isStealth ? true : false,
        };
        if (position) {
          nextBoard[position[0]][position[1]] = initializedPiece;
        }
        return initializedPiece;
      });

      // 2. Auto-place Gote pieces on Gote's territory (ranks 0, 1, 2)
      const goteAvailable: [number, number][] = [];
      for (let y = 0; y <= 2; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (nextBoard[y][x] === null) {
            goteAvailable.push([y, x]);
          }
        }
      }
      goteAvailable.sort(() => Math.random() - 0.5);

      const initializedGote = gotePieces.map((piece, index) => {
        const position = index < goteAvailable.length ? goteAvailable[index] : null;
        const isStealth = isStealthPiece(piece);
        const initializedPiece = {
          ...piece,
          originalPosition: position,
          coolDownTurnsRemaining: 0,
          isRevealed: isStealth ? false : true,
          isStealth: isStealth ? true : false,
        };
        if (position) {
          nextBoard[position[0]][position[1]] = initializedPiece;
        }
        return initializedPiece;
      });

      const nextLogs = [
        ...matchDoc.logs,
        { player: 'system', message: '能力駒が自陣地にランダム配置されました。', type: 'system' },
        { player: 'system', message: '対局を開始します！', type: 'system' }
      ];

      const docRef = doc(db, 'matches', roomCode);
      updateDoc(docRef, sanitizeForFirestore({
        status: 'playing',
        board: JSON.stringify(nextBoard),
        customPieces: { sente: initializedSente, gote: initializedGote },
        customDecksJson: JSON.stringify({ sente: [], gote: [] }),
        destroyedPiecesJson: JSON.stringify([]),
        capturedPieces: JSON.stringify({ sente: [], gote: [] }),
        sharedPieces: JSON.stringify([]),
        turn: 'sente',
        logs: nextLogs,
        logsJson: JSON.stringify(nextLogs),
        lastUpdated: Date.now()
      })).catch(err => console.error("Error setting up online board:", err));
    }
  }, [onlineMode, roomCode, myRole, matchDoc]);

  // 5. アトミックなオンライン状態同期関数
  const syncOnlineState = useCallback((
    board: Board,
    turn: Player,
    phase: GameState['phase'],
    winner: Player | null,
    capturedPieces: GameState['capturedPieces'],
    sharedPieces: Piece[],
    customDecks: GameState['customDecks'] = state.customDecks,
    destroyedPieces: Piece[] = state.destroyedPieces,
    logs: GameLog[] = state.logs
  ) => {
    if (!onlineMode || !roomCode) return;
    const docRef = doc(db, 'matches', roomCode);
    updateDoc(docRef, {
      board: JSON.stringify(board),
      turn: turn,
      status: phase,
      winner: winner,
      capturedPieces: JSON.stringify(capturedPieces),
      sharedPieces: JSON.stringify(sharedPieces),
      customDecksJson: JSON.stringify(customDecks),
      destroyedPiecesJson: JSON.stringify(destroyedPieces),
      logsJson: JSON.stringify(logs),
      logs: logs,
      lastUpdated: Date.now()
    }).catch(err => console.error("Error syncing online state:", err));
  }, [onlineMode, roomCode, state.customDecks, state.destroyedPieces, state.logs]);

  // Helpers to push logs
  const addLog = (message: string, type: GameLog['type'], player: Player) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog: GameLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp,
      player,
      message,
      type,
    };
    setState(prev => ({ ...prev, logs: [...prev.logs, newLog] }));
  };

  // Timeline History Snapshots
  const saveHistorySnapshot = (
    board: Board,
    captured: typeof state.capturedPieces,
    turn: Player,
    logs: GameLog[],
    customDecks: typeof state.customDecks = state.customDecks,
    destroyedPieces: Piece[] = state.destroyedPieces
  ) => {
    const snapshot: HistoryState = {
      turnNumber: state.historyStates.length + 1,
      boardJson: JSON.stringify(board),
      capturedPiecesJson: JSON.stringify(captured),
      customDecksJson: JSON.stringify(customDecks),
      destroyedPiecesJson: JSON.stringify(destroyedPieces),
      turn,
      logsJson: JSON.stringify(logs),
    };
    setState(prev => ({
      ...prev,
      historyStates: [...prev.historyStates, snapshot]
    }));
  };

  // Turn Change Finalizer (ticks cooldowns)
  const finalizeTurn = async (
    nextBoard: Board,
    nextCaptured: typeof state.capturedPieces,
    nextShared: Piece[],
    nextLogs: GameLog[],
    customStateUpdates?: Partial<GameState>,
    nextCustomDecks: typeof state.customDecks = state.customDecks,
    nextDestroyedPieces: Piece[] = state.destroyedPieces,
    hasProcessedTurnEnd: boolean = false
  ) => {
    const nextPlayer = (state.turn === 'sente' ? 'gote' : 'sente') as Player;
    const activePlayer = state.turn;

    // 0. Scan and queue TURN_END triggers for activePlayer before turn switch (if not already processed)
    if (!hasProcessedTurnEnd) {
      const turnEndEvents: AbilityEvent[] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = nextBoard[r][c];
          if (p && p.owner === activePlayer && isTriggerMatching(p, 'TURN_END') && p.coolDownTurnsRemaining === 0) {
            turnEndEvents.push({
              id: generateId(),
              priority: 3,
              triggerType: 'TURN_END',
              pieceId: p.id,
              position: [r, c],
              owner: activePlayer
            });
          }
        }
      }

      if (turnEndEvents.length > 0) {
        await processAbilityEventsQueue(nextBoard, turnEndEvents, nextCaptured, nextShared, nextLogs, nextDestroyedPieces);
        return;
      }
    }

    let currentBoard = nextBoard;
    const currentCaptured = {
      sente: [...nextCaptured.sente],
      gote: [...nextCaptured.gote],
    };
    const currentLogs = [...nextLogs];
    let gameOver = false;
    let winner: Player | null = null;
    let currentDestroyedPieces = [...nextDestroyedPieces];
    let currentShared = [...nextShared];

    // Scan original king positions in nextBoard
    let prevSenteKingPos: [number, number] | null = null;
    let prevGoteKingPos: [number, number] | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = currentBoard[r][c];
        if (p?.isKing) {
          if (p.owner === 'sente') prevSenteKingPos = [r, c];
          else prevGoteKingPos = [r, c];
        }
      }
    }

    // 1. Scan and execute autonomous moves for activePlayer (who just played) IMMEDIATELY
    const autonomousCoords: [number, number][] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = currentBoard[r][c];
        if (p && p.owner === activePlayer && isAutoNormalMover(p)) {
          autonomousCoords.push([r, c]);
        }
      }
    }

    for (const [sy, sx] of autonomousCoords) {
      if (gameOver) break;
      const piece = currentBoard[sy][sx];
      if (!piece || piece.owner !== activePlayer || !isAutoNormalMover(piece)) continue;

      const valid = getValidMoves(sy, sx, currentBoard);
      if (valid.length > 0) {
        const [ty, tx] = valid[Math.floor(Math.random() * valid.length)];
        const promote = isPromotionEligible(piece, sy, ty, activePlayer);
        
        const moveRes = executeMove(currentBoard, [sy, sx], [ty, tx], activePlayer, promote, playerNames, vsAiMode, false, currentCaptured);
        
        currentBoard = moveRes.board;
        if (moveRes.gameOver) {
          gameOver = true;
          winner = moveRes.winner;
        }

        if (moveRes.destroyedPieces && moveRes.destroyedPieces.length > 0) {
          currentDestroyedPieces.push(...moveRes.destroyedPieces);
          for (const p of moveRes.destroyedPieces) {
            if (p && !p.isKing) {
              if (!currentShared.some(s => s.id === p.id)) {
                currentShared.push({
                  ...p,
                  isPromoted: p.isPromoted,
                  coolDownTurnsRemaining: 0,
                  isRevealed: true,
                  stunTurnsRemaining: 0,
                  deathCountdown: 0
                });
              }
            }
          }
        }

        const capturedList: Piece[] = [];
        if (moveRes.capturedPieces && moveRes.capturedPieces.length > 0) {
          capturedList.push(...moveRes.capturedPieces);
        } else if (moveRes.capturedPiece) {
          capturedList.push(moveRes.capturedPiece);
        }

        for (const cap of capturedList) {
          if (cap) {
            const isStillOnBoard = moveRes.board.some(row => row.some(p => p?.id === cap.id));
            if (!isStillOnBoard) {
              const cleanCap = {
                ...cap,
                isPromoted: false,
                coolDownTurnsRemaining: 0,
                isRevealed: true
              };
              if (!currentCaptured[cleanCap.owner].some(p => p.id === cleanCap.id)) {
                currentCaptured[cleanCap.owner].push(cleanCap);
              }
            }
          }
        }

        currentLogs.push({
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: activePlayer,
          message: `【自律行動】操作不能の『${piece.word}』が勝手に${getCellLabel(ty, tx)}へ移動しました！`,
          type: 'ability'
        });

        currentLogs.push(...moveRes.logs.map(l => ({
          ...l,
          id: generateId(),
          timestamp: new Date().toLocaleTimeString()
        })));
        // Force the moved piece to have 0 cooldown
        for (let r = 0; r < BOARD_SIZE; r++) {
          for (let c = 0; c < BOARD_SIZE; c++) {
            const p = currentBoard[r][c];
            if (p && p.id === piece.id) {
              currentBoard[r][c] = {
                ...p,
                cool_down_turns: 0,
                coolDownTurnsRemaining: 0
              };
            }
          }
        }
      }
    }

    // Check game over conditions after autonomous moves
    const sKingPostAuto = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'sente'));
    const gKingPostAuto = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'gote'));
    if (!sKingPostAuto && !gKingPostAuto) {
      gameOver = true;
      winner = activePlayer === 'sente' ? 'gote' : 'sente';
    } else if (!sKingPostAuto) {
      gameOver = true;
      winner = 'gote';
    } else if (!gKingPostAuto) {
      gameOver = true;
      winner = 'sente';
    }

    // If game ended during autonomous moves, update state and show win screen
    if (gameOver) {
      setState(prev => ({
        ...prev,
        board: currentBoard,
        capturedPieces: currentCaptured,
        customDecks: nextCustomDecks,
        destroyedPieces: currentDestroyedPieces,
        selectedCell: null,
        promotionPending: null,
      }));

      setTimeout(() => {
        setState(prev => ({
          ...prev,
          winner,
        }));
        saveHistorySnapshot(currentBoard, currentCaptured, activePlayer, currentLogs, nextCustomDecks, currentDestroyedPieces);
        syncOnlineState(
          currentBoard,
          activePlayer,
          'finished',
          winner,
          currentCaptured,
          nextShared,
          nextCustomDecks,
          currentDestroyedPieces,
          currentLogs
        );
      }, 1200);
      return;
    }

    // 2. Decrement cooldowns and curses for pieces on the board
    const updatedLogsList: GameLog[] = [];
    const finalBoard = currentBoard.map((row, r) =>
      row.map((piece, c) => {
        if (!piece) return null;
        
        const updated = { ...piece };
        let died = false;
        
        // Cooldowns are decremented when the player's turn starts (nextPlayer)
        if (updated.owner === nextPlayer) {
          if (isAutonomous(updated)) {
            updated.cool_down_turns = 0;
            updated.coolDownTurnsRemaining = 0;
            updated.cooldownTurnsRemaining = 0;
          } else {
            const currentCD = updated.coolDownTurnsRemaining ?? updated.cooldownTurnsRemaining ?? 0;
            if (currentCD > 0 && currentCD !== 99) {
              const nextCD = Math.max(0, currentCD - 1);
              updated.coolDownTurnsRemaining = nextCD;
              updated.cooldownTurnsRemaining = nextCD;
            }
          }
        }
        
        // Stun, Freeze, and Death countdown are decremented when the player's turn ends (activePlayer)
        if (updated.owner === activePlayer) {
          if (updated.stunTurnsRemaining && updated.stunTurnsRemaining > 0) {
            updated.stunTurnsRemaining -= 1;
            if (updated.stunTurnsRemaining === 0) {
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【呪縛解除】${piece.word} (${getCellLabel(r, c)}) の呪縛（行動封印）が解けました！`,
                type: 'system'
              });
            }
          }

          if (updated.frozenDuration && updated.frozenDuration > 0) {
            updated.frozenDuration -= 1;
            if (updated.frozenDuration === 0) {
              updated.isFrozen = false;
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【凍結解除】${piece.word} (${getCellLabel(r, c)}) の凍結状態が解除されました！`,
                type: 'system'
              });
            }
          }
          
          if (updated.deathCountdown && updated.deathCountdown > 0) {
            updated.deathCountdown -= 1;
            if (updated.deathCountdown === 0) {
              died = true;
              currentDestroyedPieces.push(updated);
              currentShared.push({
                ...updated,
                isPromoted: updated.isPromoted,
                coolDownTurnsRemaining: 0,
                isRevealed: true,
                stunTurnsRemaining: 0,
                deathCountdown: 0
              });
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【死の宣告】${piece.word} (${getCellLabel(r, c)}) は死の宣告の刻限を迎え、塵となって消滅しました…`,
                type: 'system'
              });
            } else {
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【死の宣告】${piece.word} (${getCellLabel(r, c)}) の消滅まであと ${updated.deathCountdown} 手番。`,
                type: 'system'
              });
            }
          }

          // Mind Control Reversion
          if (updated.isMindControlled && updated.originalPlayer) {
            updatedLogsList.push({
              id: generateId(),
              timestamp: new Date().toLocaleTimeString(),
              player: activePlayer,
              message: `【洗脳解除】${updated.word} (${getCellLabel(r, c)}) の精神支配が解除され、元の所有者 (${updated.originalPlayer === 'sente' ? '先手' : '後手'}) の元に戻りました。`,
              type: 'system'
            });
            updated.owner = updated.originalPlayer;
            updated.isMindControlled = false;
            updated.originalPlayer = undefined;
          }

          // Guard stance decay
          if (updated.hasAbsoluteGuard && updated.guardDuration !== undefined && updated.guardDuration > 0) {
            updated.guardDuration -= 1;
            if (updated.guardDuration === 0) {
              updated.hasAbsoluteGuard = false;
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【防護解除】${updated.word} (${getCellLabel(r, c)}) の絶対ガードシールドが解除されました。`,
                type: 'system'
              });
            }
          }

          // Silence seal decay
          if (updated.isSilenced && updated.silenceDuration !== undefined && updated.silenceDuration > 0) {
            updated.silenceDuration -= 1;
            if (updated.silenceDuration === 0) {
              updated.isSilenced = false;
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【封印解除】${updated.word} (${getCellLabel(r, c)}) の能力封印が解除されました。`,
                type: 'system'
              });
            }
          }

          // Overdrive expires (piece was set isFrozen in the same turn so freeze handles recoil)
          if (updated.isOverdrive) {
            updated.isOverdrive = false;
          }
        }

        // Wall and Hazard duration decay
        if (updated.type === 'wall' || updated.type === 'hazard') {
          if (updated.duration !== undefined && updated.duration > 0) {
            updated.duration -= 1;
            if (updated.duration === 0) {
              died = true;
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: activePlayer,
                message: `【消滅】${updated.word} (${getCellLabel(r, c)}) の持続時間が経過し、消滅しました。`,
                type: 'system'
              });
            }
          }
        }
        
        return died ? null : updated;
      })
    );

    currentLogs.push(...updatedLogsList);
    currentBoard = finalBoard;

    // 3. Scan and queue TURN_START triggers for nextPlayer
    const turnStartEvents: AbilityEvent[] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = currentBoard[r][c];
        if (p && p.owner === nextPlayer && isTriggerMatching(p, 'TURN_START') && p.coolDownTurnsRemaining === 0) {
          turnStartEvents.push({
            id: generateId(),
            priority: 3,
            triggerType: 'TURN_START',
            pieceId: p.id,
            position: [r, c],
            owner: nextPlayer
          });
        }
      }
    }

    if (turnStartEvents.length > 0) {
      await processAbilityEventsQueue(currentBoard, turnStartEvents, currentCaptured, currentShared, currentLogs, currentDestroyedPieces);
      return;
    }

    // Check game over conditions after TURN_START triggers
    const finalSenteKing = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'sente'));
    const finalGoteKing = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'gote'));
    if (!finalSenteKing && !finalGoteKing) {
      gameOver = true;
      winner = nextPlayer === 'sente' ? 'gote' : 'sente';
    } else if (!finalSenteKing) {
      gameOver = true;
      winner = 'gote';
    } else if (!finalGoteKing) {
      gameOver = true;
      winner = 'sente';
    }

    // === すべての自動効果完了後にステルス近接スキャンを実行 ===
    currentBoard = scanStealthPieces(currentBoard, currentLogs);

    if (gameOver) {
      // 破壊された玉将の位置に多重グリッチ爆発エフェクトをトリガー
      const destroyedKingPositions: [number, number][] = [];
      if (!finalSenteKing && prevSenteKingPos) destroyedKingPositions.push(prevSenteKingPos);
      if (!finalGoteKing && prevGoteKingPos) destroyedKingPositions.push(prevGoteKingPos);

      if (destroyedKingPositions.length > 0) {
        for (const [ky, kx] of destroyedKingPositions) {
          setExplosionEffects(prev => [...prev, [ky, kx]]);
          setTimeout(() => setExplosionEffects(prev => [...prev, [ky - 1 >= 0 ? ky - 1 : ky, kx], [ky, kx + 1 < BOARD_SIZE ? kx + 1 : kx]]), 150);
          setTimeout(() => setExplosionEffects(prev => [...prev, [ky + 1 < BOARD_SIZE ? ky + 1 : ky, kx], [ky, kx - 1 >= 0 ? kx - 1 : kx]]), 300);
        }
        
        setScreenShake(true);
        setTimeout(() => {
          setScreenShake(false);
          for (const [ky, kx] of destroyedKingPositions) {
            setExplosionEffects(prev => prev.filter(coord => Math.abs(coord[0] - ky) > 1 || Math.abs(coord[1] - kx) > 1));
          }
        }, 1200);
      }

      setState(prev => ({
        ...prev,
        board: currentBoard,
        capturedPieces: currentCaptured,
        customDecks: nextCustomDecks,
        destroyedPieces: currentDestroyedPieces,
        sharedPieces: currentShared,
        selectedCell: null,
        activeAbilityMode: false,
        activeAbilitySource: null,
        activeAbilityTargets: [],
        logs: currentLogs,
        ...customStateUpdates,
      }));

      setTimeout(() => {
        setState(prev => ({
          ...prev,
          winner: winner,
        }));
        saveHistorySnapshot(currentBoard, currentCaptured, nextPlayer, currentLogs, nextCustomDecks, currentDestroyedPieces);
        syncOnlineState(
          currentBoard,
          nextPlayer,
          'finished',
          winner,
          currentCaptured,
          currentShared,
          nextCustomDecks,
          currentDestroyedPieces,
          currentLogs
        );
      }, 1200);

      setValidMoves([]);
      return;
    }

    const isChecked = isKingInCheck(currentBoard, nextPlayer);
    if (isChecked) {
      currentLogs.push({
        id: generateId(),
        timestamp: new Date().toLocaleTimeString(),
        player: nextPlayer,
        message: `🚨 王手！${getPlayerName(nextPlayer)}の玉将が狙われています！`,
        type: 'system'
      });
      setShowCheckOverlay(true);
    }

    setState(prev => {
      const nextState = {
        ...prev,
        phase: 'playing' as const,
        board: currentBoard,
        capturedPieces: currentCaptured,
        customDecks: nextCustomDecks,
        destroyedPieces: currentDestroyedPieces,
        sharedPieces: currentShared,
        turn: nextPlayer,
        selectedCell: null,
        activeAbilityMode: false,
        activeAbilitySource: null,
        activeAbilityTargets: [],
        logs: currentLogs,
        ...customStateUpdates,
      };
      saveHistorySnapshot(currentBoard, currentCaptured, nextPlayer, currentLogs, nextCustomDecks, currentDestroyedPieces);
      return nextState;
    });

    setValidMoves([]);

    syncOnlineState(
      currentBoard,
      nextPlayer,
      'playing',
      null,
      currentCaptured,
      nextShared,
      nextCustomDecks,
      currentDestroyedPieces,
      currentLogs
    );
  };

  const resumeAbilitySelection = async (ty: number, tx: number) => {
    if (!suspendedAbility) return;
    if (suspendedAbility.type === 'resurrect' && !selectedSharedPiece) {
      return; // Must select a graveyard piece first
    }

    const { source, triggerType, fromPosition, board, capturedPieces, logs, customStateUpdates, remainingEvents } = suspendedAbility;
    let [sy, sx] = source;
    let sourcePiece = board[sy][sx];
    if (!sourcePiece && fromPosition) {
      const [fy, fx] = fromPosition;
      if (board[fy][fx]) {
        sy = fy; sx = fx;
        sourcePiece = board[sy][sx];
      }
    }
    const activePlayer = sourcePiece?.owner;
    if (!activePlayer) return;

    let finalBoard = board;
    const nextCaptured = { ...capturedPieces };
    const finalLogs = [...logs];
    let nextShared = [...state.sharedPieces];

    // Scan original king positions in board before execution
    let prevSenteKingPos: [number, number] | null = null;
    let prevGoteKingPos: [number, number] | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = board[r][c];
        if (p?.isKing) {
          if (p.owner === 'sente') prevSenteKingPos = [r, c];
          else prevGoteKingPos = [r, c];
        }
      }
    }

    const isCustomSource = sourcePiece && !sourcePiece.isKing && !sourcePiece.isPawn && !sourcePiece.isHisha && !sourcePiece.isKaku;
    if (sourcePiece && isCustomSource) {
      let effectType = 'DEFAULT';
      const spec = getPieceAbilitySpec(sourcePiece);
      if (spec) {
        effectType = spec.effect_type;
      } else if (sourcePiece.custom_ability) {
        const actions = sourcePiece.custom_ability.actions;
        if (actions.includes('DESTROY')) {
          effectType = 'DESTROY';
        } else if (actions.includes('FREEZE')) {
          effectType = 'IMMOBILIZE';
        } else if (actions.includes('KNOCKBACK') || actions.includes('KNOCKBACK_MAX')) {
          effectType = 'PUSH';
        } else if (actions.includes('SWAP_POSITION')) {
          effectType = 'SWAP';
        } else if (actions.includes('PULL_1')) {
          effectType = 'PULL';
        } else if (actions.includes('RE_ACTION')) {
          effectType = 'RE_ACTION';
        }
      } else {
        const logic = getPieceLogicCode(sourcePiece);
        const desc = getPieceDescription(sourcePiece);
        if (logic.includes('blast') || logic.includes('explode') || desc.includes('爆発') || desc.includes('爆破') || desc.includes('自爆')) {
          effectType = 'DESTROY';
        } else if (logic.includes('stun') || desc.includes('スタン') || desc.includes('封印') || desc.includes('行動封印') || desc.includes('呪縛')) {
          effectType = 'IMMOBILIZE';
        } else if (logic.includes('swap') || desc.includes('交代') || desc.includes('入替') || desc.includes('瞬間移動')) {
          effectType = 'SWAP';
        } else if (logic.includes('pull') || desc.includes('引き寄せ')) {
          effectType = 'PULL';
        } else if (logic.includes('push') || desc.includes('押し出し') || logic.includes('charge')) {
          effectType = 'PUSH';
        }
      }
      const visualEffect = sourcePiece.isPromoted ? sourcePiece.promoted_effect?.visual_effect : sourcePiece.visual_effect;
      const animationTargets: [number, number][] = spec
        ? getEffectCells(ty, tx, spec.area_shape, sy, sx, sourcePiece.owner, board, spec.effect_offsets)
        : [[ty, tx]];

      // ── Persona 5 / P3R Styled Cutin Launch (With Async Execution Gate) ──
      const trgStr = triggerType as string;
      const specActions = spec?.actions || (sourcePiece.custom_ability?.actions) || [effectType as any];
      if (specActions.includes('PROBABILITY_STRIKE') || specActions.includes('CHAOS_GAMBLE')) {
        const isSuccess = Math.random() < (spec?.success_rate || 0.5);
        await triggerCutinWithGate({
          type: 'GAMBLE',
          title: sourcePiece.effect_name || sourcePiece.word,
          gambleResult: isSuccess ? 'SUCCESS' : 'MISS'
        });
      } else if (trgStr === 'ON_TAKEN' || trgStr === 'ON_APPROACH') {
        await triggerCutinWithGate({ type: 'AMBUSH', title: 'AMBUSH!', subtitle: 'OUT OF NOWHERE!' });
      } else if (trgStr === 'ON_MOVE') {
        const title = sourcePiece.effect_name || sourcePiece.word;
        const combos = sourcePiece.custom_ability?.actions?.length && sourcePiece.custom_ability.actions.length > 1
          ? ['1ST HIT!', 'CRITICAL!', 'FINISH!'].slice(0, sourcePiece.custom_ability.actions.length)
          : ['1ST HIT!'];
        await triggerCutinWithGate({ type: 'SKILL', title, subtitle: sourcePiece.word, comboHits: combos });
      } else if (trgStr === 'ON_PROMOTE') {
        await triggerCutinWithGate({ type: 'AWAKENED', title: sourcePiece.word });
      }

      setActiveAbilityAnimation({
        source: source,
        targets: animationTargets,
        theme: sourcePiece.visual_theme || null,
        active: true,
        effectType,
        visualEffect
      });
      const shakePower = visualEffect ? visualEffect.screen_shake : 0;
      if (shakePower > 0) {
        setScreenShakeIntensity(shakePower * 2.5);
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 400);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // ── [動的インタープリーター優先ルート]
    // ability_spec が設定されている駒は「interpretAbilitySpec」で実行
    // それ以外の旧駒は従来の applyAutomatedEffect でフォールバック
    const sourcePieceForEffect = finalBoard[sy]?.[sx] || sourcePiece;
    let effectRes: {
      board: Board;
      capturedPieces: Piece[];
      opponentCapturedPieces?: Piece[];
      graveyard?: Piece[];
      logs: Omit<import('./types').GameLog, 'id' | 'timestamp'>[];
      triggered: boolean;
      reAction?: boolean;
    };

    const spec = sourcePieceForEffect ? getPieceAbilitySpec(sourcePieceForEffect) : undefined;
    if (spec) {
      const specResult = interpretAbilitySpec(
        finalBoard,
        source,
        spec,
        activePlayer,
        capturedPieces[activePlayer],
        state.sharedPieces,
        [ty, tx],
        selectedSharedPiece?.piece,
        undefined,
        capturedPieces[activePlayer === 'sente' ? 'gote' : 'sente']
      );
      effectRes = {
        board: specResult.board,
        capturedPieces: specResult.capturedPieces,
        opponentCapturedPieces: specResult.opponentCapturedPieces,
        graveyard: specResult.graveyard,
        logs: specResult.logs,
        triggered: specResult.triggered
      };
    } else {
      effectRes = applyAutomatedEffect(
        finalBoard,
        source,
        triggerType,
        activePlayer,
        capturedPieces[activePlayer],
        fromPosition,
        [ty, tx],
        undefined,
        state.sharedPieces,
        selectedSharedPiece?.piece,
        undefined,
        capturedPieces[activePlayer === 'sente' ? 'gote' : 'sente']
      );
    }

    if (effectRes.triggered || effectRes.logs.length > 0) {
      if (effectRes.triggered) {
        finalBoard = effectRes.board;
        if (sourcePiece) {
          const sourceSpec = getPieceAbilitySpec(sourcePiece);
          const specCooldown = sourceSpec?.cooldown_turns;
          const normalCooldown = sourcePiece.cool_down_turns;
          const cd = specCooldown !== undefined ? specCooldown : normalCooldown;
          const isOnce = sourcePiece.is_once_per_game || sourcePiece.cool_down_turns === 99;
          const targetCooldown = isOnce ? 99 : (cd > 0 ? cd : 0);
          
          finalBoard = finalBoard.map(row => 
            row.map(p => {
              if (p && p.id === sourcePiece.id) {
                const uses = (p.remaining_uses ?? p.usesRemaining ?? 3) - 1;
                return {
                  ...p,
                  coolDownTurnsRemaining: targetCooldown,
                  cooldownTurnsRemaining: targetCooldown,
                  maxCooldown: targetCooldown > 0 ? targetCooldown : (p.maxCooldown || 3),
                  remaining_uses: Math.max(0, uses),
                  usesRemaining: Math.max(0, uses)
                };
              }
              return p;
            })
          );
        }
        nextCaptured[activePlayer] = effectRes.capturedPieces;
        if (effectRes.opponentCapturedPieces) {
          nextCaptured[activePlayer === 'sente' ? 'gote' : 'sente'] = effectRes.opponentCapturedPieces;
        }
        if (effectRes.graveyard) {
          nextShared = effectRes.graveyard;
        }
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 300);
      }
      finalLogs.push(...effectRes.logs.map(l => ({
        ...l,
        id: generateId(),
        timestamp: new Date().toLocaleTimeString()
      })));
    }

    setSuspendedAbility(null);

    const nextDestroyedPieces = customStateUpdates?.destroyedPieces || state.destroyedPieces;

    if (triggerType === 'ON_MOVE') {
      const senteKing = finalBoard.some(row => row.some(p => p?.isKing && p.owner === 'sente'));
      const goteKing = finalBoard.some(row => row.some(p => p?.isKing && p.owner === 'gote'));
      let isGameOver = false;
      let finalWinner: Player | null = null;

      if (!senteKing && !goteKing) {
        isGameOver = true;
        finalWinner = activePlayer === 'sente' ? 'gote' : 'sente';
      } else if (!senteKing) {
        isGameOver = true;
        finalWinner = 'gote';
      } else if (!goteKing) {
        isGameOver = true;
        finalWinner = 'sente';
      }

      if (isGameOver) {
        // Trigger multi-glitch explosion effects at the position of the destroyed King
        const destroyedKingPositions: [number, number][] = [];
        if (!senteKing && prevSenteKingPos) destroyedKingPositions.push(prevSenteKingPos);
        if (!goteKing && prevGoteKingPos) destroyedKingPositions.push(prevGoteKingPos);

        if (destroyedKingPositions.length > 0) {
          for (const [ky, kx] of destroyedKingPositions) {
            setExplosionEffects(prev => [...prev, [ky, kx]]);
            setTimeout(() => setExplosionEffects(prev => [...prev, [ky - 1 >= 0 ? ky - 1 : ky, kx], [ky, kx + 1 < BOARD_SIZE ? kx + 1 : kx]]), 150);
            setTimeout(() => setExplosionEffects(prev => [...prev, [ky + 1 < BOARD_SIZE ? ky + 1 : ky, kx], [ky, kx - 1 >= 0 ? kx - 1 : kx]]), 300);
          }
          
          setScreenShake(true);
          setTimeout(() => {
            setScreenShake(false);
            for (const [ky, kx] of destroyedKingPositions) {
              setExplosionEffects(prev => prev.filter(coord => Math.abs(coord[0] - ky) > 1 || Math.abs(coord[1] - kx) > 1));
            }
          }, 1200);
        }

        setState(prev => ({
          ...prev,
          board: finalBoard,
          capturedPieces: nextCaptured,
          selectedCell: null,
          promotionPending: null,
          activeAbilityMode: false,
          activeAbilitySource: null,
          activeAbilityTargets: []
        }));

        const isCustomSource = sourcePiece && !sourcePiece.isKing && !sourcePiece.isPawn && !sourcePiece.isHisha && !sourcePiece.isKaku;
        if (sourcePiece && isCustomSource) {
          await new Promise(resolve => setTimeout(resolve, 600));
          setActiveAbilityAnimation({
            source: null,
            targets: [],
            theme: null,
            active: false
          });
        }

        setTimeout(() => {
          setState(prev => ({
            ...prev,
            winner: finalWinner,
          }));
          saveHistorySnapshot(finalBoard, nextCaptured, activePlayer, finalLogs);
          syncOnlineState(
            finalBoard,
            activePlayer,
            'finished',
            finalWinner,
            nextCaptured,
            nextShared,
            undefined,
            undefined,
            finalLogs
          );
        }, 1200);
      } else {
        const isCustomSource = sourcePiece && !sourcePiece.isKing && !sourcePiece.isPawn && !sourcePiece.isHisha && !sourcePiece.isKaku;
        if (sourcePiece && isCustomSource) {
          setTimeout(() => {
            setActiveAbilityAnimation({
              source: null,
              targets: [],
              theme: null,
              active: false
            });
          }, 600);
        }

        if (remainingEvents && remainingEvents.length > 0) {
          // Resume queue!
          await processAbilityEventsQueue(
            finalBoard,
            remainingEvents,
            nextCaptured,
            nextShared,
            finalLogs,
            nextDestroyedPieces
          );
        } else if (effectRes.reAction) {
          // Skip switching players! Keep current player (activePlayer)
          setState(prev => {
            const nextState = {
              ...prev,
              board: finalBoard,
              capturedPieces: nextCaptured,
              sharedPieces: nextShared,
              destroyedPieces: nextDestroyedPieces,
              selectedCell: null,
              activeAbilityMode: false,
              activeAbilitySource: null,
              activeAbilityTargets: [],
              logs: finalLogs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() })),
            };
            saveHistorySnapshot(finalBoard, nextCaptured, activePlayer, nextState.logs, state.customDecks, nextDestroyedPieces);
            return nextState;
          });
          
          syncOnlineState(
            finalBoard,
            activePlayer,
            'playing',
            null,
            nextCaptured,
            nextShared,
            state.customDecks,
            nextDestroyedPieces,
            finalLogs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() }))
          );
        } else {
          finalizeTurn(
            finalBoard,
            nextCaptured,
            nextShared,
            finalLogs,
            { promotionPending: null },
            state.customDecks,
            nextDestroyedPieces
          );
        }
      }
      setSelectedSharedPiece(null);
    } else if (triggerType === 'TURN_START') {
      let currentBoard = finalBoard;
      const currentCaptured = { ...nextCaptured };
      const currentLogs = [...finalLogs];
      let gameOver = false;
      let winner: Player | null = null;

      // Scan for other TURN_START triggers for activePlayer
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = currentBoard[r][c];
          if (p && p.owner === activePlayer && isTriggerMatching(p, 'TURN_START') && p.coolDownTurnsRemaining === 0) {
            const targetsInfo = getAbilityTargets(currentBoard, [r, c], activePlayer, nextShared);
            if (targetsInfo && isPieceOwnerHuman(activePlayer)) {
              setSuspendedAbility({
                source: [r, c],
                targets: targetsInfo.targets,
                type: targetsInfo.type,
                triggerType: 'TURN_START',
                board: currentBoard,
                capturedPieces: currentCaptured,
                logs: currentLogs,
                customStateUpdates: {
                  ...customStateUpdates,
                  sharedPieces: nextShared
                }
              });

              setState(prev => ({
                ...prev,
                board: currentBoard,
                capturedPieces: currentCaptured,
                sharedPieces: nextShared,
                turn: activePlayer,
                selectedCell: null,
                activeAbilityMode: true,
                activeAbilitySource: [r, c],
                activeAbilityTargets: targetsInfo.targets,
                logs: currentLogs,
                ...customStateUpdates
              }));
              return;
            } else {
              const effectRes = applyAutomatedEffect(
                currentBoard,
                [r, c],
                'TURN_START',
                activePlayer,
                currentCaptured[activePlayer],
                undefined,
                undefined,
                undefined,
                nextShared,
                undefined,
                undefined,
                currentCaptured[activePlayer === 'sente' ? 'gote' : 'sente']
              );
              if (effectRes.triggered || effectRes.logs.length > 0) {
                if (effectRes.triggered) {
                  currentBoard = effectRes.board;
                  currentCaptured[activePlayer] = effectRes.capturedPieces;
                  if (effectRes.opponentCapturedPieces) {
                    currentCaptured[activePlayer === 'sente' ? 'gote' : 'sente'] = effectRes.opponentCapturedPieces;
                  }
                  if (effectRes.graveyard) {
                    nextShared = effectRes.graveyard;
                  }
                }
                currentLogs.push(...effectRes.logs.map(l => ({
                  ...l,
                  id: generateId(),
                  timestamp: new Date().toLocaleTimeString()
                })));
              }
            }
          }
        }
      }

      // Check game over
      const sKing = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'sente'));
      const gKing = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'gote'));
      if (!sKing && !gKing) {
        gameOver = true;
        winner = activePlayer === 'sente' ? 'gote' : 'sente';
      } else if (!sKing) {
        gameOver = true;
        winner = 'gote';
      } else if (!gKing) {
        gameOver = true;
        winner = 'sente';
      }

      // Stealth proximity scan
      currentBoard = scanStealthPieces(currentBoard, currentLogs);

      if (gameOver) {
        setState(prev => ({
          ...prev,
          board: currentBoard,
          capturedPieces: currentCaptured,
          selectedCell: null,
          activeAbilityMode: false,
          activeAbilitySource: null,
          activeAbilityTargets: [],
          logs: currentLogs,
          ...customStateUpdates,
        }));

        setTimeout(() => {
          setState(prev => ({
            ...prev,
            winner: winner,
          }));
          saveHistorySnapshot(currentBoard, currentCaptured, activePlayer, currentLogs);
          syncOnlineState(
            currentBoard,
            activePlayer,
            'finished',
            winner,
            currentCaptured,
            nextShared,
            undefined,
            undefined,
            currentLogs
          );
        }, 1200);

        setValidMoves([]);
        return;
      }

      const isChecked = isKingInCheck(currentBoard, activePlayer);
      if (isChecked) {
        currentLogs.push({
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: activePlayer,
          message: `🚨 王手！${getPlayerName(activePlayer)}の玉将が狙われています！`,
          type: 'system'
        });
        setShowCheckOverlay(true);
      }

      setState(prev => {
        const nextState = {
          ...prev,
          board: currentBoard,
          capturedPieces: currentCaptured,
          sharedPieces: nextShared,
          selectedCell: null,
          activeAbilityMode: false,
          activeAbilitySource: null,
          activeAbilityTargets: [],
          logs: currentLogs,
          ...customStateUpdates,
        };
        saveHistorySnapshot(currentBoard, currentCaptured, activePlayer, currentLogs);
        return nextState;
      });
      setSelectedSharedPiece(null);

      setValidMoves([]);

      syncOnlineState(
        currentBoard,
        activePlayer,
        'playing',
        null,
        currentCaptured,
        state.sharedPieces,
        undefined,
        undefined,
        currentLogs
      );
    }
  };

  // Save initial snapshot when playing starts
  useEffect(() => {
    if (state.phase === 'playing' && state.historyStates.length === 0) {
      saveHistorySnapshot(state.board, state.capturedPieces, state.turn, state.logs);
    }
  }, [state.phase]);

  const autoPlacePieces = (sentePieces: Piece[], gotePieces: Piece[]) => {
    let nextBoard = initializeBoard();

    // 1. Auto-place Sente pieces on Sente's territory (ranks 6, 7, 8)
    const senteAvailable: [number, number][] = [];
    for (let y = 6; y <= 8; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (nextBoard[y][x] === null) {
          senteAvailable.push([y, x]);
        }
      }
    }
    senteAvailable.sort(() => Math.random() - 0.5);

    const initializedSente = sentePieces.map((piece, index) => {
      const position = index < senteAvailable.length ? senteAvailable[index] : null;
      const isStealth = isStealthPiece(piece);
      const initializedPiece = {
        ...piece,
        originalPosition: position,
        coolDownTurnsRemaining: 0,
        isRevealed: isStealth ? false : true,
        isStealth: isStealth ? true : false,
      };
      if (position) {
        nextBoard[position[0]][position[1]] = initializedPiece;
      }
      return initializedPiece;
    });

    // 2. Auto-place Gote pieces on Gote's territory (ranks 0, 1, 2)
    const goteAvailable: [number, number][] = [];
    for (let y = 0; y <= 2; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (nextBoard[y][x] === null) {
          goteAvailable.push([y, x]);
        }
      }
    }
    goteAvailable.sort(() => Math.random() - 0.5);

    const initializedGote = gotePieces.map((piece, index) => {
      const position = index < goteAvailable.length ? goteAvailable[index] : null;
      const isStealth = isStealthPiece(piece);
      const initializedPiece = {
        ...piece,
        originalPosition: position,
        coolDownTurnsRemaining: 0,
        isRevealed: isStealth ? false : true,
        isStealth: isStealth ? true : false,
      };
      if (position) {
        nextBoard[position[0]][position[1]] = initializedPiece;
      }
      return initializedPiece;
    });

    setState(prev => ({
      ...prev,
      board: nextBoard,
      phase: 'playing',
      turn: 'sente',
      customPieces: { sente: initializedSente, gote: initializedGote },
      customDecks: { sente: [], gote: [] },
      destroyedPieces: []
    }));

    setPiecesToPlace({ sente: [], gote: [] });

    addLog('能力駒が自陣地にランダム配置されました。', 'system', 'sente');
    addLog('対局を開始します！', 'system', 'sente');
  };

  // Setup Phase: Piece creator callbacks
  const handlePiecesCreated = async (pieces: Piece[]) => {
    if (onlineMode) {
      const docRef = doc(db, 'matches', roomCode);
      const sanitizedPieces = sanitizeForFirestore(pieces);
      if (myRole === 'sente') {
        await updateDoc(docRef, {
          sentePieces: sanitizedPieces,
          sentePiecesReady: true,
          logs: arrayUnion({ player: 'system', message: `▲ ${playerNames.sente || 'プレイヤー1'} が能力駒の構築を完了しました！`, type: 'system' })
        });
      } else {
        await updateDoc(docRef, {
          gotePieces: sanitizedPieces,
          gotePiecesReady: true,
          logs: arrayUnion({ player: 'system', message: `▽ ${playerNames.gote || 'プレイヤー2'} が能力駒の構築を完了しました！`, type: 'system' })
        });
      }
      return;
    }

    if (setupSubPhase === 'sente_create') {
      setPiecesToPlace(prev => ({ ...prev, sente: pieces }));
      addLog(`${playerNames.sente || 'プレイヤー1'} の能力駒スキャンが完了しました。`, 'system', 'sente');

      if (vsAiMode) {
        addLog('🤖 Gemini AI の能力駒をキャッシュから高速ロード中...', 'system', 'gote');

        // キャッシュ済み駒をランダムに4枚取得（なければオフライン生成）
        const gotePiecesData = getRandomCachedPieces(AI_PIECE_WORDS.length);
        const gotePieces: Piece[] = gotePiecesData.map(pieceData => {
          const isStealth = isStealthPiece(pieceData);
          return {
            ...pieceData,
            id: Math.random().toString(36).substring(2, 11),
            owner: 'gote',
            isKing: false,
            isPawn: false,
            originalPosition: null,
            coolDownTurnsRemaining: 0,
            isRevealed: isStealth ? false : true,
            isStealth: isStealth ? true : false,
            isPromoted: false,
          };
        });

        setPiecesToPlace(prev => ({ ...prev, gote: gotePieces }));
        addLog(`🤖 Gemini AI の能力駒ロード完了（${gotePieces.map(p => isStealthPiece(p) ? '？' : p.word).join('・')}）`, 'system', 'gote');
        autoPlacePieces(pieces, gotePieces);
      } else {
        setSetupSubPhase('gote_create');
        setState(prev => ({ ...prev, turn: 'gote' }));
      }
    } else {
      setPiecesToPlace(prev => ({ ...prev, gote: pieces }));
      addLog(`${playerNames.gote || 'プレイヤー2'} の能力駒スキャンが完了しました。`, 'system', 'gote');
      autoPlacePieces(piecesToPlace.sente, pieces);
    }
  };

  // Placement Phase Cell Click
  const handlePlacementCellClick = (y: number, x: number) => {
    const activePlayer = state.turn;
    const pendingList = activePlayer === 'sente' ? piecesToPlace.sente : piecesToPlace.gote;

    if (pendingList.length === 0) return;

    // Sente bottom 3 ranks (y=6, 7, 8), Gote top 3 ranks (y=0, 1, 2)
    const isValidRow = activePlayer === 'sente' ? y >= 6 : y <= 2;
    if (!isValidRow || state.board[y][x] !== null) return;

    const nextPending = [...pendingList];
    const pieceToPlace = nextPending.shift()!;

    const nextBoard = state.board.map(row => [...row]);
    pieceToPlace.originalPosition = [y, x];
    const isStealth = isStealthPiece(pieceToPlace);
    pieceToPlace.isRevealed = isStealth ? false : true;
    pieceToPlace.isStealth = isStealth ? true : false;
    nextBoard[y][x] = pieceToPlace;

    setPiecesToPlace(prev => ({
      ...prev,
      [activePlayer]: nextPending
    }));

    setState(prev => ({
      ...prev,
      board: nextBoard,
    }));

    addLog(`${pieceToPlace.word}を${getCellLabel(y, x)}に配置しました。`, 'system', activePlayer);

    if (nextPending.length === 0) {
      if (activePlayer === 'sente') {
        if (vsAiMode) {
          triggerAiPlacement(nextBoard, piecesToPlace.gote);
        } else {
          setState(prev => ({ ...prev, turn: 'gote' }));
        }
      } else {
        addLog('すべての駒の配置完了。9×9対局を開始します！', 'system', 'sente');
        setState(prev => ({
          ...prev,
          phase: 'playing',
          turn: 'sente',
        }));
      }
    }
  };

  // AI placement logic (9x9)
  const triggerAiPlacement = (currentBoard: Board, aiPieces: Piece[]) => {
    addLog('🤖 Gemini AI が駒を初期配置中...', 'system', 'gote');
    let nextBoard = currentBoard.map(row => [...row]);
    
    // Rows 0, 1, 2
    const availableCells: [number, number][] = [];
    for (let y = 0; y <= 2; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (nextBoard[y][x] === null) {
          availableCells.push([y, x]);
        }
      }
    }

    availableCells.sort(() => Math.random() - 0.5);

    aiPieces.forEach((piece, index) => {
      const [cy, cx] = availableCells[index];
      const placed = { ...piece, originalPosition: [cy, cx] as [number, number] };
      nextBoard[cy][cx] = placed;
    });

    setPiecesToPlace(prev => ({ ...prev, gote: [] }));
    addLog('🤖 Gemini AI の配置完了。対局を開始します！', 'system', 'gote');
    
    setState(prev => ({
      ...prev,
      board: nextBoard,
      phase: 'playing',
      turn: 'sente'
    }));
  };

  // Main Playing Cell Click Handler
  const handlePlayingCellClick = (y: number, x: number) => {
    if (state.winner) return;



    const piece = state.board[y][x];

    // Case 1: Drop selected captured piece OR shared piece OR custom deck piece
    if (selectedCapturedPiece || selectedSharedPiece || selectedCustomDeckPiece) {
      const isValid = validMoves.some(([my, mx]) => my === y && mx === x);
      if (!isValid) {
        setSelectedCapturedPiece(null);
        setSelectedSharedPiece(null);
        setSelectedCustomDeckPiece(null);
        setValidMoves([]);
        return;
      }
      
      const targetPiece = selectedCapturedPiece
        ? selectedCapturedPiece.piece
        : (selectedSharedPiece ? selectedSharedPiece.piece : selectedCustomDeckPiece!.piece);
      const nextBoard = executeDrop(state.board, targetPiece, [y, x], state.turn);
      
      let nextHand = [...state.capturedPieces[state.turn]];
      let nextShared = [...state.sharedPieces];
      let nextCustomDecks = {
        sente: [...state.customDecks.sente],
        gote: [...state.customDecks.gote]
      };

      if (selectedCapturedPiece) {
        nextHand.splice(selectedCapturedPiece.index, 1);
      } else if (selectedSharedPiece) {
        nextShared.splice(selectedSharedPiece.index, 1);
      } else if (selectedCustomDeckPiece) {
        nextCustomDecks[state.turn].splice(selectedCustomDeckPiece.index, 1);
      }

      const newLog: GameLog = {
        id: generateId(),
        timestamp: new Date().toLocaleTimeString(),
        player: state.turn,
        message: `${targetPiece.word}を${selectedCapturedPiece ? '持ち駒' : (selectedSharedPiece ? '共有プール' : 'カスタムデッキ')}から打ちました。`,
        type: 'move'
      };
      const nextCaptured = {
        ...state.capturedPieces,
        [state.turn]: nextHand,
      };

      finalizeTurn(nextBoard, nextCaptured, nextShared, [...state.logs, newLog], undefined, nextCustomDecks, state.destroyedPieces);
      setSelectedCapturedPiece(null);
      setSelectedSharedPiece(null);
      setSelectedCustomDeckPiece(null);
      return;
    }



    // Case 3: Standard piece selection / Movement Click
    if (state.selectedCell) {
      const [sy, sx] = state.selectedCell;
      const isMove = validMoves.some(([my, mx]) => my === y && mx === x);

      if (isMove) {
        const movingPiece = state.board[sy][sx]!;

        // Intercept for Promotion Check
        if (isPromotionEligible(movingPiece, sy, y, state.turn)) {
          if (mustPromote(movingPiece, y, state.turn)) {
            executeMoveWithPromotion(sy, sx, y, x, true);
          } else {
            setState(prev => ({
              ...prev,
              promotionPending: {
                from: [sy, sx],
                to: [y, x],
                piece: movingPiece
              }
            }));
            setValidMoves([]);
          }
        } else {
          executeMoveWithPromotion(sy, sx, y, x, false);
        }
        setValidMoves([]);
      } else {
        if (piece && piece.owner === state.turn) {
          if (isAutonomous(piece)) return;
          setState(prev => ({ ...prev, selectedCell: [y, x], activeAbilityMode: false, activeAbilityTargets: [] }));
          setValidMoves(getValidMoves(y, x, state.board));
        } else {
          setState(prev => ({ ...prev, selectedCell: null, activeAbilityMode: false, activeAbilityTargets: [] }));
          setValidMoves([]);
        }
      }
    } else {
      if (piece && piece.owner === state.turn) {
        if (isAutonomous(piece)) return;
        setState(prev => ({ ...prev, selectedCell: [y, x], activeAbilityMode: false, activeAbilityTargets: [] }));
        setValidMoves(getValidMoves(y, x, state.board));
      }
    }
  };

  // Click Router
  const handleCellClick = (y: number, x: number) => {
    if (isCutinPlaying) return;
    if (onlineMode && state.turn !== myRole) return;
    if (state.activeAbilityMode) {
      if (suspendedAbility) {
        const isTarget = state.activeAbilityTargets.some(([ty, tx]) => ty === y && tx === x);
        if (isTarget) {
          resumeAbilitySelection(y, x);
        } else {
          // If clicked outside selectable targets during activeAbilityMode, safely cancel ability mode!
          handleCancelAbilitySelection();
        }
      } else {
        handleCancelAbilitySelection();
      }
      return;
    }
    if (state.phase === 'placement') {
      handlePlacementCellClick(y, x);
    } else if (state.phase === 'playing') {
      handlePlayingCellClick(y, x);
    }
  };

  // Captured hand piece click Sente / Gote
  const handleCapturedPieceClick = (piece: Piece, index: number, owner: Player) => {
    if (isCutinPlaying) return;
    if (onlineMode && state.turn !== myRole) return;
    if (state.phase !== 'playing' || state.winner) return;
    if (owner !== state.turn) return;
    if (state.activeAbilityMode) return; // Prevent clicking during active ability selection

    setSelectedCapturedPiece({ piece, index });
    setSelectedSharedPiece(null);
    setSelectedCustomDeckPiece(null);
    setState(prev => ({ ...prev, selectedCell: null, activeAbilityMode: false, activeAbilityTargets: [] }));

    // Use drop-rule-aware valid cells (Nifu, No-move Drop)
    setValidMoves(getValidDropCells(state.board, piece, state.turn));
  };

  const handleCancelAbilitySelection = () => {
    setSuspendedAbility(null);
    setState(prev => ({
      ...prev,
      phase: 'playing',
      activeAbilityMode: false,
      activeAbilitySource: null,
      activeAbilityTargets: []
    }));
  };

  // Click Shared fantasy pool piece
  const handleSharedPieceClick = (piece: Piece, index: number) => {
    if (onlineMode && state.turn !== myRole) return;
    if (state.phase !== 'playing' || state.winner) return;

    // Only allow clicking graveyard pieces when a resurrection ability is active
    if (suspendedAbility && suspendedAbility.type === 'resurrect') {
      setSelectedSharedPiece({ piece, index });
      setSelectedCapturedPiece(null);
      setSelectedCustomDeckPiece(null);
      setState(prev => ({
        ...prev,
        selectedCell: null,
        activeAbilityTargets: suspendedAbility.targets
      }));
      setValidMoves([]); // Disable standard dropping
    }
  };

  // Custom deck piece click
  const handleCustomDeckPieceClick = (piece: Piece, index: number, owner: Player) => {
    if (onlineMode && state.turn !== myRole) return;
    if (state.phase !== 'playing' || state.winner) return;
    if (owner !== state.turn) return;
    if (state.activeAbilityMode) return; // Prevent clicking during active ability selection

    setSelectedCustomDeckPiece({ piece, index });
    setSelectedCapturedPiece(null);
    setSelectedSharedPiece(null);
    setState(prev => ({ ...prev, selectedCell: null, activeAbilityMode: false, activeAbilityTargets: [] }));

    // Use drop-rule-aware valid cells (Nifu, No-move Drop)
    setValidMoves(getValidDropCells(state.board, piece, state.turn));
  };


  // Pass Turn
  const handlePassTurn = () => {
    if (onlineMode && state.turn !== myRole) return;
    if (state.winner) return;

    const nextPlayer = (state.turn === 'sente' ? 'gote' : 'sente') as Player;
    const newLog: GameLog = {
      id: generateId(),
      timestamp: new Date().toLocaleTimeString(),
      player: state.turn,
      message: '手番をパスしました。',
      type: 'system'
    };
    const nextLogs = [...state.logs, newLog];

    setState(prev => {
      const nextState = {
        ...prev,
        turn: nextPlayer,
        selectedCell: null,
        activeAbilityMode: false,
        activeAbilitySource: null,
        activeAbilityTargets: [],
        logs: nextLogs,
      };
      saveHistorySnapshot(prev.board, prev.capturedPieces, nextState.turn, nextLogs);
      return nextState;
    });

    setValidMoves([]);

    syncOnlineState(
      state.board,
      nextPlayer,
      'playing',
      null,
      state.capturedPieces,
      state.sharedPieces,
      undefined,
      undefined,
      nextLogs
    );
  };


  const handleResetGame = () => {
    setState(prev => ({
      ...prev,
      board: initializeBoard(),
      turn: 'sente' as Player,
      phase: 'start',
      customPieces: { sente: [], gote: [] },
      customDecks: { sente: [], gote: [] },
      destroyedPieces: [],
      capturedPieces: { sente: [], gote: [] },
      sharedPieces: [],
      selectedCell: null,
      activeAbilityMode: false,
      activeAbilitySource: null,
      activeAbilityTargets: [],
      winner: null,
      logs: [],
      historyStates: [],
    }));
    setSetupSubPhase('sente_create');
    setPiecesToPlace({ sente: [], gote: [] });
    setSelectedCapturedPiece(null);
    setSelectedSharedPiece(null);
    setSelectedCustomDeckPiece(null);
    setValidMoves([]);
    setOnlineMode(false);
    setRoomCode('');
    setMyRole(null);
    setIsWaitingForOpponent(false);
    setMatchmakingError('');
    setMatchDoc(null);
  };

  // AI Opponent Solver (9x9)
  useEffect(() => {
    if (!vsAiMode || state.turn !== 'gote' || state.phase !== 'playing' || state.winner) return;

    const runAiTurn = async () => {
      await new Promise(r => setTimeout(r, 1200));

      const board = state.board;
      let aiMoves: {
        type: 'move' | 'action' | 'drop' | 'shared_drop' | 'custom_deck_drop';
        from?: [number, number];
        to: [number, number];
        weight: number;
        piece?: Piece;
        index?: number;
      }[] = [];

      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          const piece = board[y][x];
          if (piece && piece.owner === 'gote') {
            // 1. Regular Moves
            const moves = getValidMoves(y, x, board);
            moves.forEach(([ny, nx]) => {
              const target = board[ny][nx];
              let weight = 10;
              if (target) {
                if (target.isKing) weight = 1000;
                else if (target.isHisha || target.isKaku) weight = 200; // 大駒の捕獲価値
                else if (!target.isPawn) weight = 100; // カスタム駒の捕獲価値
                else if (getPieceTrigger(target) === 'ON_TAKEN' && getPieceLogicCode(target) === 'kill_adjacent') {
                  weight = 1; // 罠の自爆は避ける
                } else {
                  weight = 40; // 歩兵などの捕獲価値
                }
              }
              aiMoves.push({ type: 'move', from: [y, x], to: [ny, nx], weight });
            });
          }
        }
      }

      // 3. Drop pieces from hand
      const aiHand = state.capturedPieces.gote;
      if (aiHand.length > 0) {
        aiHand.forEach((piece, index) => {
          const validDropSpots = getValidDropCells(board, piece, 'gote');
          validDropSpots.forEach(([ey, ex]) => {
            let weight = 8;
            if (ey >= 3) weight += 5; // drop closer to Sente front
            aiMoves.push({ type: 'drop', to: [ey, ex], piece, index, weight });
          });
        });
      }

      // 3.5. Drop pieces from custom deck
      const aiCustomDeck = state.customDecks.gote;
      if (aiCustomDeck && aiCustomDeck.length > 0) {
        aiCustomDeck.forEach((piece, index) => {
          const validDropSpots = getValidDropCells(board, piece, 'gote');
          validDropSpots.forEach(([ey, ex]) => {
            let weight = 15; // Give slightly higher weight to playing custom pieces!
            if (ey >= 3) weight += 5; // drop closer to Sente front
            aiMoves.push({ type: 'custom_deck_drop', to: [ey, ex], piece, index, weight });
          });
        });
      }

      if (aiMoves.length === 0) {
        handlePassTurn();
        return;
      }

      aiMoves.sort((a, b) => b.weight - a.weight);
      const maxWeight = aiMoves[0].weight;
      const bestMoves = aiMoves.filter(m => m.weight === maxWeight);
      const chosenMove = bestMoves[Math.floor(Math.random() * bestMoves.length)];

      // Execute AI
      if (chosenMove.type === 'move' && chosenMove.from) {
        const targetPiece = board[chosenMove.to[0]][chosenMove.to[1]];
        if (targetPiece && getPieceLogicCode(targetPiece) === 'kill_adjacent') {
          setExplosionEffects(prev => [...prev, chosenMove.to]);
          setScreenShake(true);
          setTimeout(() => {
            setScreenShake(false);
            setExplosionEffects(prev => prev.filter(coord => coord[0] !== chosenMove.to[0] || coord[1] !== chosenMove.to[1]));
          }, 600);
        }

        const movingPiece = board[chosenMove.from[0]][chosenMove.from[1]]!;
        const promote = isPromotionEligible(movingPiece, chosenMove.from[0], chosenMove.to[0], 'gote');

        let res;
        try {
          res = executeMove(board, chosenMove.from, chosenMove.to, 'gote', promote, playerNames, vsAiMode, false, state.capturedPieces);
        } catch (err) {
          console.error("AI failed to execute move:", err);
          handlePassTurn();
          return;
        }

        let nextCaptured = {
          sente: [...state.capturedPieces.sente],
          gote: [...state.capturedPieces.gote]
        };
        const capturedList: Piece[] = [];
        if (res.capturedPieces && res.capturedPieces.length > 0) {
          capturedList.push(...res.capturedPieces);
        } else if (res.capturedPiece) {
          capturedList.push(res.capturedPiece);
        }

        for (const cap of capturedList) {
          if (cap) {
            const isStillOnBoard = res.board.some(row => row.some(p => p?.id === cap.id));
            if (!isStillOnBoard) {
              const cleanCap = {
                ...cap,
                isPromoted: false,
                coolDownTurnsRemaining: 0,
                isRevealed: true
              };
              if (!nextCaptured[cleanCap.owner].some(p => p.id === cleanCap.id)) {
                nextCaptured[cleanCap.owner] = [...nextCaptured[cleanCap.owner], cleanCap];
              }
            }
          }
        }

        let nextShared = [...state.sharedPieces];
        if (res.destroyedPieces && res.destroyedPieces.length > 0) {
          for (const p of res.destroyedPieces) {
            if (p && !p.isKing) {
              if (!nextShared.some(s => s.id === p.id)) {
                nextShared.push({
                  ...p,
                  isPromoted: p.isPromoted,
                  coolDownTurnsRemaining: 0,
                  isRevealed: true,
                  stunTurnsRemaining: 0,
                  deathCountdown: 0
                });
              }
            }
          }
        }

        const nextDestroyedPieces = [...state.destroyedPieces, ...(res.destroyedPieces || [])];
        const finalLogs = [...state.logs, ...res.logs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() }))];

        const events = [...(res.abilityEvents || [])];
        const landingPiece = res.board[chosenMove.to[0]][chosenMove.to[1]];
        if (landingPiece && landingPiece.owner === 'gote' && isTriggerMatching(landingPiece, 'ON_MOVE') && landingPiece.coolDownTurnsRemaining === 0) {
          events.push({
            id: generateId(),
            priority: 2,
            triggerType: 'ON_MOVE',
            pieceId: landingPiece.id,
            position: [chosenMove.to[0], chosenMove.to[1]],
            owner: 'gote',
            fromPosition: chosenMove.from
          });
        }

        // Process the asynchronous queue!
        await processAbilityEventsQueue(res.board, events, nextCaptured, nextShared, finalLogs, nextDestroyedPieces);

      } else if (chosenMove.type === 'drop' && chosenMove.piece && chosenMove.index !== undefined) {
        const nextBoard = executeDrop(board, chosenMove.piece, chosenMove.to, 'gote');
        const nextHand = [...state.capturedPieces.gote];
        nextHand.splice(chosenMove.index, 1);
        const nextCaptured = {
          ...state.capturedPieces,
          gote: nextHand
        };
        const newLog: GameLog = {
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: 'gote',
          message: `${chosenMove.piece.word}を持ち駒から配置しました。`,
          type: 'move'
        };
        finalizeTurn(nextBoard, nextCaptured, state.sharedPieces, [...state.logs, newLog], undefined, state.customDecks, state.destroyedPieces);

      } else if (chosenMove.type === 'custom_deck_drop' && chosenMove.piece && chosenMove.index !== undefined) {
        const nextBoard = executeDrop(board, chosenMove.piece, chosenMove.to, 'gote');
        const nextDeck = [...state.customDecks.gote];
        nextDeck.splice(chosenMove.index, 1);
        const nextCustomDecks = {
          ...state.customDecks,
          gote: nextDeck
        };
        const newLog: GameLog = {
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: 'gote',
          message: `${chosenMove.piece.word}をカスタムデッキから配置しました。`,
          type: 'move'
        };
        finalizeTurn(
          nextBoard,
          state.capturedPieces,
          state.sharedPieces,
          [...state.logs, newLog],
          undefined,
          nextCustomDecks,
          state.destroyedPieces
        );


      }
    };

    runAiTurn();
  }, [state.turn, state.phase, vsAiMode]);

  // CSS positioning for laser
  const getLaserStyle = (): React.CSSProperties => {
    if (!laserEffect) return { display: 'none' };
    const [fy, fx] = laserEffect.from;
    const [ty, tx] = laserEffect.to;

    const cellSize = 100 / BOARD_SIZE;
    const fromCenterX = (fx + 0.5) * cellSize;
    const fromCenterY = (fy + 0.5) * cellSize;
    const toCenterX = (tx + 0.5) * cellSize;
    const toCenterY = (ty + 0.5) * cellSize;

    const dx = toCenterX - fromCenterX;
    const dy = toCenterY - fromCenterY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);

    return {
      top: `${fromCenterY}%`,
      left: `${fromCenterX}%`,
      width: `${length}%`,
      transform: `rotate(${angle}deg)`,
      display: 'block',
    };
  };

  const getExplosionStyle = (y: number, x: number): React.CSSProperties => {
    const cellSize = 100 / BOARD_SIZE;
    const cx = (x + 0.5) * cellSize;
    const cy = (y + 0.5) * cellSize;
    return {
      top: `${cy}%`,
      left: `${cx}%`,
      transform: 'translate(-50%, -50%)',
    };
  };

  const selectedPieceObject = state.selectedCell ? state.board[state.selectedCell[0]][state.selectedCell[1]] : null;
  const shouldRotate = onlineMode
    ? (myRole === 'gote')
    : (vsAiMode ? false : state.turn === 'gote');

  return (
    <div
      className={`app-container ${screenShake ? 'screen-shake' : ''} phase-${state.phase}`}
      style={{ '--shake-intensity': screenShakeIntensity } as React.CSSProperties}
    >
      
      {/* Background Sakura Shower */}
      <SakuraShower />
      
      {/* ターン交代サイバーアラート */}
      {turnChangeAlert && (
        <div className={`turn-change-overlay ${turnChangeAlert === 'sente' ? 'sente-turn-alert' : 'gote-turn-alert'}`}>
          <div className="turn-change-content">
            <div className="turn-change-subtitle" style={{ color: 'var(--color-gold)' }}>SYSTEM STATUS UPDATE</div>
            <div className="turn-change-title" style={{ color: '#1A1A1A' }}>
              {turnChangeAlert === 'sente'
                ? `▲ ${playerNames.sente || 'プレイヤー1'} の手番`
                : `▽ ${playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} の手番`}
            </div>
            <div className="turn-change-bar" style={{ backgroundColor: 'var(--color-gold)' }} />
          </div>
        </div>
      )}

      {/* Header */}
      <header className="cyber-panel" style={{ padding: '12px 24px', margin: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.75)', border: '1px solid rgba(139, 92, 26, 0.15)', borderRadius: '16px' }}>
        <h1 className="cyber-title app-header-title" style={{ fontSize: '20px', borderBottom: 'none', paddingBottom: 0 }}>
          拡張将棋
        </h1>
        <div className="app-header-subtitle" style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-cyber)' }}>
          SAPIENS RUNTIME v3.0.0
        </div>
      </header>

      {/* Main Container */}
      <main className="main-content">
        
        {state.phase === 'start' ? (
          <StartScreen
            vsAiMode={vsAiMode}
            onSetVsAiMode={setVsAiMode}
            onlineMode={onlineMode}
            onSetOnlineMode={setOnlineMode}
            roomCode={roomCode}
            onCreateRoom={handleCreateRoom}
            onJoinRoom={handleJoinRoom}
            isWaitingForOpponent={isWaitingForOpponent}
            isSearchingMatch={isSearchingMatch}
            isRandomMatch={isRandomMatch}
            isConnectingHandshake={isConnectingHandshake}
            onRandomMatch={handleRandomMatchmaking}
            onCancelMatchmaking={handleCancelMatchmaking}
            matchmakingError={matchmakingError}
            playerNames={playerNames}
            onSetPlayerNames={(names) => {
              setPlayerNames(names);
              localStorage.setItem('shogi_player_name_sente', names.sente);
              localStorage.setItem('shogi_player_name_gote', names.gote);
            }}
            onStartGame={() => {
              setState(prev => ({ ...prev, phase: 'setup' }));
              addLog('対局準備を開始します。能力駒を作成してください。', 'system', 'sente');
            }}
          />
        ) : state.phase === 'setup' ? (
          <PieceCreator
            player={state.turn}
            onPiecesReady={handlePiecesCreated}
            geminiApiKey={state.geminiApiKey}
            vsAiMode={vsAiMode}
            setupSubPhase={setupSubPhase}
            onlineMode={onlineMode}
            myRole={myRole}
            onlineOpponentReady={
              onlineMode
                ? (myRole === 'sente' ? matchDoc?.gotePiecesReady : matchDoc?.sentePiecesReady)
                : false
            }
            onlineSelfReady={
              onlineMode
                ? (myRole === 'sente' ? matchDoc?.sentePiecesReady : matchDoc?.gotePiecesReady)
                : false
            }
            playerNames={playerNames}
          />
        ) : (
          <div className="game-board-container">
            
            <div className="game-layout-container">
              
              {/* Left Side: Game Board (9x9) */}
              <div className="board-wrapper">
                {/* ─── SELECTING_ABILITY_TARGET Notification & Cancel Banner ─── */}
                {state.phase === 'SELECTING_ABILITY_TARGET' && (
                  <div className="w-full bg-gradient-to-r from-red-950 via-black to-red-900 border-2 border-yellow-400 p-2.5 rounded-lg shadow-2xl flex items-center justify-between mb-2 -skew-x-2 z-50 animate-pulse">
                    <div className="flex items-center space-x-3">
                      <span className="bg-yellow-400 text-black font-black text-xs px-2.5 py-0.5 -skew-x-12 tracking-wider shrink-0">
                        TARGET SELECT
                      </span>
                      <span className="text-yellow-300 font-bold text-xs md:text-sm tracking-wide">
                        【能力発動】発動対象のマスまたは駒を選択してください
                      </span>
                    </div>
                    <button
                      onClick={handleCancelAbilitySelection}
                      className="bg-red-600 hover:bg-red-500 text-white font-black text-xs px-3 py-1 rounded border border-yellow-300 shadow-md transition-all active:scale-95 shrink-0 cursor-pointer"
                    >
                      [×] キャンセル
                    </button>
                  </div>
                )}
                <GameBoard
                  board={state.board}
                  tileBoard={state.tileBoard}
                  turn={state.turn}
                  phase={state.phase}
                  capturedPieces={state.capturedPieces}
                  customDecks={state.customDecks}
                  destroyedPieces={state.destroyedPieces}
                  sharedPieces={state.sharedPieces}
                  customPiecesToPlace={state.turn === 'sente' ? piecesToPlace.sente : piecesToPlace.gote}
                  selectedCell={state.selectedCell}
                  selectedCapturedPiece={selectedCapturedPiece}
                  selectedSharedPiece={selectedSharedPiece}
                  selectedCustomDeckPiece={selectedCustomDeckPiece}
                  validMoves={validMoves}
                  activeAbilityTargets={state.activeAbilityTargets}
                  activeAbilityMode={state.activeAbilityMode}
                  onCellClick={handleCellClick}
                  onCapturedPieceClick={handleCapturedPieceClick}
                  onCustomDeckPieceClick={handleCustomDeckPieceClick}
                  onSharedPieceClick={handleSharedPieceClick}
                  onHoverPiece={setHoveredPiece}
                  vsAiMode={vsAiMode}
                  isSenteChecked={isKingInCheck(state.board, 'sente')}
                  isGoteChecked={isKingInCheck(state.board, 'gote')}
                  onlineMode={onlineMode}
                  myRole={myRole}
                  playerNames={playerNames}
                  activeAbilityAnimation={activeAbilityAnimation}
                  explosionEffects={explosionEffects}
                />

                {/* Tactical Laser Beam */}
                {laserEffect && (
                  <div 
                    className="laser-effect"
                    style={{
                      ...getLaserStyle(),
                      position: 'absolute',
                      zIndex: 99,
                      transformOrigin: '0% 50%'
                    }}
                  />
                )}

                {/* Explosion Overlays */}
                {explosionEffects.map(([ey, ex], idx) => (
                  <div
                    key={idx}
                    className="explosion-effect"
                    style={{
                      ...getExplosionStyle(ey, ex),
                      position: 'absolute',
                      zIndex: 100
                    }}
                  />
                ))}

                {/* On-Board Promotion Dialog Overlay */}
                {state.promotionPending && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    zIndex: 200,
                    background: 'var(--color-washi)',
                    border: '1.5px solid var(--color-gold)',
                    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
                    borderRadius: '2px',
                    padding: '20px 28px',
                    textAlign: 'center',
                    minWidth: '200px',
                  }}>
                    <h3 style={{ color: 'var(--color-shinku)', fontFamily: 'var(--font-cyber)', fontSize: '14px', marginBottom: '6px', textTransform: 'uppercase' }}>
                      ▲ 覚醒（成る）の選択 ▲
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--color-kurogane)', marginBottom: '14px' }}>
                      <strong>{state.promotionPending.piece.word}</strong> を成りますか？<br/>
                      <span style={{ fontSize: '10px', color: '#555' }}>覚醒能力「{state.promotionPending.piece.isPawn ? 'と金' : state.promotionPending.piece.promoted_effect?.effect_name}」が解放されます。</span>
                    </p>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                      <button
                        className="cyber-btn cyber-btn-yellow"
                        style={{ padding: '8px 16px', fontSize: '12px' }}
                        onClick={() => handlePromotionDecision(true)}
                      >
                        成る (Yes)
                      </button>
                      <button
                        className="cyber-btn"
                        style={{ padding: '8px 16px', fontSize: '12px', borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}
                        onClick={() => handlePromotionDecision(false)}
                      >
                        不成 (No)
                      </button>
                    </div>
                  </div>
                )}
              </div>


              {/* Right Side: Tactical Controls */}
              <div className="control-wrapper">
                <ControlPanel
                  turn={state.turn}
                  phase={state.phase}
                  customPiecesToPlace={state.turn === 'sente' ? piecesToPlace.sente : piecesToPlace.gote}
                  winner={state.winner}
                  logs={state.logs}
                  selectedPiece={selectedPieceObject}
                  hoveredPiece={hoveredPiece}
                  onResetGame={handleResetGame}
                  onPassTurn={handlePassTurn}
                  vsAiMode={vsAiMode}
                  playerNames={playerNames}
                  capturedPieces={state.capturedPieces}
                  selectedCapturedPiece={selectedCapturedPiece}
                  onCapturedPieceClick={handleCapturedPieceClick}
                  customDecks={state.customDecks}
                  selectedCustomDeckPiece={selectedCustomDeckPiece}
                  onCustomDeckPieceClick={handleCustomDeckPieceClick}
                  sharedPieces={state.sharedPieces}
                  selectedSharedPiece={selectedSharedPiece}
                  onSharedPieceClick={handleSharedPieceClick}
                  onHoverPiece={setHoveredPiece}
                  isResurrectActive={state.activeAbilityMode && suspendedAbility?.type === 'resurrect'}
                  isViewerOpponent={shouldRotate}
                />
              </div>

            </div>

          </div>
        )}

      </main>

      {/* Glitched Check/王手 Alert Overlay */}
      {showCheckOverlay && (
        <div className="check-alert-overlay-fixed">
          <div className="check-stamp">
            <div className="check-text">王手</div>
            <div className="check-subtitle">CHECK DETECTED</div>
          </div>
        </div>
      )}

      {/* Cyberpunk Victory/Defeat Fullscreen Overlay */}
      {state.winner && (() => {
        const winnerName = state.winner === 'sente'
          ? (playerNames.sente || 'プレイヤー1')
          : (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'));
        const loserName = state.winner === 'sente'
          ? (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'))
          : (playerNames.sente || 'プレイヤー1');

        const isUserWinner = onlineMode
          ? state.winner === myRole
          : vsAiMode
            ? state.winner === 'sente'
            : null;

        let themeClass = '';
        let titleText = '';
        let subtitleText = '';
        let detailsText = '';

        if (isUserWinner === true) {
          themeClass = 'victory-theme';
          titleText = '作戦完了';
          subtitleText = `🏆 ${winnerName} の勝利 / MISSION ACCOMPLISHED`;
          detailsText = '敵陣営の王将の完全排除を確認。戦略的勝利を達成しました。';
        } else if (isUserWinner === false) {
          themeClass = 'defeat-theme';
          titleText = '作戦失敗';
          subtitleText = `💀 ${winnerName} の勝利 / MISSION FAILED`;
          detailsText = '玉将の機能停止を検知。防衛システム限界。直ちに後退してください。';
        } else {
          // Local Mode
          themeClass = state.winner === 'sente' ? 'victory-theme' : 'defeat-theme';
          titleText = '対局終了';
          subtitleText = `🏆 ${winnerName} の勝利 / GAME OVER`;
          detailsText = `${winnerName} が ${loserName} に勝利しました。卓越した戦略による完全勝利です。`;
        }

        return (
          <div className={`game-over-overlay ${themeClass}`}>
            <div className="game-over-panel">
              <h1 className="game-over-title">
                {titleText}
              </h1>
              <div className="game-over-subtitle">
                {subtitleText}
              </div>
              <p className="game-over-details">
                {winnerName} が {loserName} に勝利しました。<br />
                {detailsText}
              </p>
              <button className="cyber-btn game-over-btn" onClick={handleResetGame}>
                再起動 (REBOOT SYSTEM)
              </button>
            </div>
          </div>
        );
      })()}
      {/* Persona 5 / P3R Styled Cutin Overlay */}
      <PersonaCutin
        type={cutinState.type}
        title={cutinState.title}
        subtitle={cutinState.subtitle}
        comboHits={cutinState.comboHits}
        gambleResult={cutinState.gambleResult}
        onComplete={handleCutinComplete}
      />
    </div>
  );
};
