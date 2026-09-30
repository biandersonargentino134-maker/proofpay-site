// ProofPay — Hero background (Canvas2D puro, sem dependências)
//
// Malha de pontos em perspectiva, com ondulação lenta e um pulso de luz
// que atravessa a rede de longe para perto — a "verificação" percorrendo
// a infraestrutura. Sem Three.js, sem import, sem CDN: só <script> comum,
// então funciona em qualquer hospedagem, independente de módulos ES.
(function () {
  const container = document.getElementById('hero-bg');
  const canvas = document.getElementById('hero-bg-canvas');
  if (!container || !canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSmallViewport = window.innerWidth < 760;

  const ROWS = isSmallViewport ? 20 : 32;
  const COLS = isSmallViewport ? 28 : 42;

  const COLOR_BASE = [222, 224, 232];   // prata
  const COLOR_PULSE = [147, 163, 255];  // azul-violeta discreto

  let w = 0, h = 0, dpr = 1;
  let isVisible = true;
  let startTime = null;

  function resize() {
    w = container.clientWidth || window.innerWidth;
    h = container.clientHeight || 480;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function easeInPow(t, p) { return Math.pow(t, p); }

  function drawFrame(time) {
    ctx.clearRect(0, 0, w, h);

    const horizonY = h * 0.16;
    const floorH = h - horizonY;
    const sway = Math.sin(time * 0.06) * 0.018;

    // pulso viaja de longe (t=0) para perto (t=1) e volta a sumir, em loop lento
    const cycle = 9; // segundos por passagem
    let travel = (time % cycle) / cycle * 1.35 - 0.15;

    for (let r = 0; r < ROWS; r++) {
      const t = r / (ROWS - 1);
      const tCurve = easeInPow(t, 1.9);
      const y0 = horizonY + tCurve * floorH;
      const spread = w * (0.05 + tCurve * 0.95);
      const dotSize = 0.65 + t * 2.5;
      const rowAlpha = 0.09 + t * 0.5;

      const dist = Math.abs(t - travel);
      const pulse = Math.max(0, 1 - dist / 0.16);
      const pulseEase = pulse * pulse;

      for (let c = 0; c < COLS; c++) {
        const u = c / (COLS - 1) - 0.5 + sway * t;
        const wobble = Math.sin(u * 5.5 + t * 5 + time * 0.16) * (3 + t * 16)
                     + Math.sin(t * 3 - time * 0.09) * (2 + t * 8);
        const x = w / 2 + u * spread;
        const y = y0 + wobble;

        const size = dotSize * (1 + pulseEase * 0.9);
        const alpha = Math.min(1, rowAlpha + pulseEase * 0.7);

        const mix = pulseEase;
        const cr = COLOR_BASE[0] + (COLOR_PULSE[0] - COLOR_BASE[0]) * mix;
        const cg = COLOR_BASE[1] + (COLOR_PULSE[1] - COLOR_BASE[1]) * mix;
        const cb = COLOR_BASE[2] + (COLOR_PULSE[2] - COLOR_BASE[2]) * mix;

        ctx.beginPath();
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${alpha.toFixed(3)})`;
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!isVisible) return;
    if (startTime === null) startTime = ts;
    drawFrame((ts - startTime) / 1000);
  }

  resize();
  new ResizeObserver(resize).observe(container);
  new IntersectionObserver(
    (entries) => { isVisible = entries[0].isIntersecting; },
    { threshold: 0.05 }
  ).observe(container);

  if (prefersReducedMotion) {
    drawFrame(0);
    window.addEventListener('resize', () => drawFrame(0), { passive: true });
  } else {
    requestAnimationFrame(frame);
  }
})();
