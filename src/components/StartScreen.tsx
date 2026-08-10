import React, { useState, useEffect } from 'react';
import * as THREE from 'three';
import { SakuraShower } from './SakuraShower';

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
  isConnectingHandshake?: boolean;
  onRandomMatch: () => void;
  onCancelMatchmaking: () => void;
  matchmakingError: string;
  playerNames: { sente: string; gote: string };
  onSetPlayerNames: (names: { sente: string; gote: string }) => void;
  onStartGame: () => void;
}

interface TypeWord {
  kanji: string;
  romaji: string;
}

// Convert Romaji to Japanese Kana with typing-state support
const romajiToKana = (romaji: string): string => {
  let result = '';
  let i = 0;

  const table3: Record<string, string> = {
    'sya': 'しゃ', 'syu': 'しゅ', 'syo': 'しょ',
    'kya': 'きゃ', 'kyu': 'きゅ', 'kyo': 'きょ',
    'gya': 'ぎゃ', 'gyu': 'ぎゅ', 'gyo': 'ぎょ',
    'cha': 'ちゃ', 'chu': 'ちゅ', 'cho': 'ちょ',
    'tya': 'ちゃ', 'tyu': 'ちゅ', 'tyo': 'ちょ',
    'nya': 'にゃ', 'nyu': 'にゅ', 'nyo': 'にょ',
    'hya': 'ひゃ', 'hyu': 'ひゅ', 'hyo': 'ひょ',
    'bya': 'びゃ', 'byu': 'びゅ', 'byo': 'びょ',
    'pya': 'ぴゃ', 'pyu': 'ぴゅ', 'pyo': 'ぴょ',
    'mya': 'みゃ', 'myu': 'みゅ', 'myo': 'みょ',
    'rya': 'りゃ', 'ryu': 'りゅ', 'ryo': 'りょ',
    'tsu': 'つ'
  };

  const table2: Record<string, string> = {
    'ka': 'か', 'ki': 'き', 'ku': 'く', 'ke': 'け', 'ko': 'こ',
    'sa': 'さ', 'si': 'し', 'su': 'す', 'se': 'せ', 'so': 'そ',
    'ta': 'た', 'ti': 'ち', 'tu': 'つ', 'te': 'て', 'to': 'と',
    'na': 'な', 'ni': 'に', 'nu': 'ぬ', 'ne': 'ね', 'no': 'の',
    'ha': 'は', 'hi': 'ひ', 'fu': 'ふ', 'he': 'へ', 'ho': 'ほ',
    'ma': 'ま', 'mi': 'み', 'mu': 'む', 'me': 'め', 'mo': 'も',
    'ya': 'や', 'yu': 'ゆ', 'yo': 'よ',
    'ra': 'ら', 'ri': 'り', 'ru': 'る', 're': 'れ', 'ro': 'ろ',
    'wa': 'わ', 'wo': 'を', 'nn': 'ん',
    'ga': 'が', 'gi': 'ぎ', 'gu': 'ぐ', 'ge': 'げ', 'go': 'ご',
    'za': 'ざ', 'zi': 'じ', 'zu': 'ず', 'ze': 'ぜ', 'zo': 'ぞ',
    'da': 'だ', 'di': 'ぢ', 'du': 'づ', 'de': 'で', 'do': 'ど',
    'ba': 'ば', 'bi': 'び', 'bu': 'ぶ', 'be': 'べ', 'bo': 'ぼ',
    'pa': 'ぱ', 'pi': 'ぴ', 'pu': 'ぷ', 'pe': 'ぺ', 'po': 'ぽ'
  };

  const table1: Record<string, string> = {
    'a': 'あ', 'i': 'い', 'u': 'う', 'e': 'え', 'o': 'お',
    'n': 'ん', '-': 'ー'
  };

  while (i < romaji.length) {
    // っ double consonant support (except for 'n' or vowels)
    if (
      i < romaji.length - 1 && 
      romaji[i] === romaji[i + 1] && 
      romaji[i] !== 'n' && 
      !['a', 'i', 'u', 'e', 'o'].includes(romaji[i])
    ) {
      result += 'っ';
      i++;
      continue;
    }

    const substr3 = romaji.substring(i, i + 3);
    if (table3[substr3]) {
      result += table3[substr3];
      i += 3;
      continue;
    }

    const substr2 = romaji.substring(i, i + 2);
    if (table2[substr2]) {
      result += table2[substr2];
      i += 2;
      continue;
    }

    const substr1 = romaji.substring(i, i + 1);
    if (table1[substr1]) {
      result += table1[substr1];
      i += 1;
      continue;
    }

    // Output raw letter during intermediate typing state
    result += romaji[i];
    i++;
  }
  return result;
};

