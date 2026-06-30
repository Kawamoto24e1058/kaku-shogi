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
  const [currentStep, setCurrentStep] = useState<'title' | 'mode_select'>('title');

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
      <header className="w-full max-w-3xl flex justify-between items-center border-b border-amber-900/10 pb-4 mb-12 z-10">
        <h1 className="font-serif text-lg tracking-[0.2em] text-neutral-900">拡張将棋</h1>
        <span className="text-xs font-mono tracking-widest text-neutral-500">SAPIENS RUNTIME v3.0.0</span>
      </header>

      {/* Main card (Shoji Wind) */}
      <div className="w-full max-w-3xl bg-white/70 border border-amber-900/10 p-8 md:p-12 rounded-3xl shadow-xl shadow-amber-900/5 backdrop-blur-sm relative z-10 animate-fade-in flex flex-col items-center justify-center">
        
        {currentStep !== 'title' && (
          <div className="text-center mb-12">
            <h2 className="font-serif text-2xl md:text-3xl tracking-[0.3em] text-neutral-900 mb-2">AI駆動・拡張将棋</h2>
            <p className="text-xs tracking-widest text-amber-800 font-serif">― 言葉から能力を創造し、九×九の戦場をハックせよ ―</p>
          </div>
        )}

        {currentStep === 'title' && (
          <div className="relative flex flex-col items-center justify-center w-full max-w-xl mx-auto select-none animate-[fadeIn_0.5s_ease-out]">
            
            {/* 3D Rotating Shogi Piece Canvas with Backlight */}
            <div className="relative w-72 h-72 flex items-center justify-center mb-2 mx-auto">
              <div className="absolute inset-0 bg-gradient-to-tr from-amber-500/10 to-transparent blur-3xl rounded-full animate-pulse"></div>
              <div className="w-full h-full z-10 pointer-events-none flex items-center justify-center">
                <Koma3D />
              </div>
            </div>

            {/* Title Header with Gold Backlight */}
            <div className="relative text-center mb-8 w-full">
              <div className="absolute -inset-x-10 top-1/2 -translate-y-1/2 h-12 bg-amber-400/15 blur-2xl rounded-full"></div>
              <h2 className="relative z-10 text-4xl md:text-5xl font-serif font-black tracking-[0.25em] text-stone-900 drop-shadow-sm">
                AI駆動・拡張将棋
              </h2>
              <p className="text-xs font-serif font-medium text-amber-700/80 tracking-[0.2em] mt-4 bg-stone-200/50 px-4 py-1.5 rounded-full backdrop-blur-xs inline-block border border-amber-900/5">
                ─ 言葉から能力を創造し、九×九の戦場をハックせよ ─
              </p>
            </div>

            {/* Input & Action Card */}
            <div className="w-full bg-white/70 backdrop-blur-md p-8 rounded-2xl border border-amber-900/10 shadow-xl shadow-amber-950/5 flex flex-col items-center gap-6 transition-all duration-300">
              <span className="text-[10px] tracking-[0.4em] font-bold text-amber-900/60 uppercase">先手名乗り</span>
              
              <input 
                type="text" 
                maxLength={16}
                value={playerNames.sente}
                onChange={(e) => {
                  const val = e.target.value;
                  onSetPlayerNames({ sente: val, gote: val });
                }}
                placeholder="例：織田信長"
                className="bg-transparent border-b-2 border-stone-300 focus:border-amber-800 text-lg font-bold py-1.5 text-center text-stone-900 tracking-widest outline-none w-full max-w-xs transition-all duration-300 rounded-none placeholder:text-neutral-400"
              />
              
              <button 
                type="button"
                onClick={() => setCurrentStep('mode_select')}
                className="button-shine-effect w-full max-w-xs bg-gradient-to-r from-amber-900 to-amber-950 text-white font-bold tracking-[0.3em] pl-[0.3em] py-3.5 rounded-xl border border-amber-950/50 shadow-md transform outline-none cursor-pointer"
              >
                戦場へ出陣する
              </button>
            </div>
          </div>
        )}

        {currentStep === 'mode_select' && (
          <div className="w-full flex flex-col gap-10">
            
            <div className="text-left">
              <button 
                type="button"
                onClick={() => setCurrentStep('title')} 
                className="text-sm font-bold tracking-widest text-amber-800 hover:text-amber-600 transition-colors cursor-pointer"
              >
                ← 庵へ戻る
              </button>
            </div>

            {/* Sente Name Edit */}
            <section className="w-full flex flex-col items-center">
              <div className="w-full bg-white/60 p-8 rounded-2xl border border-amber-900/10 shadow-sm flex flex-col items-center justify-center gap-4">
                <label className="text-xs tracking-[0.3em] text-amber-808 font-bold uppercase">先手武将名（名乗りの変更）</label>
                
                <input 
                  type="text" 
                  maxLength={16}
                  value={playerNames.sente}
                  onChange={(e) => {
                    const val = e.target.value;
                    onSetPlayerNames({ sente: val, gote: onlineMode ? val : playerNames.gote });
                  }}
                  placeholder="例：織田信長"
                  className="bg-transparent border-b border-t-0 border-l-0 border-r-0 border-amber-900/30 focus:border-amber-800 text-base font-bold py-2 text-center text-neutral-955 tracking-widest outline-none w-full max-w-md transition-all duration-300 rounded-none placeholder:text-neutral-400" 
                />
              </div>
            </section>

            <section className="w-full">
              <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">対局形式を選択</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full items-stretch mb-8" role="radiogroup" aria-label="対局モード選択">
                
                {/* VS AI Mode */}
                <button 
                  type="button"
                  onClick={() => { onSetVsAiMode(true); onSetOnlineMode(false); }}
                  role="radio"
                  aria-checked={vsAiMode && !onlineMode}
                  className={`group rounded-2xl p-8 text-center transition-all duration-300 border-2 outline-none flex flex-col items-center justify-center min-h-[140px] cursor-pointer ${
                    (vsAiMode && !onlineMode)
                      ? 'bg-amber-50/70 border-amber-800 shadow-[0_12px_24px_rgba(139,92,26,0.1)] -translate-y-0.5' 
                      : 'bg-white border-amber-900/10 shadow-sm opacity-70 hover:opacity-100 hover:border-amber-900/30'
                  }`}
                >
                  <div className="text-xs tracking-[0.2em] text-neutral-500 font-bold mb-2">VS ARTIFICIAL INTELLIGENCE</div>
                  <div className={`text-xl md:text-2xl tracking-[0.2em] font-bold ${
                    (vsAiMode && !onlineMode) ? 'text-amber-900' : 'text-neutral-900'
                  } pl-[0.2em]`}>一人対局</div>
                </button>

                {/* VS Player Mode */}
                <button 
                  type="button"
                  onClick={() => { onSetVsAiMode(false); onSetOnlineMode(false); }}
                  role="radio"
                  aria-checked={!vsAiMode && !onlineMode}
                  className={`group rounded-2xl p-8 text-center transition-all duration-300 border-2 outline-none flex flex-col items-center justify-center min-h-[140px] cursor-pointer ${
                    (!vsAiMode && !onlineMode)
                      ? 'bg-amber-50/70 border-amber-800 shadow-[0_12px_24px_rgba(139,92,26,0.1)] -translate-y-0.5' 
                      : 'bg-white border-amber-900/10 shadow-sm opacity-70 hover:opacity-100 hover:border-amber-900/30'
                  }`}
                >
                  <div className="text-xs tracking-[0.2em] text-neutral-500 font-bold mb-2">LOCAL MATCH</div>
                  <div className={`text-xl md:text-2xl tracking-[0.2em] font-bold ${
                    (!vsAiMode && !onlineMode) ? 'text-amber-900' : 'text-neutral-900'
                  } pl-[0.2em]`}>二人対局</div>
                </button>

                {/* Online Match Mode */}
                <button 
                  type="button"
                  onClick={() => { onSetVsAiMode(false); onSetOnlineMode(true); }}
                  role="radio"
                  aria-checked={onlineMode}
                  className={`group rounded-2xl p-8 text-center transition-all duration-300 border-2 outline-none flex flex-col items-center justify-center min-h-[140px] cursor-pointer ${
                    onlineMode
                      ? 'bg-amber-50/70 border-amber-800 shadow-[0_12px_24px_rgba(139,92,26,0.1)] -translate-y-0.5' 
                      : 'bg-white border-amber-900/10 shadow-sm opacity-70 hover:opacity-100 hover:border-amber-900/30'
                  }`}
                >
                  <div className="text-xs tracking-[0.2em] text-neutral-500 font-bold mb-2">ONLINE NETWORK</div>
                  <div className={`text-xl md:text-2xl tracking-[0.2em] font-bold ${
                    onlineMode ? 'text-amber-900' : 'text-neutral-900'
                  } pl-[0.2em]`}>遠隔対局</div>
                </button>

              </div>

              {/* Dynamic explanation block */}
              <div className="bg-amber-50/30 border border-amber-900/5 rounded-2xl p-6 min-h-[90px] flex items-center justify-center shadow-inner">
                <p 
                  key={vsAiMode ? 'single' : (onlineMode ? 'online' : 'local')}
                  className="text-sm text-neutral-800 font-bold leading-loose tracking-wide text-center max-w-3xl animate-[fadeIn_0.3s_ease-out]"
                >
                  {vsAiMode && !onlineMode && '【人工知能戦】 思考エンジン（Gemini AI）と対峙します。あなたが入力した言葉から紡がれたカスタム駒が、盤上でリアルタイムに展開されます。'}
                  {!vsAiMode && !onlineMode && '【対面対戦】 1台の端末を交互に操作して遊ぶローカル対戦モードです。互いに3枚の強力な切り札（カスタム駒）を懐に忍ばせて対局に臨みます。'}
                  {onlineMode && '【遠隔対戦】 合言葉を用いて、離れた場所にいる知人や、未知の棋士とのランダムマッチングを行います。リアルタイムの通信同期対局です。'}
                </p>
              </div>
            </section>

            {/* Gote name input (only for Local 2P) */}
            {!vsAiMode && !onlineMode && (
              <section className="w-full animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">後手設定</h3>
                <div className="bg-white/60 p-6 rounded-2xl border border-amber-900/10 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 px-8">
                  <label className="text-sm tracking-widest text-neutral-955 font-bold">名（後手名乗り）</label>
                  <input 
                    type="text" 
                    maxLength={16}
                    className="bg-white border-2 border-amber-900/20 focus:border-amber-700 rounded-full text-base font-bold px-8 py-4 text-center md:text-right text-neutral-955 tracking-widest outline-none w-full md:w-[400px] shadow-sm transition-all focus:shadow-md"
                    value={playerNames.gote}
                    onChange={(e) => onSetPlayerNames({ ...playerNames, gote: e.target.value })}
                  />
                </div>
              </section>
            )}

            {/* Online Room Section (Visible only when Online Mode is active) */}
            {onlineMode && (
              <section className="w-full animate-[fadeIn_0.3s_ease-out]">
                <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">
                  遠隔対局設定
                </h3>
                <div className="bg-white/60 p-8 rounded-3xl border border-amber-900/10 shadow-sm space-y-6">
                  {isSearchingMatch ? (
                    <div className="text-center py-4">
                      <div className="text-sm tracking-widest text-neutral-800 font-serif mb-4">
                        対戦相手を探索中
                      </div>
                      <button
                        type="button"
                        onClick={onCancelMatchmaking}
                        className="border border-red-900/40 hover:border-red-400 bg-red-700 text-xs tracking-widest px-6 py-2 transition-all duration-300 cursor-pointer font-serif"
                      >
                        探索中止
                      </button>
                    </div>
                  ) : isWaitingForOpponent ? (
                    <div className="text-center py-4">
                      {isRandomMatch ? (
                        <div className="space-y-4">
                          <div className="text-sm tracking-widest text-amber-800 font-serif">
                            自動マッチング対局の接続待機中
                          </div>
                          <div className="flex gap-2 justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-800/50 animate-pulse"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-800/50 animate-pulse [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-800/50 animate-pulse [animation-delay:0.4s]"></span>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="text-xs text-neutral-500 tracking-widest font-serif">
                            対戦相手に下記コードを共有してください
                          </div>
                          <div className="text-3xl font-bold tracking-[0.25em] text-amber-800 font-mono py-2">
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
                        className="border border-red-900/40 hover:border-red-400 bg-red-700 text-xs tracking-widest px-6 py-2 transition-all duration-300 cursor-pointer font-serif"
                      >
                        待機中止
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Option 0: Random */}
                      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                        <div className="text-left">
                          <div className="text-xs tracking-widest text-neutral-700 font-bold">ランダム対局</div>
                          <div className="text-[10px] text-neutral-500 tracking-wider mt-1">待機中の他のプレイヤーと自動的にマッチングして開始します。</div>
                        </div>
                        <button
                          type="button"
                          onClick={onRandomMatch}
                          className="border border-amber-900/20 hover:border-amber-800 text-xs tracking-widest px-4 py-2 text-neutral-800 bg-amber-50/40 transition-colors duration-300 cursor-pointer font-serif"
                        >
                          対局相手を探索
                        </button>
                      </div>

                      {/* Option 1: Create Room */}
                      <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                        <div className="text-left">
                          <div className="text-xs tracking-widest text-neutral-700 font-bold">対局室作成</div>
                          <div className="text-[10px] text-neutral-500 tracking-wider mt-1">新規の対局部屋を作成し、入室用コードを発行します。</div>
                        </div>
                        <button
                          type="button"
                          onClick={onCreateRoom}
                          className="border border-amber-900/20 hover:border-amber-800 text-xs tracking-widest px-4 py-2 text-neutral-800 bg-amber-50/40 transition-colors duration-300 cursor-pointer font-serif"
                        >
                          部屋を作成
                        </button>
                      </div>

                      {/* Option 2: Join Room */}
                      <div className="flex items-center justify-between">
                        <div className="text-left">
                          <div className="text-xs tracking-widest text-neutral-700 font-bold">対局室入室</div>
                          <div className="text-[10px] text-neutral-500 tracking-wider mt-1">発行された6桁の部屋コードを入力して参戦します。</div>
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="部屋コード"
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                            className="bg-transparent border border-amber-900/30 text-xs px-3 py-2 text-center text-neutral-800 tracking-widest outline-none w-28 transition-colors focus:border-amber-800 font-mono"
                          />
                          <button
                            type="button"
                            disabled={inputCode.length !== 6}
                            onClick={() => onJoinRoom(inputCode)}
                            className={`text-xs tracking-widest px-4 py-2 border transition-all duration-300 font-serif ${
                              inputCode.length === 6
                                ? "border-amber-900/40 hover:border-amber-800 text-amber-800 bg-amber-50/50 cursor-pointer"
                                : "border-neutral-200 text-neutral-400 cursor-not-allowed"
                            }`}
                          >
                            入室
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {matchmakingError && (
                    <div className="text-xs text-red-500 text-center tracking-widest pt-2 font-serif">
                      エラー: {matchmakingError}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Shogi Rules and Instructions */}
            <section className="w-full">
              <h3 className="font-serif text-xs tracking-[0.2em] text-amber-200/70 uppercase mb-4 border-l border-amber-200/40 pl-3">拡張規則説明</h3>
              <div className="text-[11px] text-neutral-500 space-y-3 leading-relaxed font-serif pl-3">
                <p>一、 任意の単語から、独自の足回りと自動能力を宿した【カスタム駒】が手札に創造される。</p>
                <p>二、 カスタム駒は自陣の空きマスへドロップ（召喚）し、次手以降に動かすことで能力が全自動執行される。</p>
                <p>三、 強大すぎる能力は一ゲームに一回の切り札となり、使用後は前後左右一マスの充填状態へ風化する。</p>
              </div>
            </section>

            {/* Start Game Action */}
            {!onlineMode && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={onStartGame}
                  className="px-28 py-5 bg-amber-800 hover:bg-amber-900 text-white rounded-full text-sm tracking-[0.5em] font-bold shadow-xl shadow-amber-900/30 hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-300 outline-none cursor-pointer"
                >
                  この形式で挙兵する
                </button>
              </div>
            )}

          </div>
        )}

      </div>
    </main>
  );
};
