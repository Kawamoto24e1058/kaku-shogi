import React, { useState, useEffect, useCallback } from 'react';
import type { GameState, Piece, Player, Board, GameLog, HistoryState } from './types';
import {
  initializeBoard,
  getValidMoves,
  executeMove,
  applyAutomatedEffect,
  executeDrop,
  BOARD_SIZE,
  getCellLabel,
  getPieceLogicCode,
  getPieceTrigger,
  generateId,
  getValidDropCells,
  isKingInCheck,
  getAbilityTargets,
} from './gameLogic';
import { PieceCreator } from './components/PieceCreator';
import { GameBoard } from './components/GameBoard';
import { ControlPanel } from './components/ControlPanel';
import { getRandomCachedPieces } from './aiGenerator';
import { StartScreen } from './components/StartScreen';
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

export const App: React.FC = () => {
  // ユーザー名の読み込み（localStorage から）
  const savedSenteName = typeof window !== 'undefined' ? (localStorage.getItem('shogi_player_name_sente') || '') : '';
  const savedGoteName  = typeof window !== 'undefined' ? (localStorage.getItem('shogi_player_name_gote')  || '') : '';

  const [playerNames, setPlayerNames] = useState<{ sente: string; gote: string }>({
    sente: savedSenteName,
    gote: savedGoteName,
  });

  const getPlayerName = (owner: 'sente' | 'gote') => {
    return owner === 'sente'
      ? (playerNames.sente || 'プレイヤー1')
      : (playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2'));
  };

  const [state, setState] = useState<GameState>({
    board: initializeBoard(),
    turn: 'sente',
    phase: 'start',
    customPieces: { sente: [], gote: [] },
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
  const [hoveredPiece, setHoveredPiece] = useState<Piece | null>(null);
  const [validMoves, setValidMoves] = useState<[number, number][]>([]);
  const [vsAiMode, setVsAiMode] = useState<boolean>(true);
  const [onlineMode, setOnlineMode] = useState<boolean>(false);
  const [roomCode, setRoomCode] = useState<string>('');
  const [myRole, setMyRole] = useState<'sente' | 'gote' | null>(null);
  const [isWaitingForOpponent, setIsWaitingForOpponent] = useState<boolean>(false);
  const [isSearchingMatch, setIsSearchingMatch] = useState<boolean>(false);
  const [isRandomMatch, setIsRandomMatch] = useState<boolean>(false);
  const [matchmakingError, setMatchmakingError] = useState<string>('');
  const [matchDoc, setMatchDoc] = useState<any>(null);

  const [suspendedAbility, setSuspendedAbility] = useState<{
    source: [number, number];
    targets: [number, number][];
    type: 'transform' | 'mind_control' | 'swap';
    triggerType: 'ON_MOVE' | 'TURN_START';
    fromPosition?: [number, number];
    board: Board;
    capturedPieces: typeof state.capturedPieces;
    logs: GameLog[];
    customStateUpdates?: Partial<GameState>;
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
          piece.mechanics_type === 'STEALTH_TRAP' &&
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
            return { ...piece, isRevealed: true };
          }

          if (piece.isRevealed && !hasAdjacentOpponent) {
            logs.push({
              id: generateId(),
              timestamp: new Date().toLocaleTimeString(),
              player: piece.owner,
              message: `🌫️ 【再隠蔽】${getPlayerName(piece.owner)}の『${piece.word}』の周囲から敵が立ち去ったため、再びステルス状態（透明）に戻りました。`,
              type: 'ability'
            });
            return { ...piece, isRevealed: false };
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
    if (piece.isPawn) {
      if (owner === 'sente' && toY === 0) return true;
      if (owner === 'gote' && toY === 8) return true;
    }
    return false;
  };

  const isAutoNormalMover = (p: Piece | null): boolean => {
    if (!p) return false;
    return p.trigger === 'ALWAYS' && (getPieceLogicCode(p).includes('runaway') || p.description.includes('操作不能'));
  };

  const isAutonomous = (p: Piece | null): boolean => {
    if (!p) return false;
    const logicCode = getPieceLogicCode(p);
    return logicCode === 'random_teleport' || isAutoNormalMover(p);
  };

  const executeMoveWithPromotion = (
    sy: number,
    sx: number,
    y: number,
    x: number,
    promote: boolean
  ) => {
    const res = executeMove(state.board, [sy, sx], [y, x], state.turn, promote, playerNames, vsAiMode);

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
            owner: state.turn,
            isPromoted: false,
            coolDownTurnsRemaining: 0,
            isRevealed: true
          };
          if (!nextCaptured[state.turn].some(p => p.id === cleanCap.id)) {
            nextCaptured[state.turn] = [...nextCaptured[state.turn], cleanCap];
          }
        }
      }
    }

    let finalBoard = res.board;
    const finalLogs = [...state.logs, ...res.logs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() }))];

    // Check for ON_MOVE automatic trigger
    const landingPiece = finalBoard[y][x];
    if (landingPiece && landingPiece.owner === state.turn && getPieceTrigger(landingPiece) === 'ON_MOVE' && landingPiece.coolDownTurnsRemaining === 0) {
      const targetsInfo = getAbilityTargets(finalBoard, [y, x], state.turn);
      if (targetsInfo && isPieceOwnerHuman(state.turn)) {
        // Suspend!
        setSuspendedAbility({
          source: [y, x],
          targets: targetsInfo.targets,
          type: targetsInfo.type,
          triggerType: 'ON_MOVE',
          fromPosition: [sy, sx],
          board: finalBoard,
          capturedPieces: nextCaptured,
          logs: finalLogs
        });
        
        setState(prev => ({
          ...prev,
          board: finalBoard,
          capturedPieces: nextCaptured,
          selectedCell: null,
          activeAbilityMode: true,
          activeAbilitySource: [y, x],
          activeAbilityTargets: targetsInfo.targets
        }));
        return; // Return early, do NOT finalize turn yet!
      } else {
        const effectRes = applyAutomatedEffect(finalBoard, [y, x], 'ON_MOVE', state.turn, nextCaptured[state.turn], [sy, sx]);
        if (effectRes.triggered || effectRes.logs.length > 0) {
          if (effectRes.triggered) {
            finalBoard = effectRes.board;
            nextCaptured[state.turn] = effectRes.capturedPieces;
            setScreenShake(true);
            setTimeout(() => setScreenShake(false), 300);
          }
          finalLogs.push(...effectRes.logs.map(l => ({
            ...l,
            id: generateId(),
            timestamp: new Date().toLocaleTimeString()
          })));
        }
      }
    }

    // 移動前の玉将の位置を探しておく
    let prevSenteKingPos: [number, number] | null = null;
    let prevGoteKingPos: [number, number] | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = state.board[r][c];
        if (p?.isKing) {
          if (p.owner === 'sente') prevSenteKingPos = [r, c];
          else prevGoteKingPos = [r, c];
        }
      }
    }

    // Check if game over conditions are met after ON_MOVE effect
    const senteKing = finalBoard.some(row => row.some(p => p?.isKing && p.owner === 'sente'));
    const goteKing = finalBoard.some(row => row.some(p => p?.isKing && p.owner === 'gote'));
    let isGameOver = res.gameOver;
    let finalWinner = res.winner;

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

    if (isGameOver) {
      // 破壊された玉将の位置に多重グリッチ爆発エフェクトをトリガー
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
      }));

      setTimeout(() => {
        setState(prev => ({
          ...prev,
          winner: finalWinner,
        }));
        saveHistorySnapshot(finalBoard, nextCaptured, state.turn, finalLogs);
        syncOnlineState(
          finalBoard,
          state.turn,
          'finished',
          finalWinner,
          nextCaptured,
          state.sharedPieces,
          finalLogs
        );
      }, 1200);
    } else {
      finalizeTurn(
        finalBoard,
        nextCaptured,
        state.sharedPieces,
        finalLogs,
        { promotionPending: null }
      );
    }
  };

  const handlePromotionDecision = (promote: boolean) => {
    if (!state.promotionPending) return;
    const { from, to } = state.promotionPending;
    const [sy, sx] = from;
    const [y, x] = to;

    executeMoveWithPromotion(sy, sx, y, x, promote);
  };

  // FX visual states
  const [screenShake, setScreenShake] = useState(false);
  const [laserEffect] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const [explosionEffects, setExplosionEffects] = useState<[number, number][]>([]);
  const [showCheckOverlay, setShowCheckOverlay] = useState<boolean>(false);

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

  // 2.5. ランダムマッチング処理
  const handleRandomMatchmaking = async () => {
    setMatchmakingError('');
    setIsSearchingMatch(true);
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
        setIsSearchingMatch(false);
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
      setMatchmakingError(err.message || 'マッチング中にエラーが発生しました。');
      setIsSearchingMatch(false);
    }
  };

  const handleCancelMatchmaking = async () => {
    setMatchmakingError('');
    setIsSearchingMatch(false);
    setIsWaitingForOpponent(false);
    setIsRandomMatch(false);
    
    const clientDeviceId = getOrCreateDeviceId();
    
    try {
      await deleteDoc(doc(db, 'matchmaking_queue', clientDeviceId));
      
      if (roomCode && myRole === 'sente') {
        const matchRef = doc(db, 'matches', roomCode);
        const snap = await getDoc(matchRef);
        if (snap.exists() && snap.data().status === 'waiting') {
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

  // 3. リアルタイムFirestoreリスナーおよび再同期ロジック
  const updateLocalStateFromMatchData = useCallback((data: any) => {
    setMatchDoc(data);

    // 相手のユーザー名を反映
    setPlayerNames(prev => {
      const newNames = { ...prev };
      if (myRole === 'sente' && data.goteName) newNames.gote = data.goteName;
      if (myRole === 'gote' && data.senteName) newNames.sente = data.senteName;
      return newNames;
    });

    if (data.status === 'setup') {
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
      setIsWaitingForOpponent(false);
    } else if (data.status === 'playing') {
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
  }, [myRole]);

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
      
      let nextBoard = initializeBoard();
      
      // 先手能力駒の自動配置
      const senteAvailable: [number, number][] = [];
      for (let y = 6; y <= 8; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (nextBoard[y][x] === null) senteAvailable.push([y, x]);
        }
      }
      senteAvailable.sort(() => Math.random() - 0.5);
      sentePieces.forEach((piece, index) => {
        if (index < senteAvailable.length) {
          const [cy, cx] = senteAvailable[index];
          nextBoard[cy][cx] = {
            ...piece,
            originalPosition: [cy, cx],
            coolDownTurnsRemaining: 0,
            isRevealed: piece.mechanics_type === 'STEALTH_TRAP' ? false : true,
          };
        }
      });

      // 後手能力駒の自動配置
      const goteAvailable: [number, number][] = [];
      for (let y = 0; y <= 2; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          if (nextBoard[y][x] === null) goteAvailable.push([y, x]);
        }
      }
      goteAvailable.sort(() => Math.random() - 0.5);
      gotePieces.forEach((piece, index) => {
        if (index < goteAvailable.length) {
          const [cy, cx] = goteAvailable[index];
          nextBoard[cy][cx] = {
            ...piece,
            originalPosition: [cy, cx],
            coolDownTurnsRemaining: 0,
            isRevealed: piece.mechanics_type === 'STEALTH_TRAP' ? false : true,
          };
        }
      });

      const nextLogs = [
        ...matchDoc.logs,
        { player: 'system', message: `${matchDoc.senteName || 'プレイヤー1'} の能力駒を自動配置しました。`, type: 'system' },
        { player: 'system', message: `${matchDoc.goteName || 'プレイヤー2'} の能力駒を自動配置しました。`, type: 'system' },
        { player: 'system', message: '対局を開始します！', type: 'system' }
      ];

      const docRef = doc(db, 'matches', roomCode);
      updateDoc(docRef, {
        status: 'playing',
        board: JSON.stringify(nextBoard),
        customPieces: { sente: sentePieces, gote: gotePieces },
        capturedPieces: JSON.stringify({ sente: [], gote: [] }),
        sharedPieces: JSON.stringify([]),
        turn: 'sente',
        logs: nextLogs,
        logsJson: JSON.stringify(nextLogs),
        lastUpdated: Date.now()
      }).catch(err => console.error("Error setting up online board:", err));
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
    logs: GameLog[]
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
      logsJson: JSON.stringify(logs),
      logs: logs,
      lastUpdated: Date.now()
    }).catch(err => console.error("Error syncing online state:", err));
  }, [onlineMode, roomCode]);

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
  const saveHistorySnapshot = (board: Board, captured: typeof state.capturedPieces, turn: Player, logs: GameLog[]) => {
    const snapshot: HistoryState = {
      turnNumber: state.historyStates.length + 1,
      boardJson: JSON.stringify(board),
      capturedPiecesJson: JSON.stringify(captured),
      turn,
      logsJson: JSON.stringify(logs),
    };
    setState(prev => ({
      ...prev,
      historyStates: [...prev.historyStates, snapshot]
    }));
  };

  // Turn Change Finalizer (ticks cooldowns)
  const finalizeTurn = (
    nextBoard: Board,
    nextCaptured: typeof state.capturedPieces,
    nextShared: Piece[],
    nextLogs: GameLog[],
    customStateUpdates?: Partial<GameState>
  ) => {
    const nextPlayer = (state.turn === 'sente' ? 'gote' : 'sente') as Player;

    // Scan original king positions in nextBoard
    let prevSenteKingPos: [number, number] | null = null;
    let prevGoteKingPos: [number, number] | null = null;
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = nextBoard[r][c];
        if (p?.isKing) {
          if (p.owner === 'sente') prevSenteKingPos = [r, c];
          else prevGoteKingPos = [r, c];
        }
      }
    }



    // Decrement cooldowns and curses for nextPlayer's pieces on the board
    const updatedLogsList: GameLog[] = [];
    const finalBoard = nextBoard.map((row, r) =>
      row.map((piece, c) => {
        if (!piece) return null;
        if (piece.owner === nextPlayer) {
          const updated = { ...piece };
          let died = false;
          
          if (updated.coolDownTurnsRemaining > 0) {
            updated.coolDownTurnsRemaining -= 1;
          }
          
          if (updated.stunTurnsRemaining && updated.stunTurnsRemaining > 0) {
            updated.stunTurnsRemaining -= 1;
            if (updated.stunTurnsRemaining === 0) {
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: nextPlayer,
                message: `【呪縛解除】${piece.word} (${getCellLabel(r, c)}) の呪縛（行動封印）が解けました！`,
                type: 'system'
              });
            }
          }
          
          if (updated.deathCountdown && updated.deathCountdown > 0) {
            updated.deathCountdown -= 1;
            if (updated.deathCountdown === 0) {
              died = true;
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: nextPlayer,
                message: `【死の宣告】${piece.word} (${getCellLabel(r, c)}) は死の宣告の刻限を迎え、塵となって消滅しました…`,
                type: 'system'
              });
            } else {
              updatedLogsList.push({
                id: generateId(),
                timestamp: new Date().toLocaleTimeString(),
                player: nextPlayer,
                message: `【死の宣告】${piece.word} (${getCellLabel(r, c)}) の消滅まであと ${updated.deathCountdown} 手番。`,
                type: 'system'
              });
            }
          }
          
          return died ? null : updated;
        }
        return piece;
      })
    );

    nextLogs.push(...updatedLogsList);

    let currentBoard = finalBoard;
    const currentCaptured = {
      sente: [...nextCaptured.sente],
      gote: [...nextCaptured.gote],
    };
    const currentLogs = [...nextLogs];
    let gameOver = false;
    let winner: Player | null = null;

    // Scan and apply TURN_START automated triggers for nextPlayer
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = currentBoard[r][c];
        if (p && p.owner === nextPlayer && getPieceTrigger(p) === 'TURN_START' && p.coolDownTurnsRemaining === 0) {
          const targetsInfo = getAbilityTargets(currentBoard, [r, c], nextPlayer);
          if (targetsInfo && isPieceOwnerHuman(nextPlayer)) {
            // Suspend turn start!
            setSuspendedAbility({
              source: [r, c],
              targets: targetsInfo.targets,
              type: targetsInfo.type,
              triggerType: 'TURN_START',
              board: currentBoard,
              capturedPieces: currentCaptured,
              logs: currentLogs,
              customStateUpdates
            });

            setState(prev => ({
              ...prev,
              board: currentBoard,
              capturedPieces: currentCaptured,
              turn: nextPlayer, // SWITCH TURN NOW!
              selectedCell: null,
              activeAbilityMode: true,
              activeAbilitySource: [r, c],
              activeAbilityTargets: targetsInfo.targets,
              logs: currentLogs,
              ...customStateUpdates
            }));
            return; // Return early, do NOT finish finalization yet!
          } else {
            const effectRes = applyAutomatedEffect(currentBoard, [r, c], 'TURN_START', nextPlayer, currentCaptured[nextPlayer]);
            if (effectRes.triggered || effectRes.logs.length > 0) {
              if (effectRes.triggered) {
                currentBoard = effectRes.board;
                currentCaptured[nextPlayer] = effectRes.capturedPieces;
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

    // Check game over conditions after TURN_START triggers
    const sKing = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'sente'));
    const gKing = currentBoard.some(row => row.some(piece => piece?.isKing && piece.owner === 'gote'));
    if (!sKing && !gKing) {
      gameOver = true;
      winner = nextPlayer === 'sente' ? 'gote' : 'sente';
    } else if (!sKing) {
      gameOver = true;
      winner = 'gote';
    } else if (!gKing) {
      gameOver = true;
      winner = 'sente';
    }

    // Scan for autonomous pieces of nextPlayer
    const autonomousCoords: [number, number][] = [];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const p = currentBoard[r][c];
        if (p && p.owner === nextPlayer && isAutoNormalMover(p) && p.coolDownTurnsRemaining === 0) {
          autonomousCoords.push([r, c]);
        }
      }
    }

    // Execute moves for autonomous pieces
    for (const [sy, sx] of autonomousCoords) {
      if (gameOver) break;
      const piece = currentBoard[sy][sx];
      if (!piece || piece.owner !== nextPlayer || !isAutoNormalMover(piece)) continue;

      const valid = getValidMoves(sy, sx, currentBoard);
      if (valid.length > 0) {
        const [ty, tx] = valid[Math.floor(Math.random() * valid.length)];
        const promote = isPromotionEligible(piece, sy, ty, nextPlayer);
        
        const moveRes = executeMove(currentBoard, [sy, sx], [ty, tx], nextPlayer, promote, playerNames, vsAiMode);
        
        currentBoard = moveRes.board;
        if (moveRes.gameOver) {
          gameOver = true;
          winner = moveRes.winner;
        }

        currentLogs.push({
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: nextPlayer,
          message: `【自律行動】操作不能の『${piece.word}』が勝手に${getCellLabel(ty, tx)}へ移動しました！`,
          type: 'ability'
        });

        currentLogs.push(...moveRes.logs.map(l => ({
          ...l,
          id: generateId(),
          timestamp: new Date().toLocaleTimeString()
        })));

        const capturedList: Piece[] = [];
        if (moveRes.capturedPieces && moveRes.capturedPieces.length > 0) {
          capturedList.push(...moveRes.capturedPieces);
        } else if (moveRes.capturedPiece) {
          capturedList.push(moveRes.capturedPiece);
        }

        for (const cap of capturedList) {
          if (cap) {
            const isStillOnBoard = currentBoard.some(row => row.some(p => p?.id === cap.id));
            if (!isStillOnBoard) {
              const cleanCap = {
                ...cap,
                owner: nextPlayer,
                isPromoted: false,
                coolDownTurnsRemaining: 0,
                isRevealed: true
              };
              if (!currentCaptured[nextPlayer].some(p => p.id === cleanCap.id)) {
                currentCaptured[nextPlayer].push(cleanCap);
              }
            }
          }
        }
      }
    }

    // === すべての自動効果完了後にステルス近接スキャンを実行 ===
    // TURN_START生成駒や自律移動駒も含めた最終的な盤面状態でチェックする
    currentBoard = scanStealthPieces(currentBoard, currentLogs);

    if (gameOver) {
      // 破壊された玉将の位置に多重グリッチ爆発エフェクトをトリガー
      const destroyedKingPositions: [number, number][] = [];
      const finalSenteKing = currentBoard.some(row => row.some(p => p?.isKing && p.owner === 'sente'));
      const finalGoteKing = currentBoard.some(row => row.some(p => p?.isKing && p.owner === 'gote'));

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
        sharedPieces: nextShared,
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
        saveHistorySnapshot(currentBoard, currentCaptured, nextPlayer, currentLogs);
        syncOnlineState(
          currentBoard,
          nextPlayer,
          'finished',
          winner,
          currentCaptured,
          nextShared,
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
        board: currentBoard,
        capturedPieces: currentCaptured,
        sharedPieces: nextShared,
        turn: nextPlayer,
        selectedCell: null,
        activeAbilityMode: false,
        activeAbilitySource: null,
        activeAbilityTargets: [],
        logs: currentLogs,
        ...customStateUpdates,
      };
      saveHistorySnapshot(currentBoard, currentCaptured, nextPlayer, currentLogs);
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
      currentLogs
    );
  };

  const resumeAbilitySelection = (ty: number, tx: number) => {
    if (!suspendedAbility) return;

    const { source, triggerType, fromPosition, board, capturedPieces, logs, customStateUpdates } = suspendedAbility;
    const [sy, sx] = source;
    const activePlayer = board[sy][sx]?.owner;
    if (!activePlayer) return;

    let finalBoard = board;
    const nextCaptured = { ...capturedPieces };
    const finalLogs = [...logs];

    const effectRes = applyAutomatedEffect(
      finalBoard,
      source,
      triggerType,
      activePlayer,
      capturedPieces[activePlayer],
      fromPosition,
      [ty, tx]
    );

    if (effectRes.triggered || effectRes.logs.length > 0) {
      if (effectRes.triggered) {
        finalBoard = effectRes.board;
        nextCaptured[activePlayer] = effectRes.capturedPieces;
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
            state.sharedPieces,
            finalLogs
          );
        }, 1200);
      } else {
        finalizeTurn(
          finalBoard,
          nextCaptured,
          state.sharedPieces,
          finalLogs,
          { promotionPending: null }
        );
      }
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
          if (p && p.owner === activePlayer && getPieceTrigger(p) === 'TURN_START' && p.coolDownTurnsRemaining === 0) {
            const targetsInfo = getAbilityTargets(currentBoard, [r, c], activePlayer);
            if (targetsInfo && isPieceOwnerHuman(activePlayer)) {
              setSuspendedAbility({
                source: [r, c],
                targets: targetsInfo.targets,
                type: targetsInfo.type,
                triggerType: 'TURN_START',
                board: currentBoard,
                capturedPieces: currentCaptured,
                logs: currentLogs,
                customStateUpdates
              });

              setState(prev => ({
                ...prev,
                board: currentBoard,
                capturedPieces: currentCaptured,
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
              const effectRes = applyAutomatedEffect(currentBoard, [r, c], 'TURN_START', activePlayer, currentCaptured[activePlayer]);
              if (effectRes.triggered || effectRes.logs.length > 0) {
                if (effectRes.triggered) {
                  currentBoard = effectRes.board;
                  currentCaptured[activePlayer] = effectRes.capturedPieces;
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

      // Autonomous moves
      const autonomousCoords: [number, number][] = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          const p = currentBoard[r][c];
          if (p && p.owner === activePlayer && isAutoNormalMover(p) && p.coolDownTurnsRemaining === 0) {
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
          const moveRes = executeMove(currentBoard, [sy, sx], [ty, tx], activePlayer, promote, playerNames, vsAiMode);
          
          currentBoard = moveRes.board;
          if (moveRes.gameOver) {
            gameOver = true;
            winner = moveRes.winner;
          }

          currentLogs.push({
            id: generateId(),
            timestamp: new Date().toLocaleTimeString(),
            player: activePlayer,
            message: `【自律行動】操作不能の『${piece.word}』が勝手に${getCellLabel(ty, tx)}へ移動しました！`,
            type: 'ability'
          });

          currentLogs.push(...moveRes.logs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() })));

          const capturedList: Piece[] = [];
          if (moveRes.capturedPieces && moveRes.capturedPieces.length > 0) {
            capturedList.push(...moveRes.capturedPieces);
          } else if (moveRes.capturedPiece) {
            capturedList.push(moveRes.capturedPiece);
          }

          for (const cap of capturedList) {
            if (cap) {
              const isStillOnBoard = currentBoard.some(row => row.some(p => p?.id === cap.id));
              if (!isStillOnBoard) {
                const cleanCap = {
                  ...cap,
                  owner: activePlayer,
                  isPromoted: false,
                  coolDownTurnsRemaining: 0,
                  isRevealed: true
                };
                if (!currentCaptured[activePlayer].some(p => p.id === cleanCap.id)) {
                  currentCaptured[activePlayer].push(cleanCap);
                }
              }
            }
          }
        }
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
            state.sharedPieces,
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

      setValidMoves([]);

      syncOnlineState(
        currentBoard,
        activePlayer,
        'playing',
        null,
        currentCaptured,
        state.sharedPieces,
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
    let nextBoard = state.board.map(row => [...row]);

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
    sentePieces.forEach((piece, index) => {
      if (index < senteAvailable.length) {
        const [cy, cx] = senteAvailable[index];
        nextBoard[cy][cx] = {
          ...piece,
          originalPosition: [cy, cx] as [number, number],
          coolDownTurnsRemaining: 0,
          isRevealed: piece.mechanics_type === 'STEALTH_TRAP' ? false : true,
        };
      }
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
    gotePieces.forEach((piece, index) => {
      if (index < goteAvailable.length) {
        const [cy, cx] = goteAvailable[index];
        nextBoard[cy][cx] = {
          ...piece,
          originalPosition: [cy, cx] as [number, number],
          coolDownTurnsRemaining: 0,
          isRevealed: piece.mechanics_type === 'STEALTH_TRAP' ? false : true,
        };
      }
    });

    setState(prev => ({
      ...prev,
      board: nextBoard,
      phase: 'playing',
      turn: 'sente',
      customPieces: { sente: sentePieces, gote: gotePieces }
    }));

    setPiecesToPlace({ sente: [], gote: [] });

    addLog(`${playerNames.sente || 'プレイヤー1'} の能力駒を自動配置しました。`, 'system', 'sente');
    addLog(`${playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} の能力駒を自動配置しました。`, 'system', 'gote');
    addLog('対局を開始します！', 'system', 'sente');
  };

  // Setup Phase: Piece creator callbacks
  const handlePiecesCreated = async (pieces: Piece[]) => {
    if (onlineMode) {
      const docRef = doc(db, 'matches', roomCode);
      if (myRole === 'sente') {
        await updateDoc(docRef, {
          sentePieces: pieces,
          sentePiecesReady: true,
          logs: arrayUnion({ player: 'system', message: `▲ ${playerNames.sente || 'プレイヤー1'} が能力駒の構築を完了しました！`, type: 'system' })
        });
      } else {
        await updateDoc(docRef, {
          gotePieces: pieces,
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
        const gotePieces: Piece[] = gotePiecesData.map(pieceData => ({
          ...pieceData,
          id: Math.random().toString(36).substring(2, 11),
          owner: 'gote',
          isKing: false,
          isPawn: false,
          originalPosition: null,
          coolDownTurnsRemaining: 0,
          isRevealed: pieceData.mechanics_type === 'STEALTH_TRAP' ? false : true,
          isPromoted: false,
        }));

        setPiecesToPlace(prev => ({ ...prev, gote: gotePieces }));
        addLog(`🤖 Gemini AI の能力駒ロード完了（${gotePieces.map(p => p.mechanics_type === 'STEALTH_TRAP' ? '？' : p.word).join('・')}）`, 'system', 'gote');
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
    pieceToPlace.isRevealed = pieceToPlace.mechanics_type === 'STEALTH_TRAP' ? false : true;
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

    // Case 1: Drop selected captured piece OR shared piece
    if (selectedCapturedPiece || selectedSharedPiece) {
      const isValid = validMoves.some(([my, mx]) => my === y && mx === x);
      if (!isValid) {
        setSelectedCapturedPiece(null);
        setSelectedSharedPiece(null);
        setValidMoves([]);
        return;
      }
      
      const targetPiece = selectedCapturedPiece ? selectedCapturedPiece.piece : selectedSharedPiece!.piece;
      const nextBoard = executeDrop(state.board, targetPiece, [y, x], state.turn);
      
      let nextHand = [...state.capturedPieces[state.turn]];
      let nextShared = [...state.sharedPieces];

      if (selectedCapturedPiece) {
        nextHand.splice(selectedCapturedPiece.index, 1);
      } else {
        nextShared.splice(selectedSharedPiece!.index, 1);
      }

      const newLog: GameLog = {
        id: generateId(),
        timestamp: new Date().toLocaleTimeString(),
        player: state.turn,
        message: `${targetPiece.word}を${selectedCapturedPiece ? '持ち駒' : '共有プール'}から打ちました。`,
        type: 'move'
      };
      const nextCaptured = {
        ...state.capturedPieces,
        [state.turn]: nextHand,
      };

      finalizeTurn(nextBoard, nextCaptured, nextShared, [...state.logs, newLog]);
      setSelectedCapturedPiece(null);
      setSelectedSharedPiece(null);
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
    if (onlineMode && state.turn !== myRole) return;
    if (state.activeAbilityMode && suspendedAbility) {
      const isTarget = state.activeAbilityTargets.some(([ty, tx]) => ty === y && tx === x);
      if (isTarget) {
        resumeAbilitySelection(y, x);
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
    if (onlineMode && state.turn !== myRole) return;
    if (state.phase !== 'playing' || state.winner) return;
    if (owner !== state.turn) return;

    setSelectedCapturedPiece({ piece, index });
    setSelectedSharedPiece(null);
    setState(prev => ({ ...prev, selectedCell: null, activeAbilityMode: false, activeAbilityTargets: [] }));

    // Use drop-rule-aware valid cells (Nifu, No-move Drop)
    setValidMoves(getValidDropCells(state.board, piece, state.turn));
  };

  // Click Shared fantasy pool piece
  const handleSharedPieceClick = (piece: Piece, index: number) => {
    if (onlineMode && state.turn !== myRole) return;
    if (state.phase !== 'playing' || state.winner) return;

    setSelectedSharedPiece({ piece, index });
    setSelectedCapturedPiece(null);
    setState(prev => ({ ...prev, selectedCell: null, activeAbilityMode: false, activeAbilityTargets: [] }));

    // Use drop-rule-aware valid cells for shared pool pieces too
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
        type: 'move' | 'action' | 'drop' | 'shared_drop';
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

      // 4. Drop from shared pool
      const sharedPool = state.sharedPieces;
      if (sharedPool.length > 0) {
        sharedPool.forEach((piece, index) => {
          const validDropSpots = getValidDropCells(board, piece, 'gote');
          validDropSpots.forEach(([ey, ex]) => {
            let weight = 12;
            if (ey >= 3) weight += 4;
            aiMoves.push({ type: 'shared_drop', to: [ey, ex], piece, index, weight });
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

        const res = executeMove(board, chosenMove.from, chosenMove.to, 'gote', promote, playerNames, vsAiMode);
        const nextCaptured = { ...state.capturedPieces };
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
                owner: 'gote' as Player,
                isPromoted: false,
                coolDownTurnsRemaining: 0,
                isRevealed: true
              };
              if (!nextCaptured.gote.some(p => p.id === cleanCap.id)) {
                nextCaptured.gote = [...nextCaptured.gote, cleanCap];
              }
            }
          }
        }

        let finalBoard = res.board;
        const finalLogs = [...state.logs, ...res.logs.map(l => ({ ...l, id: generateId(), timestamp: new Date().toLocaleTimeString() }))];

        // Check for ON_MOVE automatic trigger
        const landingPiece = finalBoard[chosenMove.to[0]][chosenMove.to[1]];
        if (landingPiece && landingPiece.owner === 'gote' && getPieceTrigger(landingPiece) === 'ON_MOVE' && landingPiece.coolDownTurnsRemaining === 0) {
          const effectRes = applyAutomatedEffect(finalBoard, chosenMove.to, 'ON_MOVE', 'gote', nextCaptured.gote, chosenMove.from);
          if (effectRes.triggered || effectRes.logs.length > 0) {
            if (effectRes.triggered) {
              finalBoard = effectRes.board;
              nextCaptured.gote = effectRes.capturedPieces;
              setScreenShake(true);
              setTimeout(() => setScreenShake(false), 300);
            }
            finalLogs.push(...effectRes.logs.map(l => ({
              ...l,
              id: generateId(),
              timestamp: new Date().toLocaleTimeString()
            })));
          }
        }

        // 移動前の玉将の位置を探しておく
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

        // Check if game over conditions are met after ON_MOVE effect
        const senteKing = finalBoard.some(row => row.some(p => p?.isKing && p.owner === 'sente'));
        const goteKing = finalBoard.some(row => row.some(p => p?.isKing && p.owner === 'gote'));
        let isGameOver = res.gameOver;
        let finalWinner = res.winner;

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

        if (isGameOver) {
          // 破壊された玉将の位置に多重グリッチ爆発エフェクトをトリガー
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
          }));

          setTimeout(() => {
            setState(prev => ({
              ...prev,
              winner: finalWinner,
            }));
            saveHistorySnapshot(finalBoard, nextCaptured, 'gote', finalLogs);
          }, 1200);
        } else {
          finalizeTurn(
            finalBoard,
            nextCaptured,
            state.sharedPieces,
            finalLogs
          );
        }

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
        finalizeTurn(nextBoard, nextCaptured, state.sharedPieces, [...state.logs, newLog]);

      } else if (chosenMove.type === 'shared_drop' && chosenMove.piece && chosenMove.index !== undefined) {
        const nextBoard = executeDrop(board, chosenMove.piece, chosenMove.to, 'gote');
        const nextShared = [...state.sharedPieces];
        nextShared.splice(chosenMove.index, 1);
        const newLog: GameLog = {
          id: generateId(),
          timestamp: new Date().toLocaleTimeString(),
          player: 'gote',
          message: `${chosenMove.piece.word}を共有プールから配置しました。`,
          type: 'move'
        };
        finalizeTurn(nextBoard, state.capturedPieces, nextShared, [...state.logs, newLog]);
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

  return (
    <div className={`app-container ${screenShake ? 'screen-shake' : ''} phase-${state.phase}`}>
      
      {/* ターン交代サイバーアラート */}
      {turnChangeAlert && (
        <div className={`turn-change-overlay ${turnChangeAlert === 'sente' ? 'sente-turn-alert' : 'gote-turn-alert'}`}>
          <div className="turn-change-content">
            <div className="turn-change-scanline" />
            <div className="turn-change-subtitle">SYSTEM STATUS UPDATE</div>
            <div className="turn-change-title">
              {turnChangeAlert === 'sente'
                ? `▲ ${playerNames.sente || 'プレイヤー1'} の手番`
                : `▽ ${playerNames.gote || (vsAiMode ? 'AI' : 'プレイヤー2')} の手番`}
            </div>
            <div className="turn-change-bar" />
          </div>
        </div>
      )}

      {/* Header */}
      <header className="cyber-panel cyan-glow" style={{ padding: '10px 20px', margin: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(10, 5, 28, 0.9)' }}>
        <h1 className="cyber-title app-header-title" style={{ fontSize: '22px' }}>
          AI駆動・拡張将棋
        </h1>
        <div className="app-header-subtitle" style={{ fontSize: '10px', color: 'var(--text-secondary)', fontFamily: 'var(--font-cyber)' }}>
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
                {/* Turn Indicator Banner */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'rgba(5, 2, 18, 0.85)',
                  border: `1px solid ${state.turn === 'sente' ? 'var(--neon-cyan)' : 'var(--neon-purple)'}`,
                  boxShadow: `0 0 10px ${state.turn === 'sente' ? 'rgba(0,243,255,0.2)' : 'rgba(189,0,255,0.2)'}`,
                  borderRadius: '4px',
                  padding: '10px 16px',
                  marginBottom: '12px',
                  fontFamily: 'var(--font-cyber)',
                  transition: 'all 0.3s ease',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: state.turn === 'sente' ? 'var(--neon-cyan)' : 'var(--neon-purple)',
                      boxShadow: `0 0 8px ${state.turn === 'sente' ? 'var(--neon-cyan)' : 'var(--neon-purple)'}`,
                      animation: 'pulseGlow 1.5s infinite alternate',
                    }} />
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      letterSpacing: '0.05em',
                    }}>
                      手番ステータス
                    </span>
                  </div>
                  
                  <div style={{
                    fontSize: '15px',
                    fontWeight: 'bold',
                    color: state.turn === 'sente' ? 'var(--neon-cyan)' : 'var(--neon-purple)',
                    textShadow: `0 0 8px ${state.turn === 'sente' ? 'rgba(0,243,255,0.3)' : 'rgba(189,0,255,0.3)'}`,
                    letterSpacing: '0.04em',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    {(() => {
                      if (onlineMode) {
                        const isMyTurn = state.turn === myRole;
                        const name = state.turn === 'sente' ? (playerNames.sente || 'プレイヤー1') : (playerNames.gote || 'プレイヤー2');
                        return isMyTurn 
                          ? `⚡ あなたの手番 (${name})`
                          : `⏳ 相手の手番 (${name})`;
                      } else if (vsAiMode) {
                        return state.turn === 'sente'
                          ? `⚡ あなたの手番 (${playerNames.sente || 'プレイヤー1'})`
                          : `🤖 AIの手番 (思考中...)`;
                      } else {
                        return state.turn === 'sente'
                          ? `▲ ${playerNames.sente || 'プレイヤー1'} の手番`
                          : `▽ ${playerNames.gote || 'プレイヤー2'} の手番`;
                      }
                    })()}
                  </div>
                </div>

                {state.activeAbilityMode && suspendedAbility && (
                  <div style={{
                    background: 'rgba(0, 243, 255, 0.15)',
                    border: '1px solid var(--neon-cyan)',
                    boxShadow: '0 0 10px rgba(0, 243, 255, 0.4)',
                    color: '#fff',
                    padding: '8px 15px',
                    borderRadius: '4px',
                    marginBottom: '10px',
                    fontSize: '12px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-cyber)',
                    animation: 'pulseGlow 1.5s infinite alternate'
                  }}>
                    ⚡ 【能力対象選択】効果を適用する対象の駒を盤上から選択してください（青く光るマス）。
                  </div>
                )}
                <GameBoard
                  board={state.board}
                  turn={state.turn}
                  phase={state.phase}
                  capturedPieces={state.capturedPieces}
                  sharedPieces={state.sharedPieces}
                  customPiecesToPlace={state.turn === 'sente' ? piecesToPlace.sente : piecesToPlace.gote}
                  selectedCell={state.selectedCell}
                  selectedCapturedPiece={selectedCapturedPiece}
                  selectedSharedPiece={selectedSharedPiece}
                  validMoves={validMoves}
                  activeAbilityTargets={state.activeAbilityTargets}
                  activeAbilityMode={state.activeAbilityMode}
                  onCellClick={handleCellClick}
                  onCapturedPieceClick={handleCapturedPieceClick}
                  onSharedPieceClick={handleSharedPieceClick}
                  onHoverPiece={setHoveredPiece}
                  vsAiMode={vsAiMode}
                  isSenteChecked={isKingInCheck(state.board, 'sente')}
                  isGoteChecked={isKingInCheck(state.board, 'gote')}
                  onlineMode={onlineMode}
                  myRole={myRole}
                  playerNames={playerNames}
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
                    background: 'rgba(18, 12, 5, 0.97)',
                    border: '1.5px solid var(--neon-yellow)',
                    boxShadow: '0 0 30px rgba(255, 215, 0, 0.5)',
                    borderRadius: '6px',
                    padding: '20px 28px',
                    textAlign: 'center',
                    minWidth: '200px',
                  }}>
                    <h3 style={{ color: 'var(--neon-yellow)', fontFamily: 'var(--font-cyber)', fontSize: '14px', marginBottom: '6px', textTransform: 'uppercase' }}>
                      ▲ 覚醒（成る）の選択 ▲
                    </h3>
                    <p style={{ fontSize: '12px', color: '#fff', marginBottom: '14px' }}>
                      <strong>{state.promotionPending.piece.word}</strong> を成りますか？<br/>
                      <span style={{ fontSize: '10px', color: '#ccc' }}>覚醒能力「{state.promotionPending.piece.isPawn ? 'と金' : state.promotionPending.piece.promoted_effect?.effect_name}」が解放されます。</span>
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
                  onToggleVsAi={() => setVsAiMode(!vsAiMode)}
                  playerNames={playerNames}
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
        return (
          <div className={`game-over-overlay ${state.winner === 'sente' ? 'victory-theme' : 'defeat-theme'}`}>
            <div className="game-over-panel">
              <h1 className="game-over-title">
                {state.winner === 'sente' ? '作戦完了' : '作戦失敗'}
              </h1>
              <div className="game-over-subtitle">
                🏆 {winnerName} の勝利 / MISSION ACCOMPLISHED
              </div>
              <p className="game-over-details">
                {winnerName} が {loserName} に勝利しました。<br />
                {state.winner === 'sente'
                  ? '敵陣営の王将の完全排除を確認。戦略的勝利を達成しました。'
                  : '玉将の機能停止を検知。防衛システム限界。直ちに後退してください。'}
              </p>
              <button className="cyber-btn game-over-btn" onClick={handleResetGame}>
                再起動 (REBOOT SYSTEM)
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