// 3D Shogi Piece Component using Three.js
const Koma3D: React.FC = () => {
  useEffect(() => {
    const canvas = document.getElementById('shogi3dCanvas') as HTMLCanvasElement | null;
    if (!canvas) return;

    const width = 288;
    const height = 288;

    // Scene
    const scene = new THREE.Scene();

    // Camera (moved back to Z=8.5 to prevent piece clipping)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 0, 8.5);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // Transparent background clearing
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Shogi piece shape
    const shape = new THREE.Shape();
    const W = 1.3;  // Base width / 2
    const w = 0.9;  // Shoulder width / 2
    const H = 3.2;  // Total height
    const h = 2.5;  // Shoulder height

    // Draw pentagon starting from bottom-center
    shape.moveTo(-W, -H/2);
    shape.lineTo(W, -H/2);
    shape.lineTo(w, h - H/2);
    shape.lineTo(0, H - H/2);
    shape.lineTo(-w, h - H/2);
    shape.closePath();

    const extrudeSettings = {
      steps: 1,
      depth: 0.35,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.04,
      bevelOffset: 0,
      bevelSegments: 4
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();

    // Wood Material
    const woodMaterial = new THREE.MeshStandardMaterial({
      color: 0xfdf6e2, // 温かみのある高級なつげの木の色
      roughness: 0.18, // 光が当たったエッジが鋭く美しく光るように、粗さを下げる
      metalness: 0.02
    });

    const komaMesh = new THREE.Mesh(geometry, woodMaterial);
    komaMesh.castShadow = true;
    komaMesh.receiveShadow = true;

    // Words List with Romaji typing configs
    const words: TypeWord[] = [
      { kanji: '王将', romaji: 'ousyou' },
      { kanji: '皇帝', romaji: 'koutei' },
      { kanji: '大魔王', romaji: 'daimaou' },
      { kanji: '超次元', romaji: 'tyoujigen' },
      { kanji: '虚無', romaji: 'kyomu' },
      { kanji: '猫耳', romaji: 'nekomimi' },
      { kanji: 'デス光線', romaji: 'desukousen' },
      { kanji: '超電磁', romaji: 'tyoudenzi' },
      { kanji: '混沌', romaji: 'konton' },
      { kanji: '極光', romaji: 'kyokkou' },
      { kanji: '織田信長', romaji: 'odanobunaga' },
      { kanji: '豊臣秀吉', romaji: 'toyotomihideyoshi' },
      { kanji: '武田信玄', romaji: 'takedasingen' },
      { kanji: '絶対防御', romaji: 'zettaibougyo' },
      { kanji: '神殺し', romaji: 'kamigoroshi' },
      { kanji: '天災', romaji: 'tensai' },
      { kanji: '暗黒', romaji: 'ankoku' },
      { kanji: '軍神', romaji: 'gunsin' },
      { kanji: '無双', romaji: 'musou' },
      { kanji: '爆死', romaji: 'bakusi' },
      { kanji: '課金', romaji: 'kakin' },
      { kanji: '寿司', romaji: 'susi' },
      { kanji: '焼肉', romaji: 'yakiniku' },
      { kanji: 'ラーメン', romaji: 'ra-men' },
      { kanji: '玉将', romaji: 'gyokusyou' },
      { kanji: '飛車', romaji: 'hisya' },
      { kanji: '角行', romaji: 'kakugyou' },
      { kanji: '歩兵', romaji: 'fuhei' }
    ];

    let currentWordIndex = 0;
    let targetWord = words[0];
    let currentText = '王将';
    let typingIndex = targetWord.romaji.length;
    let isTyping = false;
    let timeAccumulator = 0;
    let switchAccumulator = 0;

    // Helper to draw custom layout texts on Canvas - strictly scaled to fit piece boundary
    const drawTextOnCanvas = (ctx: CanvasRenderingContext2D, text: string) => {
      ctx.clearRect(0, 0, 512, 512);
      ctx.fillStyle = '#120f0a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const len = text.length;
      if (len === 0) {
        return;
      }

      if (len === 1) {
        ctx.font = "bold 220px 'Noto Serif JP', 'Yu Mincho', serif";
        ctx.fillText(text, 256, 260);
      } else if (len === 2) {
        ctx.font = "bold 160px 'Noto Serif JP', 'Yu Mincho', serif";
        ctx.fillText(text[0], 256, 175);
        ctx.fillText(text[1], 256, 335);
      } else if (len === 3) {
        ctx.font = "bold 110px 'Noto Serif JP', 'Yu Mincho', serif";
        ctx.fillText(text[0], 256, 160);
        ctx.fillText(text[1], 256, 260);
        ctx.fillText(text[2], 256, 360);
      } else if (len === 4) {
        ctx.font = "bold 90px 'Noto Serif JP', 'Yu Mincho', serif";
        ctx.fillText(text.slice(0, 2), 256, 180);
        ctx.fillText(text.slice(2, 4), 256, 320);
      } else {
        ctx.font = "bold 75px 'Noto Serif JP', 'Yu Mincho', serif";
        ctx.fillText(text.slice(0, 3), 256, 190);
        ctx.fillText(text.slice(3), 256, 310);
      }
    };

    // Text Canvas Setup
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 512;
    tCanvas.height = 512;
    const tCtx = tCanvas.getContext('2d')!;
    drawTextOnCanvas(tCtx, currentText);
    const textTexture = new THREE.CanvasTexture(tCanvas);
    const textMaterial = new THREE.MeshBasicMaterial({
      map: textTexture,
      transparent: true,
      depthWrite: false
    });
    const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), textMaterial);
    textMesh.position.z = 0.28;

    // Back Text Canvas Setup
    const btCanvas = document.createElement('canvas');
    btCanvas.width = 512;
    btCanvas.height = 512;
    const btCtx = btCanvas.getContext('2d')!;
    drawTextOnCanvas(btCtx, currentText);
    const backTextTexture = new THREE.CanvasTexture(btCanvas);
    const backTextMaterial = new THREE.MeshBasicMaterial({
      map: backTextTexture,
      transparent: true,
      depthWrite: false
    });
    const backTextMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), backTextMaterial);
    backTextMesh.position.z = -0.28;
    backTextMesh.rotation.y = Math.PI;

    const komaGroup = new THREE.Group();
    komaGroup.add(komaMesh);
    komaGroup.add(textMesh);
    komaGroup.add(backTextMesh);
    scene.add(komaGroup);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight1.position.set(5, 8, 4);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 15;
    dirLight1.shadow.camera.left = -4;
    dirLight1.shadow.camera.right = 4;
    dirLight1.shadow.camera.top = 4;
    dirLight1.shadow.camera.bottom = -4;
    dirLight1.shadow.bias = -0.0005;
    scene.add(dirLight1);

    // Floor plane for shadows
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floorMesh = new THREE.Mesh(floorGeometry, floorMaterial);
    floorMesh.position.z = -1.5;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    let animationId: number;
    let clock = new THREE.Clock();
    let lastTime = 0;

    const animate = (time: number) => {
      if (lastTime === 0) lastTime = time;
      const delta = (time - lastTime) / 1000;
      lastTime = time;

      const elapsedTime = clock.getElapsedTime();

      // Slow automatic rotation
      komaGroup.rotation.y = elapsedTime * 0.4;
      komaGroup.rotation.x = 0.2 + Math.sin(elapsedTime * 0.8) * 0.1;
      komaGroup.rotation.z = Math.cos(elapsedTime * 0.6) * 0.03;

      // Word cycle and typing controller
      if (!isTyping) {
        switchAccumulator += delta;
        if (switchAccumulator >= 3.0) { // Cycle every 3 seconds
          switchAccumulator = 0;
          
          let nextIndex;
          do {
            nextIndex = Math.floor(Math.random() * words.length);
          } while (nextIndex === currentWordIndex);
          
          currentWordIndex = nextIndex;
          targetWord = words[currentWordIndex];
          typingIndex = 0;
          currentText = '';
          isTyping = true;
          timeAccumulator = 0;
        }
      } else {
        timeAccumulator += delta;
        if (timeAccumulator >= 0.08) { // 80ms keystroke for Romaji typing (faster)
          timeAccumulator = 0;
          typingIndex++;
          
          if (typingIndex <= targetWord.romaji.length) {
            // Typing intermediate Romaji state, converted to Japanese
            const typedRomaji = targetWord.romaji.slice(0, typingIndex);
            currentText = romajiToKana(typedRomaji);
          } else {
            // Completed typing the romaji, convert/commit to Kanji!
            currentText = targetWord.kanji;
            isTyping = false;
          }
          
          // Redraw textures
          drawTextOnCanvas(tCtx, currentText);
          textTexture.needsUpdate = true;
          
          // Mirror back texture or synchronize
          drawTextOnCanvas(btCtx, currentText);
          backTextTexture.needsUpdate = true;
        }
      }

      renderer.render(scene, camera);
      animationId = requestAnimationFrame(animate);
    };

    // Start animation loop
    animationId = requestAnimationFrame((time) => {
      lastTime = time;
      animate(time);
    });

    return () => {
      cancelAnimationFrame(animationId);
      geometry.dispose();
      woodMaterial.dispose();
      textTexture.dispose();
      textMaterial.dispose();
      backTextTexture.dispose();
      backTextMaterial.dispose();
      floorGeometry.dispose();
      floorMaterial.dispose();
    };
  }, []);

  return (
    <canvas 
      id="shogi3dCanvas" 
      width={288}
      height={288}
      style={{ width: '288px', height: '288px', display: 'block', outline: 'none', margin: '0 auto' }}
    />
  );
};

