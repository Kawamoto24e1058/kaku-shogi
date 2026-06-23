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
    <div style={{ maxWidth: '800px', margin: '0 auto', width: '100%', padding: '12px', boxSizing: 'border-box' }}>
      <div 
        className="cyber-panel" 
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid rgba(244, 237, 226, 0.12)',
          borderRadius: '2px',
          padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 30px)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          fontFamily: 'var(--font-cyber)',
        }}
      >
        {/* Banner Title */}
        <div style={{ textAlign: 'center', borderBottom: '1.5px solid rgba(244, 237, 226, 0.1)', paddingBottom: '20px' }}>
          <h2 className="cyber-title" style={{ fontSize: 'clamp(20px, 5vw, 32px)', margin: '0 0 8px 0', letterSpacing: '0.15em', borderBottom: 'none', paddingBottom: 0 }}>
            AI駆動・拡張将棋
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, fontFamily: 'var(--font-ui)', letterSpacing: '0.08em' }}>
            ― 言葉から能力を創造し、9×9の戦場をハックせよ ―
          </p>
        </div>

        {/* Player Name Setup */}
        <div>
          <h3 style={{ fontSize: '15px', color: 'var(--color-gold)', marginBottom: '12px', fontWeight: 'bold', letterSpacing: '0.1em' }}>
            ■ プレイヤー名設定
          </h3>
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(244, 237, 226, 0.08)',
            borderRadius: '2px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {/* Sente name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label style={{
                fontSize: '13px',
                color: 'var(--color-shinku)',
                fontFamily: 'var(--font-cyber)',
                minWidth: '110px',
                flexShrink: 0,
              }}>
                {onlineMode ? 'プレイヤー名' : (vsAiMode ? 'プレイヤー名' : 'プレイヤー1名')}
              </label>
              <input
                type="text"
                placeholder={onlineMode ? 'あなたの名前を入力' : (vsAiMode ? 'プレイヤーの名前を入力' : 'プレイヤー1の名前を入力')}
                maxLength={16}
                value={playerNames.sente}
                onChange={e => {
                  const val = e.target.value;
                  if (onlineMode) {
                    onSetPlayerNames({ sente: val, gote: val });
                  } else {
                    onSetPlayerNames({ ...playerNames, sente: val });
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: '160px',
                  background: 'rgba(26, 26, 26, 0.4)',
                  border: '1px solid rgba(244, 237, 226, 0.15)',
                  color: '#fff',
                  padding: '8px 14px',
                  borderRadius: '2px',
                  fontSize: '14px',
                  fontFamily: 'var(--font-ui)',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--color-shinku)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(244, 237, 226, 0.15)')}
              />
            </div>
            {/* Gote name (hidden in online mode) */}
            {!onlineMode && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <label style={{
                  fontSize: '13px',
                  color: 'var(--color-gold)',
                  fontFamily: 'var(--font-cyber)',
                  minWidth: '110px',
                  flexShrink: 0,
                }}>
                  {vsAiMode ? 'AI名' : 'プレイヤー2名'}
                </label>
                {vsAiMode ? (
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)', padding: '8px 14px' }}>
                    Gemini AI (封印済み)
                  </span>
                ) : (
                  <input
                    type="text"
                    placeholder="プレイヤー2の名前を入力"
                    maxLength={16}
                    value={playerNames.gote}
                    onChange={e => onSetPlayerNames({ ...playerNames, gote: e.target.value })}
                    style={{
                      flex: 1,
                      minWidth: '160px',
                      background: 'rgba(26, 26, 26, 0.4)',
                      border: '1px solid rgba(244, 237, 226, 0.15)',
                      color: '#fff',
                      padding: '8px 14px',
                      borderRadius: '2px',
                      fontSize: '14px',
                      fontFamily: 'var(--font-ui)',
                      outline: 'none',
                      transition: 'border-color 0.2s',
                    }}
                    onFocus={e => (e.target.style.borderColor = 'var(--color-gold)')}
                    onBlur={e => (e.target.style.borderColor = 'rgba(244, 237, 226, 0.15)')}
                  />
                )}
              </div>
            )}
            {onlineMode && (
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, fontFamily: 'var(--font-ui)' }}>
                オンライン対戦の場合、相手の名前は相手が入室後に自動で取得されます。
              </p>
            )}
          </div>
        </div>

        {/* Mode Selector */}
        <div>
          <h3 style={{ fontSize: '15px', color: 'var(--color-gold)', marginBottom: '12px', fontWeight: 'bold', letterSpacing: '0.1em' }}>
            ■ 対局モード選択
          </h3>
          <div className="start-screen-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            {/* VS AI Mode */}
            <div 
              onClick={() => { onSetVsAiMode(true); onSetOnlineMode(false); }}
              className="cyber-panel"
              style={{
                padding: '20px',
                cursor: 'pointer',
                borderRadius: '2px',
                border: (vsAiMode && !onlineMode) ? '1.5px solid var(--color-gold)' : '1px solid rgba(244, 237, 226, 0.08)',
                background: (vsAiMode && !onlineMode) ? 'rgba(244, 237, 226, 0.05)' : 'rgba(0, 0, 0, 0.2)',
                transition: 'all 0.3s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                userSelect: 'none'
              }}
            >
              <div style={{ fontSize: '17px', fontWeight: 'bold', color: (vsAiMode && !onlineMode) ? 'var(--color-gold)' : '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🤖</span> VS AI (1人対戦)
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4', fontFamily: 'var(--font-ui)' }}>
                Gemini AIと対戦します。AIの特殊能力駒は、対局開始時に自動的にテーマに沿って動的コンパイルされます。
              </p>
            </div>

            {/* VS Player Mode */}
            <div 
              onClick={() => { onSetVsAiMode(false); onSetOnlineMode(false); }}
              className="cyber-panel"
              style={{
                padding: '20px',
                cursor: 'pointer',
                borderRadius: '2px',
                border: (!vsAiMode && !onlineMode) ? '1.5px solid var(--color-gold)' : '1px solid rgba(244, 237, 226, 0.08)',
                background: (!vsAiMode && !onlineMode) ? 'rgba(244, 237, 226, 0.05)' : 'rgba(0, 0, 0, 0.2)',
                transition: 'all 0.3s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                userSelect: 'none'
              }}
            >
              <div style={{ fontSize: '17px', fontWeight: 'bold', color: (!vsAiMode && !onlineMode) ? 'var(--color-gold)' : '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚔️</span> VS PLAYER (2人対戦)
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4', fontFamily: 'var(--font-ui)' }}>
                ローカル対面対戦（パス＆プレイ）を行います。1台のデバイスを交互操作し、カスタム駒を3枚ずつ構築します。
              </p>
            </div>

            {/* Online Match Mode */}
            <div 
              onClick={() => { onSetVsAiMode(false); onSetOnlineMode(true); }}
              className="cyber-panel"
              style={{
                padding: '20px',
                cursor: 'pointer',
                borderRadius: '2px',
                border: onlineMode ? '1.5px solid var(--color-gold)' : '1px solid rgba(244, 237, 226, 0.08)',
                background: onlineMode ? 'rgba(244, 237, 226, 0.05)' : 'rgba(0, 0, 0, 0.2)',
                transition: 'all 0.3s ease',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                userSelect: 'none'
              }}
            >
              <div style={{ fontSize: '17px', fontWeight: 'bold', color: onlineMode ? 'var(--color-gold)' : '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🌐</span> ONLINE (オンライン)
              </div>
              <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: 0, lineHeight: '1.4', fontFamily: 'var(--font-ui)' }}>
                オンラインで異なるデバイス間の対戦を行います。6桁の部屋コードを発行・入力して離れた相手とマッチングし、リアルタイムに対戦します。
              </p>
            </div>
          </div>
        </div>

        {onlineMode && (
          <div 
            className="cyber-panel"
            style={{
              padding: '24px',
              background: 'rgba(255, 255, 255, 0.01)',
              border: '1px solid rgba(244, 237, 226, 0.15)',
              borderRadius: '2px',
              marginTop: '10px'
            }}
          >
            <h4 style={{ color: 'var(--color-gold)', margin: '0 0 16px 0', fontSize: '14px', fontFamily: 'var(--font-cyber)', fontWeight: 'bold' }}>
              ■ オンライン対局室の選択
            </h4>
            
            {isSearchingMatch ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: 'var(--color-gold)',
                  margin: '12px 0',
                }}>
                  🔍 対戦相手を探しています…
                </div>
                <button
                  type="button"
                  onClick={onCancelMatchmaking}
                  className="cyber-btn"
                  style={{
                    padding: '8px 20px',
                    borderColor: 'var(--color-shinku)',
                    color: 'var(--color-shinku)',
                    background: 'rgba(158, 42, 43, 0.05)',
                    marginTop: '15px'
                  }}
                >
                  キャンセル
                </button>
              </div>
            ) : isWaitingForOpponent ? (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                {isRandomMatch ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                    <div style={{ fontSize: '14px', color: 'var(--color-gold)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                      🌐 対戦相手を探しています… (自動マッチング)
                    </div>
                    {/* Dots pulse animation */}
                    <div style={{
                      display: 'flex',
                      gap: '6px',
                      justifyContent: 'center',
                      margin: '15px 0'
                    }}>
                      <span className="dot-pulse-1" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-gold)' }}></span>
                      <span className="dot-pulse-2" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-gold)' }}></span>
                      <span className="dot-pulse-3" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-gold)' }}></span>
                    </div>
                    {roomCode && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        (管理コード: {roomCode})
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      対戦相手へこのコードを伝えてください
                    </div>
                    <div style={{
                      fontSize: '36px',
                      fontWeight: 'bold',
                      color: 'var(--color-gold)',
                      letterSpacing: '0.2em',
                      margin: '12px 0',
                    }}>
                      {roomCode}
                    </div>
                  </>
                )}
                <div style={{ fontSize: '13px', color: 'var(--color-gold)', marginBottom: '15px' }}>
                  {isRandomMatch 
                    ? '⏳ 他のプレイヤーが「誰でもランダム対戦」を開始すると自動で対局が開始されます。'
                    : '⏳ 接続を待機中… (対戦相手が参加すると自動で対局室に入ります)'
                  }
                </div>
                <button
                  type="button"
                  onClick={onCancelMatchmaking}
                  className="cyber-btn"
                  style={{
                    padding: '8px 20px',
                    borderColor: 'var(--color-shinku)',
                    color: 'var(--color-shinku)',
                    background: 'rgba(158, 42, 43, 0.05)'
                  }}
                >
                  {isRandomMatch ? 'マッチングをキャンセル' : '待機をキャンセル'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Option 0: Random Matchmaking */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '2px', borderLeft: '3px solid var(--color-gold)' }}>
                  <div style={{ textAlign: 'left', flex: 1, marginRight: '20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>誰でもランダム対戦</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>待機中の他のプレイヤーと自動的にマッチングして対戦します。</div>
                  </div>
                  <button
                    type="button"
                    onClick={onRandomMatch}
                    className="cyber-btn"
                    style={{ padding: '8px 20px', borderColor: 'var(--color-gold)', color: 'var(--color-gold)', background: 'rgba(212,175,55,0.05)' }}
                  >
                    対戦相手を探す
                  </button>
                </div>

                {/* Option 1: Create Room */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '2px', borderLeft: '3px solid var(--color-shinku)' }}>
                  <div style={{ textAlign: 'left', flex: 1, marginRight: '20px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>合言葉対局室を作成する (プライベート)</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>新しい対局部屋を作成し、発行される6桁のコードを対戦相手に教えます。</div>
                  </div>
                  <button
                    type="button"
                    onClick={onCreateRoom}
                    className="cyber-btn"
                    style={{ padding: '8px 20px', borderColor: 'var(--color-shinku)', color: 'var(--color-shinku)', background: 'rgba(158, 42, 43, 0.05)' }}
                  >
                    部屋を作る
                  </button>
                </div>

                {/* Option 2: Join Room */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '15px', borderRadius: '2px', borderLeft: '3px solid var(--color-gold)' }}>
                  <div style={{ flex: 1, marginRight: '20px', textAlign: 'left' }}>
                    <div style={{ fontSize: '14px', fontWeight: 'bold' }}>合言葉対局室に入る (プライベート)</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>対戦相手が作成した6桁の部屋コードを入力して接続します。</div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input
                      type="text"
                      placeholder="6桁のコード"
                      value={inputCode}
                      onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                      style={{
                        width: '120px',
                        background: 'rgba(0,0,0,0.5)',
                        border: '1px solid rgba(244, 237, 226, 0.2)',
                        color: '#fff',
                        padding: '8px 12px',
                        borderRadius: '2px',
                        fontSize: '14px',
                        textAlign: 'center',
                        fontFamily: 'monospace',
                        letterSpacing: '0.1em'
                      }}
                    />
                    <button
                      type="button"
                      disabled={inputCode.length !== 6}
                      onClick={() => onJoinRoom(inputCode)}
                      className="cyber-btn"
                      style={{
                        padding: '8px 20px',
                        borderColor: inputCode.length === 6 ? 'var(--color-gold)' : 'var(--text-muted)',
                        color: inputCode.length === 6 ? 'var(--color-gold)' : 'var(--text-muted)',
                        background: inputCode.length === 6 ? 'rgba(212,175,55,0.05)' : 'transparent',
                        cursor: inputCode.length === 6 ? 'pointer' : 'not-allowed'
                      }}
                    >
                      参戦する
                    </button>
                  </div>
                </div>
              </div>
            )}

            {matchmakingError && (
              <div style={{ color: 'var(--color-shinku)', fontSize: '12px', marginTop: '12px', textAlign: 'center' }}>
                ⚠️ エラー: {matchmakingError}
              </div>
            )}
          </div>
        )}

        {/* Shogi Rules and Instructions */}
        <div style={{ borderTop: '1.5px solid rgba(244, 237, 226, 0.1)', paddingTop: '20px' }}>
          <h3 style={{ fontSize: '15px', color: 'var(--color-gold)', marginBottom: '12px', fontWeight: 'bold', letterSpacing: '0.1em' }}>
            ■ 拡張ルール説明
          </h3>
          <div 
            style={{ 
              fontSize: '11.5px', 
              color: 'var(--text-secondary)', 
              fontFamily: 'var(--font-ui)', 
              lineHeight: '1.6', 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '6px',
              backgroundColor: 'rgba(0,0,0,0.2)',
              padding: '12px',
              borderRadius: '2px',
              border: '1px solid rgba(244, 237, 226, 0.05)'
            }}
          >
            <div><strong>1. 概念創造:</strong> 対局前に任意の単語を入力します。AIがその意味を分析し、オリジナルの移動力・HP・攻撃力・秘奥義を持つ「カスタム駒」をゼロから構築します（2人対戦時はプレイヤー1が作り終えた後、デバイスをプレイヤー2に渡してプレイヤー2が駒を作成します）。</div>
            <div><strong>2. 盤面配置:</strong> 作成された3枚のカスタム駒は、自陣に自動的に配置されます（歩兵と王将も最初から配置済み）。</div>
            <div><strong>3. 戦術オプション:</strong> 対局中、駒の持つ「一度限りの秘奥義」（タイムリープ、洗脳、コピー等）を使用できます。発動には手番開始時に蓄積される「気力（MP）」を消費します。</div>
            <div><strong>4. ダメージと撃破:</strong> 各駒にはHPが設定されており、攻撃されるとHPが減少します。HPが0になると撃破され、相手の持ち駒となります。</div>
          </div>
        </div>

        {/* Start Game Action */}
        {!onlineMode && (
          <div style={{ textAlign: 'center', borderTop: '1.5px solid rgba(244, 237, 226, 0.1)', paddingTop: '25px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onStartGame}
              className="cyber-btn cyber-btn-yellow"
              style={{ 
                padding: '15px 50px', 
                fontSize: '18px', 
                fontWeight: 'bold',
              }}
            >
              戦場へ挙兵する
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
