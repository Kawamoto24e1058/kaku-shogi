import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * 駒づくりの工房（立体の駒が加工されていく演出）。
 * AI が読み解いている間も、段階ごとに駒が変わっていくので待ち時間が退屈にならない。
 *   0 読み解く … 素の木札がゆっくり回り、木くずが舞う
 *   1 彫る     … 言葉が少しずつ彫り込まれる（火花）
 *   2 色を塗る … 木の色から、その駒の色へ塗り替わる
 *   3 動き     … 駒の足元に光の輪が広がる
 *   4 能力     … 駒が駒の色で光り、回転が速くなる
 *   5 完成     … ひと回りして正面で止まる
 */
export const FORGE_STEPS = ['言葉を読み解く', '駒を彫る', '色を塗る', '動きを決める', '能力を込める', '完成'] as const;

interface Props {
  stage: number;
  text: string;
  color?: string;
  accent?: string;
  size?: number;
}

const WOOD = new THREE.Color(0xf3e3bf);

function drawText(ctx: CanvasRenderingContext2D, text: string, reveal: number, ink: string) {
  ctx.clearRect(0, 0, 512, 512);
  if (!text || reveal <= 0) return;
  ctx.save();
  // 上から下へ彫り進める（見えている範囲を少しずつ広げる）
  ctx.beginPath();
  ctx.rect(0, 0, 512, 60 + 452 * Math.min(1, reveal));
  ctx.clip();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const t = [...text];
  const font = (px: number) => `bold ${px}px 'Noto Serif JP', 'Yu Mincho', serif`;
  if (t.length === 1) { ctx.font = font(220); ctx.fillText(t[0], 256, 270); }
  else if (t.length === 2) { ctx.font = font(160); ctx.fillText(t[0], 256, 185); ctx.fillText(t[1], 256, 345); }
  else if (t.length === 3) { ctx.font = font(110); t.forEach((c, i) => ctx.fillText(c, 256, 170 + i * 100)); }
  else if (t.length === 4) { ctx.font = font(100); ctx.fillText(t.slice(0, 2).join(''), 256, 200); ctx.fillText(t.slice(2).join(''), 256, 340); }
  else { ctx.font = font(78); ctx.fillText(t.slice(0, 3).join(''), 256, 200); ctx.fillText(t.slice(3, 6).join(''), 256, 320); }
  ctx.restore();
}