export const StartScreen: React.FC<StartScreenProps> = ({
  vsAiMode: _vsAiMode,
  onSetVsAiMode,
  onlineMode,
  onSetOnlineMode,
  roomCode,
  onCreateRoom,
  onJoinRoom,
  isWaitingForOpponent,
  isSearchingMatch,
  isRandomMatch: _isRandomMatch = false,
  isConnectingHandshake = false,
  onRandomMatch,
  onCancelMatchmaking,
  matchmakingError,
  playerNames,
  onSetPlayerNames,
  onStartGame,
}) => {
  const [inputCode, setInputCode] = useState('');
  const [currentStep, setCurrentStep] = useState<'title' | 'mode_select'>('title');
  const [selectedTab, setSelectedTab] = useState<'ai' | 'random' | 'custom'>('ai');
  const [showRuleModal, setShowRuleModal] = useState(false);

  // Background Koma particles animation
  useEffect(() => {
    const canvas = document.getElementById('komaparticles') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const kanjiList = ['王', '玉', '飛', '角', '金', '銀', '桂', '香', '歩', 'と', '龍', '馬'];
    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      text: string;
      angle: number;
      spin: number;
      opacity: number;
    }

    const particles: Particle[] = Array.from({ length: 15 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() * 0.3) + 0.1,
      size: Math.random() * 20 + 16,
      text: kanjiList[Math.floor(Math.random() * kanjiList.length)],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.005,
      opacity: Math.random() * 0.08 + 0.04,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;

        if (p.y > height + 50) {
          p.y = -50;
          p.x = Math.random() * width;
        }
        if (p.x < -50) p.x = width + 50;
        if (p.x > width + 50) p.x = -50;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.font = `bold ${p.size}px 'Noto Serif JP', 'Yu Mincho', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(139, 92, 26, ${p.opacity})`;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <main className="min-h-screen text-neutral-800 font-sans flex flex-col items-center justify-center p-6 selection:bg-amber-100 w-full relative">
      {/* Background Sakura Shower */}
      <SakuraShower />

      {/* Background Floating Koma Particles Canvas */}
      <canvas 
        id="komaparticles" 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Header */}
      <header className="w-full max-w-3xl flex justify-between items-center border-b border-amber-900/10 pb-4 mb-6 md:mb-10 z-10">
        <h1 className="font-serif text-lg tracking-[0.2em] font-bold text-amber-950">拡張将棋</h1>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowRuleModal(true)}
            className="flex items-center gap-1.5 px-3 py-1 bg-amber-100/80 hover:bg-amber-200/80 border border-amber-900/20 text-amber-950 rounded-full text-xs font-bold transition-all cursor-pointer shadow-xs"
          >
            <span className="w-4 h-4 rounded-full bg-amber-800 text-white flex items-center justify-center text-[10px]">?</span>
            規則・遊び方
          </button>
          <span className="text-xs font-mono tracking-widest text-amber-900/70 font-semibold">v3.0.0</span>
        </div>
      </header>

      {/* Main card */}
      <div className="w-full max-w-3xl bg-white/85 border border-amber-900/15 p-6 md:p-10 rounded-3xl shadow-xl shadow-amber-950/10 backdrop-blur-md relative z-10 animate-fade-in flex flex-col items-center justify-center">
        
        {currentStep !== 'title' && (
          <div className="text-center mb-8">
            <h2 className="font-serif text-2xl md:text-3xl tracking-[0.25em] font-black text-amber-950 mb-2">対局モード選択</h2>
            <p className="text-xs tracking-widest font-bold text-amber-900 font-serif">言葉から能力を創造し、九×九の戦場をハックせよ</p>
          </div>
        )}

        {currentStep === 'title' && (
          <div className="relative flex flex-col items-center justify-center w-full max-w-xl mx-auto select-none animate-[fadeIn_0.5s_ease-out]">
            
            {/* 3D Rotating Shogi Piece Canvas with Backlight */}
            <div className="relative w-72 h-72 flex items-center justify-center mb-2 mx-auto">
              <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/20 to-transparent blur-3xl rounded-full animate-pulse"></div>
              <div className="w-full h-full z-10 pointer-events-none flex items-center justify-center">
                <Koma3D />
              </div>
            </div>

            {/* Title Header */}
            <div className="relative text-center mb-8 w-full">
              <div className="absolute -inset-x-10 top-1/2 -translate-y-1/2 h-12 bg-amber-400/20 blur-2xl rounded-full"></div>
              <h2 className="relative z-10 text-4xl md:text-5xl font-serif font-black tracking-[0.25em] text-amber-950 drop-shadow-xs">
                AI駆動・拡張将棋
              </h2>
              <p className="text-xs font-serif font-bold text-amber-900 tracking-[0.2em] mt-4 bg-amber-100/70 px-4 py-2 rounded-full backdrop-blur-xs inline-block border border-amber-900/15">
                言葉から能力を創造し、九×九の戦場をハックせよ
              </p>
            </div>

            {/* Input & Action Card */}
            <div className="w-full bg-white/90 backdrop-blur-md p-8 rounded-2xl border border-amber-900/20 shadow-xl flex flex-col items-center gap-6 transition-all duration-300">
              <span className="text-xs tracking-[0.3em] font-extrabold text-amber-950 uppercase">先手名乗り（あなたの名前）</span>
              
              <input 
                type="text" 
                maxLength={16}
                value={playerNames.sente}
                onChange={(e) => {
                  const val = e.target.value;
                  onSetPlayerNames({ sente: val, gote: val });
                }}
                placeholder="例：織田信長"
                className="bg-stone-50 border-2 border-amber-900/30 focus:border-amber-700 text-lg font-bold py-2 px-4 text-center text-stone-900 tracking-widest outline-none w-full max-w-xs transition-all duration-300 rounded-xl placeholder:text-stone-400 shadow-inner"
              />
              
              <button 
                type="button"
                onClick={() => setCurrentStep('mode_select')}
                className="button-shine-effect w-full max-w-xs bg-gradient-to-r from-amber-800 to-amber-950 hover:from-amber-700 hover:to-amber-900 text-white font-extrabold tracking-[0.3em] pl-[0.3em] py-4 rounded-xl border border-amber-950/50 shadow-lg transform hover:-translate-y-0.5 active:translate-y-0 outline-none cursor-pointer text-base"
              >
                戦場へ出陣する
              </button>
            </div>
          </div>
        )}

        {currentStep === 'mode_select' && (
          <div className="w-full flex flex-col gap-6">
            
            <div className="flex justify-between items-center w-full">
              <button 
                type="button"
                onClick={() => setCurrentStep('title')} 
                className="text-xs font-bold tracking-widest text-amber-900 hover:text-amber-700 transition-colors cursor-pointer bg-amber-100/50 hover:bg-amber-100 px-3 py-1.5 rounded-lg border border-amber-900/10"
              >
                ← 名乗り入力へ戻る
              </button>

              <span className="text-xs font-bold text-amber-950 tracking-wider bg-amber-200/60 px-3 py-1 rounded-full border border-amber-900/20">
                名乗り: {playerNames.sente || '先手'}
              </span>
            </div>

            {/* 3 Main Mode Selection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full items-stretch">
              
              {/* Option 1: AI Battle */}
              <button
                type="button"
                onClick={() => {
                  setSelectedTab('ai');
                  onSetVsAiMode(true);
                  onSetOnlineMode(false);
                }}
                className={`group rounded-2xl p-6 text-center transition-all duration-300 border-2 outline-none flex flex-col items-center justify-between min-h-[160px] cursor-pointer shadow-md ${
                  selectedTab === 'ai' && !onlineMode
                    ? 'bg-amber-50 border-amber-700 ring-2 ring-amber-600/30 shadow-lg -translate-y-1'
                    : 'bg-white/90 border-stone-200 hover:border-amber-400 hover:bg-amber-50/40 opacity-90 hover:opacity-100'
                }`}
              >
                <div className="text-3xl mb-1">🤖</div>
                <div>
                  <div className="text-lg tracking-wider font-extrabold text-stone-900 mb-1">AI対戦</div>
                  <div className="text-[11px] font-bold text-amber-900/80 leading-snug">思考エンジンGeminiと1人ですぐ遊ぶ</div>
                </div>
                <div className={`mt-3 text-xs font-bold px-4 py-1 rounded-full border transition-all ${
                  selectedTab === 'ai' && !onlineMode ? 'bg-amber-800 text-white border-amber-900' : 'bg-stone-100 text-stone-600 border-stone-200'
                }`}>
                  選択中
                </div>
              </button>

              {/* Option 2: Random Online Battle */}
              <button
                type="button"
                onClick={() => {
                  setSelectedTab('random');
                  onSetVsAiMode(false);
                  onSetOnlineMode(true);
                }}
                className={`group rounded-2xl p-6 text-center transition-all duration-300 border-2 outline-none flex flex-col items-center justify-between min-h-[160px] cursor-pointer shadow-md ${
                  selectedTab === 'random'
                    ? 'bg-amber-50 border-amber-700 ring-2 ring-amber-600/30 shadow-lg -translate-y-1'
                    : 'bg-white/90 border-stone-200 hover:border-amber-400 hover:bg-amber-50/40 opacity-90 hover:opacity-100'
                }`}
              >
                <div className="text-3xl mb-1">⚡</div>
                <div>
                  <div className="text-lg tracking-wider font-extrabold text-stone-900 mb-1">ランダム対戦</div>
                  <div className="text-[11px] font-bold text-amber-900/80 leading-snug">全国の対戦相手と即座に自動マッチ</div>
                </div>
                <div className={`mt-3 text-xs font-bold px-4 py-1 rounded-full border transition-all ${
                  selectedTab === 'random' ? 'bg-amber-800 text-white border-amber-900' : 'bg-stone-100 text-stone-600 border-stone-200'
                }`}>
                  選択中
                </div>
              </button>

              {/* Option 3: Custom Room Battle */}
              <button
                type="button"
                onClick={() => {
                  setSelectedTab('custom');
                  onSetVsAiMode(false);
                  onSetOnlineMode(true);
                }}
                className={`group rounded-2xl p-6 text-center transition-all duration-300 border-2 outline-none flex flex-col items-center justify-between min-h-[160px] cursor-pointer shadow-md ${
                  selectedTab === 'custom'
                    ? 'bg-amber-50 border-amber-700 ring-2 ring-amber-600/30 shadow-lg -translate-y-1'
                    : 'bg-white/90 border-stone-200 hover:border-amber-400 hover:bg-amber-50/40 opacity-90 hover:opacity-100'
                }`}
              >
                <div className="text-3xl mb-1">🔑</div>
                <div>
                  <div className="text-lg tracking-wider font-extrabold text-stone-900 mb-1">カスタム対戦</div>
                  <div className="text-[11px] font-bold text-amber-900/80 leading-snug">部屋コード（合言葉）で友達と対局</div>
                </div>
                <div className={`mt-3 text-xs font-bold px-4 py-1 rounded-full border transition-all ${
                  selectedTab === 'custom' ? 'bg-amber-800 text-white border-amber-900' : 'bg-stone-100 text-stone-600 border-stone-200'
                }`}>
                  選択中
                </div>
              </button>

            </div>

            {/* Dynamic Details / Status Container */}
            <div className="w-full bg-stone-50/90 border-2 border-amber-900/20 rounded-2xl p-6 shadow-inner transition-all">
              
              {/* Tab 1: AI Battle */}
              {selectedTab === 'ai' && (
                <div className="flex flex-col items-center text-center gap-4 animate-[fadeIn_0.3s_ease-out]">
                  <p className="text-sm font-bold text-stone-800 leading-relaxed max-w-lg">
                    思考エンジン（Gemini AI）と対峙します。入力した言葉から創造された「カスタム駒」の能力を駆使して挑戦してください。
                  </p>
                  <button
                    type="button"
                    onClick={onStartGame}
                    className="w-full max-w-md py-4 bg-gradient-to-r from-amber-800 to-amber-950 hover:from-amber-700 hover:to-amber-900 text-white rounded-xl text-base tracking-[0.3em] font-extrabold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all outline-none cursor-pointer border border-amber-950/50 mt-2"
                  >
                    AI対戦を開始する
                  </button>
                </div>
              )}

              {/* Tab 2: Random Match */}
              {selectedTab === 'random' && (
                <div className="flex flex-col items-center text-center gap-4 animate-[fadeIn_0.3s_ease-out]">
                  {isConnectingHandshake ? (
                    <div className="space-y-3 py-2">
                      <div className="text-base font-extrabold text-amber-900 animate-pulse">
                        🤝 対戦相手が見つかりました！通信確立中...
                      </div>
                      <p className="text-xs font-bold text-stone-600">双方の接続同期を確認しています。間もなく対局が開始します。</p>
                      <div className="flex gap-2 justify-center">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-800 animate-ping"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-800 animate-ping [animation-delay:0.2s]"></span>
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-800 animate-ping [animation-delay:0.4s]"></span>
                      </div>
                    </div>
                  ) : isSearchingMatch || isWaitingForOpponent ? (
                    <div className="space-y-4 py-2 w-full max-w-md">
                      <div className="text-sm font-extrabold text-amber-950 flex items-center justify-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-600 animate-ping"></span>
                        対戦相手を自動探索中...
                      </div>
                      <p className="text-xs font-bold text-stone-600">対戦相手が合流するまでお待ちください。</p>
                      <button
                        type="button"
                        onClick={onCancelMatchmaking}
                        className="w-full py-2.5 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs tracking-widest font-bold transition-all cursor-pointer shadow-md"
                      >
                        マッチング探索をキャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4 w-full max-w-md">
                      <p className="text-sm font-bold text-stone-800 leading-relaxed">
                        全国のオンライン待機中プレイヤーと自動マッチングして、直ちにリアルタイム同期対局を開始します。
                      </p>
                      <button
                        type="button"
                        onClick={onRandomMatch}
                        className="w-full py-4 bg-gradient-to-r from-amber-800 to-amber-950 hover:from-amber-700 hover:to-amber-900 text-white rounded-xl text-base tracking-[0.3em] font-extrabold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 transition-all outline-none cursor-pointer border border-amber-950/50"
                      >
                        ⚡ ランダム対戦を開始
                      </button>
                    </div>
                  )}

                  {matchmakingError && (
                    <div className="text-xs text-rose-600 font-extrabold tracking-wider bg-rose-50 p-2.5 rounded-lg border border-rose-200 w-full max-w-md">
                      {matchmakingError}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Custom Room */}
              {selectedTab === 'custom' && (
                <div className="flex flex-col items-center text-center gap-4 animate-[fadeIn_0.3s_ease-out]">
                  {isConnectingHandshake ? (
                    <div className="space-y-3 py-2">
                      <div className="text-base font-extrabold text-amber-900 animate-pulse">
                        🤝 対戦相手が入室しました！通信確立中...
                      </div>
                      <p className="text-xs font-bold text-stone-600">双方の同期を確認しています。</p>
                    </div>
                  ) : isWaitingForOpponent ? (
                    <div className="space-y-4 py-2 w-full max-w-md bg-white p-6 rounded-xl border border-amber-900/20 shadow-sm">
                      <div className="text-xs text-stone-600 font-bold tracking-widest">
                        友達に以下の「6桁部屋コード」を共有してください
                      </div>
                      <div className="text-3xl font-extrabold tracking-[0.3em] text-amber-900 font-mono py-2 bg-amber-50 rounded-lg border border-amber-900/10">
                        {roomCode}
                      </div>
                      <p className="text-[11px] text-stone-500 font-bold">相手が入室すると自動的に同期対局へ進みます。</p>
                      <button
                        type="button"
                        onClick={onCancelMatchmaking}
                        className="w-full py-2 bg-rose-700 hover:bg-rose-800 text-white rounded-lg text-xs tracking-widest font-bold transition-all cursor-pointer"
                      >
                        部屋待機をキャンセル
                      </button>
                    </div>
                  ) : (
                    <div className="w-full max-w-md space-y-6">
                      {/* Create Room */}
                      <div className="bg-white p-4 rounded-xl border border-stone-200 flex flex-col md:flex-row items-center justify-between gap-3 shadow-sm">
                        <div className="text-left">
                          <div className="text-xs font-extrabold text-stone-900">部屋を作成する</div>
                          <div className="text-[10px] font-bold text-stone-500">新しい対局室を作り部屋コードを発行</div>
                        </div>
                        <button
                          type="button"
                          onClick={onCreateRoom}
                          className="w-full md:w-auto px-5 py-2.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-extrabold tracking-widest transition-all cursor-pointer"
                        >
                          部屋を作る
                        </button>
                      </div>

                      {/* Join Room */}
                      <div className="bg-white p-4 rounded-xl border border-stone-200 flex flex-col md:flex-row items-center justify-between gap-3 shadow-sm">
                        <div className="text-left">
                          <div className="text-xs font-extrabold text-stone-900">部屋コードで入室</div>
                          <div className="text-[10px] font-bold text-stone-500">6桁の部屋コードを入力して参戦</div>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                          <input
                            type="text"
                            placeholder="6桁コード"
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                            className="bg-stone-50 border border-stone-300 text-sm font-bold px-3 py-2 text-center text-stone-900 tracking-widest outline-none w-28 rounded-lg font-mono focus:border-amber-600"
                          />
                          <button
                            type="button"
                            disabled={inputCode.length !== 6}
                            onClick={() => onJoinRoom(inputCode)}
                            className={`text-xs font-extrabold tracking-widest px-4 py-2 rounded-lg border transition-all ${
                              inputCode.length === 6
                                ? "bg-amber-800 hover:bg-amber-900 text-white border-amber-900 cursor-pointer shadow-sm"
                                : "bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed"
                            }`}
                          >
                            入室
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {matchmakingError && (
                    <div className="text-xs text-rose-600 font-extrabold tracking-wider bg-rose-50 p-2.5 rounded-lg border border-rose-200 w-full max-w-md">
                      {matchmakingError}
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>
        )}

      </div>

      {/* Rule Modal */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white border-2 border-amber-900/30 rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl relative space-y-6">
            <div className="flex justify-between items-center border-b border-stone-200 pb-3">
              <h3 className="font-serif text-lg font-black text-amber-950 tracking-wider">規則・遊戯心得</h3>
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="w-8 h-8 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-sm flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs font-bold text-stone-800 leading-relaxed">
              <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-900/10">
                <span className="text-amber-900 font-extrabold block mb-1">一、 【言葉からの駒能力創造】</span>
                あなたが入力した任意の言葉から、独自の足回りと自動能力を宿した『カスタム駒』が戦術手札に生成されます。
              </div>

              <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-900/10">
                <span className="text-amber-900 font-extrabold block mb-1">二、 【召喚と全自動能力執行】</span>
                カスタム駒は自陣の空きマスへ手札から打ち出せます。次手番以降に移動させることで、大技が自動執行されます。
              </div>

              <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-900/10">
                <span className="text-amber-900 font-extrabold block mb-1">三、 【切札と風化】</span>
                強大すぎる能力は1ゲーム1回限定の切り札となり、使用後は前後左右1マスの充填状態へと変化します。
              </div>
            </div>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="w-full py-3 bg-amber-900 hover:bg-amber-950 text-white font-extrabold text-xs tracking-widest rounded-xl transition-all cursor-pointer shadow-md"
              >
                理解した（閉じる）
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
};
