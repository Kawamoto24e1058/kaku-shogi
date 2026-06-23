import React, { useState } from 'react';

interface StartScreenProps {
  vsAiMode: boolean;
  onSetVsAiMode: (mode: boolean) => void;
  onlineMode: boolean;
  onSetOnlineMode: (mode: boolean) => void;
  roomCode: string;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  isWaitingForOpponent: boolean;
  isSearchingMatch: boolean;
  isRandomMatch?: boolean;
  onRandomMatch: () => void;
  onCancelMatchmaking: () => void;
  matchmakingError: string;
  playerNames: { sente: string; gote: string };
  onSetPlayerNames: (names: { sente: string; gote: string }) => void;
  onStartGame: () => void;
}

export const StartScreen: React.FC<StartScreenProps> = ({
  vsAiMode,
  onSetVsAiMode,
  onlineMode,
  onSetOnlineMode,
  roomCode,
  onCreateRoom,
  onJoinRoom,
  isWaitingForOpponent,
  isSearchingMatch,
  isRandomMatch = false,
  onRandomMatch,
  onCancelMatchmaking,
  matchmakingError,
  playerNames,
  onSetPlayerNames,
  onStartGame,
}) => {
  const [inputCode, setInputCode] = useState('');

  return (
    <main className="min-h-screen bg-[#141414] text-neutral-200 font-sans flex flex-col items-center justify-center p-6 selection:bg-neutral-700 w-full">
      
      {/* Header */}
      <header className="w-full max-w-2xl flex justify-between items-center border-b border-neutral-800/60 pb-4 mb-12">
        <h1 className="font-serif text-lg tracking-[0.2em] text-white">AI駆動・拡張将棋</h1>
        <span className="text-xs font-mono tracking-widest text-neutral-500">SAPIENS RUNTIME v3.0.0</span>
      </header>

      {/* Main card */}
      <div className="w-full max-w-2xl bg-[#1A1A1A]/80 border border-neutral-800/[0.5] p-10 shadow-2xl backdrop-blur-md">
        
        {/* Banner Title */}
        <div className="text-center mb-12">
          <h2 className="font-serif text-2xl tracking-[0.3em] text-white mb-2">AI駆動・拡張将棋</h2>
          <p className="text-xs tracking-widest text-neutral-400 font-serif">― 言葉から能力を創造し、九×九の戦場をハックせよ ―</p>
        </div>

        {/* Config Section */}
        <section className="mb-10">
          <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">設定</h3>
          <div className="space-y-4 bg-black/20 p-6 border border-neutral-900">
            
            {/* Sente name input */}
            <div className="flex items-center justify-between">
              <label className="text-xs tracking-widest text-neutral-400">
                {onlineMode ? "名（名乗り）" : (vsAiMode ? "名（先手名乗り）" : "名（先手名乗り）")}
              </label>
              <input 
                type="text" 
                maxLength={16}
                className="bg-transparent border-b border-neutral-800 focus:border-neutral-500 text-sm px-2 py-1 text-right text-white tracking-widest outline-none w-64 transition-colors font-serif"
                value={playerNames.sente}
                onChange={(e) => {
                  const val = e.target.value;
                  if (onlineMode) {
                    onSetPlayerNames({ sente: val, gote: val });
                  } else {
                    onSetPlayerNames({ ...playerNames, sente: val });
                  }
                }}
              />
            </div>

            {/* Gote name input (only for Local 2P) */}
            {!vsAiMode && !onlineMode && (
              <div className="flex items-center justify-between pt-2 border-t border-neutral-900/30">
                <label className="text-xs tracking-widest text-neutral-400">名（後手名乗り）</label>
                <input 
                  type="text" 
                  maxLength={16}
                  className="bg-transparent border-b border-neutral-800 focus:border-neutral-500 text-sm px-2 py-1 text-right text-white tracking-widest outline-none w-64 transition-colors font-serif"
                  value={playerNames.gote}
                  onChange={(e) => onSetPlayerNames({ ...playerNames, gote: e.target.value })}
                />
              </div>
            )}

            {/* Opponent display */}
            <div className="flex items-center justify-between pt-2 border-t border-neutral-900/30">
              <span className="text-xs tracking-widest text-neutral-500">対局相手</span>
              <span className="text-xs tracking-widest text-neutral-400 font-serif">
                {onlineMode ? "オンライン対戦相手" : (vsAiMode ? "Gemini AI" : "盤上後手プレイヤー")}
              </span>
            </div>

          </div>
        </section>

        {/* Game Mode Selector */}
        <section className="mb-10">
          <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">対局選択</h3>
          <div className="grid grid-cols-3 gap-4">
            
            {/* VS AI Mode */}
            <button 
              onClick={() => { onSetVsAiMode(true); onSetOnlineMode(false); }}
              className={`group relative border p-6 text-left transition-all duration-300 bg-neutral-900/20 cursor-pointer ${
                (vsAiMode && !onlineMode) 
                  ? "border-amber-200/60 bg-amber-200/[0.02]" 
                  : "border-neutral-800 hover:border-neutral-500"
              }`}
            >
              <div className={`font-serif text-sm tracking-widest transition-colors mb-2 ${
                (vsAiMode && !onlineMode) ? "text-amber-200" : "text-white group-hover:text-amber-200"
              }`}>一人対局</div>
              <p className="text-[10px] text-neutral-400 leading-relaxed font-serif">人工知能と対峙します。言葉から紡がれたカスタム駒が動的にコンパイルされます。</p>
            </button>

            {/* VS Player Mode */}
            <button 
              onClick={() => { onSetVsAiMode(false); onSetOnlineMode(false); }}
              className={`group relative border p-6 text-left transition-all duration-300 bg-neutral-900/20 cursor-pointer ${
                (!vsAiMode && !onlineMode) 
                  ? "border-amber-200/60 bg-amber-200/[0.02]" 
                  : "border-neutral-800 hover:border-neutral-500"
              }`}
            >
              <div className={`font-serif text-sm tracking-widest transition-colors mb-2 ${
                (!vsAiMode && !onlineMode) ? "text-amber-200" : "text-white group-hover:text-amber-200"
              }`}>二人対局</div>
              <p className="text-[10px] text-neutral-400 leading-relaxed font-serif">端末を交互に操作するローカル対戦。互いに三枚の切り札を懐に忍ばせます。</p>
            </button>

            {/* Online Match Mode */}
            <button 
              onClick={() => { onSetVsAiMode(false); onSetOnlineMode(true); }}
              className={`group relative border p-6 text-left transition-all duration-300 bg-neutral-900/20 cursor-pointer ${
                onlineMode 
                  ? "border-amber-200/60 bg-amber-200/[0.02]" 
                  : "border-neutral-800 hover:border-neutral-500"
              }`}
            >
              <div className={`font-serif text-sm tracking-widest transition-colors mb-2 ${
                onlineMode ? "text-amber-200" : "text-white group-hover:text-amber-200"
              }`}>遠隔対局</div>
              <p className="text-[10px] text-neutral-400 leading-relaxed font-serif">合言葉による部屋作成、または未知の棋士とのランダムマッチングを行います。</p>
            </button>

          </div>
        </section>

        {/* Online Room Section (Visible only when Online Mode is active) */}
        {onlineMode && (
          <section className="mb-10">
            <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">
              遠隔対局設定
            </h3>
            <div className="bg-black/20 p-6 border border-neutral-900 space-y-6">
              {isSearchingMatch ? (
                <div className="text-center py-4">
                  <div className="text-sm tracking-widest text-amber-200/80 font-serif mb-4">
                    対戦相手を探索中
                  </div>
                  <button
                    type="button"
                    onClick={onCancelMatchmaking}
                    className="border border-red-900/40 hover:border-red-400 bg-red-950/10 text-red-400 text-xs tracking-widest px-6 py-2 transition-all duration-300 cursor-pointer font-serif"
                  >
                    探索中止
                  </button>
                </div>
              ) : isWaitingForOpponent ? (
                <div className="text-center py-4">
                  {isRandomMatch ? (
                    <div className="space-y-4">
                      <div className="text-sm tracking-widest text-amber-200/80 font-serif">
                        自動マッチング対局の接続待機中
                      </div>
                      <div className="flex gap-2 justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-200/50 animate-pulse"></span>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-200/50 animate-pulse [animation-delay:0.2s]"></span>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-200/50 animate-pulse [animation-delay:0.4s]"></span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-xs text-neutral-400 tracking-widest font-serif">
                        対戦相手に下記コードを共有してください
                      </div>
                      <div className="text-3xl font-bold tracking-[0.25em] text-amber-200 font-mono py-2">
                        {roomCode}
                      </div>
                    </div>
                  )}
                  <div className="text-[11px] text-neutral-500 tracking-wider font-serif my-4">
                    {isRandomMatch
                      ? "他者がランダム対局を開始すると自動で接続されます。"
                      : "対局相手が参加すると自動で対局室に入ります。"}
                  </div>
                  <button
                    type="button"
                    onClick={onCancelMatchmaking}
                    className="border border-red-900/40 hover:border-red-400 bg-red-950/10 text-red-400 text-xs tracking-widest px-6 py-2 transition-all duration-300 cursor-pointer font-serif"
                  >
                    待機中止
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Option 0: Random */}
                  <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
                    <div className="text-left">
                      <div className="text-xs tracking-widest text-white">ランダム対局</div>
                      <div className="text-[10px] text-neutral-400 tracking-wider mt-1">待機中の他のプレイヤーと自動的にマッチングして開始します。</div>
                    </div>
                    <button
                      type="button"
                      onClick={onRandomMatch}
                      className="border border-neutral-800 hover:border-neutral-400 text-xs tracking-widest px-4 py-2 text-white bg-neutral-900/40 transition-colors duration-300 cursor-pointer font-serif"
                    >
                      対局相手を探索
                    </button>
                  </div>

                  {/* Option 1: Create Room */}
                  <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
                    <div className="text-left">
                      <div className="text-xs tracking-widest text-white">対局室作成</div>
                      <div className="text-[10px] text-neutral-400 tracking-wider mt-1">新規の対局部屋を作成し、入室用コードを発行します。</div>
                    </div>
                    <button
                      type="button"
                      onClick={onCreateRoom}
                      className="border border-neutral-800 hover:border-neutral-400 text-xs tracking-widest px-4 py-2 text-white bg-neutral-900/40 transition-colors duration-300 cursor-pointer font-serif"
                    >
                      部屋を作成
                    </button>
                  </div>

                  {/* Option 2: Join Room */}
                  <div className="flex items-center justify-between">
                    <div className="text-left">
                      <div className="text-xs tracking-widest text-white">対局室入室</div>
                      <div className="text-[10px] text-neutral-400 tracking-wider mt-1">発行された6桁の部屋コードを入力して参戦します。</div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="部屋コード"
                        value={inputCode}
                        onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                        className="bg-transparent border border-neutral-800 text-xs px-3 py-2 text-center text-white tracking-widest outline-none w-28 transition-colors focus:border-neutral-500 font-mono"
                      />
                      <button
                        type="button"
                        disabled={inputCode.length !== 6}
                        onClick={() => onJoinRoom(inputCode)}
                        className={`text-xs tracking-widest px-4 py-2 border transition-all duration-300 font-serif ${
                          inputCode.length === 6
                            ? "border-amber-200/50 hover:border-amber-200 text-amber-200 bg-amber-200/5 cursor-pointer"
                            : "border-neutral-900 text-neutral-600 cursor-not-allowed"
                        }`}
                      >
                        入室
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {matchmakingError && (
                <div className="text-xs text-red-400 text-center tracking-widest pt-2 font-serif">
                  エラー: {matchmakingError}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Shogi Rules and Instructions */}
        <section className="mb-10">
          <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">拡張規則説明</h3>
          <div className="text-[11px] text-neutral-400 space-y-3 leading-relaxed font-serif pl-3">
            <p>一、 任意の単語から、独自の足回りと自動能力を宿した【カスタム駒】が手札に創造される。</p>
            <p>二、 カスタム駒は自陣の空きマスへドロップ（召喚）し、次手以降に動かすことで能力が全自動執行される。</p>
            <p>三、 強大すぎる能力は一ゲームに一回の切り札となり、使用後は前後左右一マスの充填状態へ風化する。</p>
          </div>
        </section>

        {/* Start Game Action */}
        {!onlineMode && (
          <div className="text-center pt-8 border-t border-neutral-900">
            <button
              type="button"
              onClick={onStartGame}
              className="border border-amber-200/60 hover:border-amber-200 bg-amber-200/5 hover:bg-amber-200/10 text-amber-200 text-sm font-serif tracking-[0.25em] px-12 py-4 transition-all duration-300 cursor-pointer shadow-lg"
            >
              戦場へ挙兵する
            </button>
          </div>
        )}

      </div>
    </main>
  );
};
