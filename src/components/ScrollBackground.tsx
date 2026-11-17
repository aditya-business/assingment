import { useEffect, useRef } from 'react';

const FRAME_COUNT = 300;
const frameUrl = (i: number) =>
  `${import.meta.env.BASE_URL}frames/frame_${String(i + 1).padStart(4, '0')}.jpg`;

/**
 * Full-page scroll-driven frame animation.
 * Fixed behind all content; scroll position across the whole page scrubs
 * through the 300 frames (smoothed, with sub-frame blending).
 */
export function ScrollBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const frames: (HTMLImageElement | null)[] = new Array(FRAME_COUNT).fill(null);
    const decoded = new Uint8Array(FRAME_COUNT);
    let lastDrawKey = '';
    let target = 0;
    let current = 0;
    let last = performance.now();
    let raf = 0;
    let cancelled = false;

    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      lastDrawKey = '';
    };

    const drawImage = (img: HTMLImageElement, alpha: number) => {
      const cw = canvas.width;
      const ch = canvas.height;
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return;
      const s = Math.max(cw / iw, ch / ih); // cover-fit
      const w = iw * s;
      const h = ih * s;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    };

    const nearest = (i: number) => {
      if (frames[i]) return i;
      for (let d = 1; d < FRAME_COUNT; d += 1) {
        if (i - d >= 0 && frames[i - d]) return i - d;
        if (i + d < FRAME_COUNT && frames[i + d]) return i + d;
      }
      return -1;
    };

    const render = (pos: number) => {
      const a = Math.min(FRAME_COUNT - 1, Math.max(0, Math.floor(pos)));
      const b = Math.min(FRAME_COUNT - 1, a + 1);
      let t = pos - a;
      if (t < 0.002) t = 0;

      const ia = nearest(a);
      if (ia < 0) return;
      const ib = t > 0 ? nearest(b) : -1;

      const key = `${ia}|${ib}|${t.toFixed(3)}`;
      if (key === lastDrawKey) return;
      lastDrawKey = key;

      drawImage(frames[ia]!, 1);
      if (ib >= 0 && ib !== ia) drawImage(frames[ib]!, t);
      ctx.globalAlpha = 1;
    };

    const readScroll = () => {
      const max =
        document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      target = p * (FRAME_COUNT - 1);
    };

    const warm = (center: number) => {
      const R = 36;
      const lo = Math.max(0, Math.floor(center) - R);
      const hi = Math.min(FRAME_COUNT - 1, Math.floor(center) + R);
      for (let i = lo; i <= hi; i += 1) {
        const img = frames[i];
        if (img && !decoded[i]) {
          decoded[i] = 1;
          img.decode().catch(() => {});
        }
      }
      for (let i = 0; i < FRAME_COUNT; i += 1) {
        if (decoded[i] && (i < lo - 80 || i > hi + 80)) decoded[i] = 0;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (prefersReduced) {
        current = target;
      } else {
        const k = 1 - Math.exp(-dt * 9);
        current += (target - current) * k;
        if (Math.abs(target - current) < 0.003) current = target;
      }
      warm(current);
      render(current);
      raf = requestAnimationFrame(tick);
    };

    // Coarse-to-fine load order so scrubbing works almost immediately.
    const loadOrder = () => {
      const seen = new Set<number>();
      const order: number[] = [];
      const push = (i: number) => {
        if (i < FRAME_COUNT && !seen.has(i)) {
          seen.add(i);
          order.push(i);
        }
      };
      push(0);
      for (const step of [60, 30, 15, 6, 3, 1]) {
        for (let i = 0; i < FRAME_COUNT; i += step) push(i);
      }
      push(FRAME_COUNT - 1);
      return order;
    };

    const loadFrame = (i: number) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (!cancelled) {
            frames[i] = img;
            lastDrawKey = '';
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = frameUrl(i);
      });

    const loadAll = async () => {
      const order = loadOrder();
      let cursor = 0;
      await loadFrame(order[cursor++]);
      if (cancelled) return;
      canvas.classList.add('opacity-100');
      canvas.classList.remove('opacity-0');
      const workers = Array.from({ length: 6 }, async () => {
        while (!cancelled && cursor < order.length) {
          await loadFrame(order[cursor++]);
        }
      });
      await Promise.all(workers);
    };

    resize();
    readScroll();
    current = target;

    window.addEventListener('resize', resize);
    window.addEventListener('resize', readScroll, { passive: true });
    window.addEventListener('scroll', readScroll, { passive: true });
    // Page height changes as images/fonts load; re-read after load too.
    window.addEventListener('load', readScroll);

    raf = requestAnimationFrame(tick);
    loadAll();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('resize', readScroll);
      window.removeEventListener('scroll', readScroll);
      window.removeEventListener('load', readScroll);
    };
  }, []);

  return (
    <div aria-hidden="true" className="fixed inset-0 z-0 pointer-events-none bg-[#14171B]">
      <canvas
        ref={canvasRef}
        className="block w-screen h-[100dvh] opacity-0 transition-opacity duration-[900ms] ease-out"
      />
      {/* Readability scrim: keeps the animation visible but text legible */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#14171B]/55 via-[#14171B]/45 to-[#14171B]/60" />
    </div>
  );
}