export const KomaForge3D: React.FC<Props> = ({ stage, text, color, accent, size = 240 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // アニメーションの中から最新の値を読むための入れ物
  const props = useRef({ stage, text, color, accent });
  props.current = { stage, text, color, accent };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return; // WebGL が使えない端末では、下の文字の進み具合だけで見せる
    }
    renderer.setSize(size, size, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.2, 8.5);

    // 駒の形（五角形を厚みのある板にする）
    const W = 1.3, w = 0.9, H = 3.2, h = 2.5;
    const shape = new THREE.Shape();
    shape.moveTo(-W, -H / 2); shape.lineTo(W, -H / 2); shape.lineTo(w, h - H / 2); shape.lineTo(0, H / 2); shape.lineTo(-w, h - H / 2); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { steps: 1, depth: 0.35, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.04, bevelSegments: 4 });
    geometry.center();
    const material = new THREE.MeshStandardMaterial({ color: WOOD.clone(), roughness: 0.25, metalness: 0.0, emissive: new THREE.Color(0x000000) });
    const koma = new THREE.Mesh(geometry, material);

    // 彫る文字（表と裏）
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 512; tCanvas.height = 512;
    const tCtx = tCanvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(tCanvas);
    const textMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), textMat);
    front.position.z = 0.28;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H), textMat);
    back.position.z = -0.28; back.rotation.y = Math.PI;

    const group = new THREE.Group();
    group.add(koma, front, back);
    scene.add(group);

    // 足元の光の輪（動きを決める段階）
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xd4af37, transparent: true, opacity: 0, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.6, 48), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = -1.9;
    scene.add(ring);

    // 木くず・火花（小さな点）
    const N = 60;
    const pos = new Float32Array(N * 3);
    const vel: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) { vel.push(new THREE.Vector3()); pos[i * 3 + 1] = -99; }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xc8a165, size: 0.09, transparent: true, opacity: 0.9 });
    const points = new THREE.Points(pGeo, pMat);
    scene.add(points);

    // 木の色が灰色に沈まないよう、正面と斜め上から当てる
    scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb8a888, 1.1));
    const light = new THREE.DirectionalLight(0xffffff, 1.6);
    light.position.set(4, 6, 6);
    scene.add(light);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(-5, 1, 4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0, 2, -6);
    scene.add(rim);

    let raf = 0;
    let last = performance.now();
    let spin = 0;
    let reveal = 0;
    let drawn = '';
    let lastStage = -1;
    let doneAt = 0;
    let emitTimer = 0;
    const target = new THREE.Color();

    const emit = (count: number, spark: boolean) => {
      for (let n = 0; n < count; n++) {
        const i = Math.floor(Math.random() * N);
        pos[i * 3] = (Math.random() - 0.5) * 1.6;
        pos[i * 3 + 1] = (Math.random() - 0.3) * 2.4;
        pos[i * 3 + 2] = 0.4;
        vel[i].set((Math.random() - 0.5) * 2.4, Math.random() * 2 + (spark ? 1 : 0), Math.random() * 1.5);
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { stage: s, text: tx, color: c, accent: a } = props.current;
      if (s !== lastStage) {
        if (s === 5) doneAt = now;
        lastStage = s;
      }

      // 回転: 能力を込める段階で速く、完成したら正面で止まる
      if (s >= 5) {
        const k = Math.min(1, (now - doneAt) / 1200);
        const goal = Math.ceil(spin / (Math.PI * 2)) * Math.PI * 2;
        spin += (goal - spin) * Math.min(1, dt * 4) + (1 - k) * dt * 6;
        group.rotation.x = 0.08;
      } else {
        spin += dt * (s === 4 ? 3.2 : 0.7);
        group.rotation.x = 0.15 + Math.sin(now / 900) * 0.08;
      }
      group.rotation.y = spin;
      group.position.y = Math.sin(now / 700) * 0.06;

      // 彫る: 文字を上から少しずつ
      const wantReveal = s >= 1 ? 1 : 0;
      reveal += (wantReveal - reveal) * Math.min(1, dt * 1.6);
      const ink = s >= 2 && a ? a : '#1a120a';
      const key = `${tx}|${reveal.toFixed(2)}|${ink}`;
      if (key !== drawn) { drawText(tCtx, tx, reveal, ink); texture.needsUpdate = true; drawn = key; }

      // 色を塗る
      target.copy(s >= 2 && c ? new THREE.Color(c) : WOOD);
      material.color.lerp(target, Math.min(1, dt * 2.5));
      // 能力を込める: 光る
      const glow = s === 4 ? 0.35 + Math.sin(now / 160) * 0.15 : s >= 5 ? Math.max(0, 0.5 - (now - doneAt) / 1500) : 0;
      material.emissive.set(a || '#d4af37').multiplyScalar(glow);

      // 足元の輪
      ringMat.color.set(a || '#d4af37');
      const ringOn = s === 3 ? 0.8 : s >= 4 ? 0.35 : 0;
      ringMat.opacity += (ringOn - ringMat.opacity) * Math.min(1, dt * 4);
      const pulse = 1 + ((now / 900) % 1) * 0.5;
      ring.scale.setScalar(s === 3 ? pulse : 1);

      // 木くず（読み解き・彫る）と火花（能力）
      emitTimer += dt;
      if (s <= 1 && emitTimer > 0.06) { emit(2, false); emitTimer = 0; }
      if (s === 4 && emitTimer > 0.05) { emit(3, true); emitTimer = 0; }
      pMat.color.set(s === 4 ? (a || '#ffd166') : '#c8a165');
      for (let i = 0; i < N; i++) {
        vel[i].y -= 4 * dt;
        pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
      }
      pGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      geometry.dispose(); material.dispose(); texture.dispose(); textMat.dispose();
      ringMat.dispose(); ring.geometry.dispose(); pGeo.dispose(); pMat.dispose();
      front.geometry.dispose(); back.geometry.dispose();
      renderer.dispose();
    };
  }, [size]);

  return <canvas ref={canvasRef} width={size} height={size} style={{ width: `${size}px`, height: `${size}px`, display: 'block', margin: '0 auto' }} aria-hidden="true" />;
};
