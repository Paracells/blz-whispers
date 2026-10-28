/*
 * Small, self-contained particle painter for the four season screens.
 * Everything is drawn in 2D canvas; no image assets or libraries involved.
 */

const TAU = Math.PI * 2;
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (items) => items[(Math.random() * items.length) | 0];

function makeGlowSprite(rgb) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, `rgba(${rgb}, 1)`);
  gradient.addColorStop(0.18, `rgba(${rgb}, 0.75)`);
  gradient.addColorStop(0.45, `rgba(${rgb}, 0.18)`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

const SPRING_PETALS = ['#efd6d5', '#e8c4c7', '#f3e4cf', '#d9aab3', '#f5ecdc'];
const FALL_LEAVES = ['#c97632', '#b45b29', '#d9903e', '#92502a', '#e2a54f', '#a8652c'];

export class ParticleField {
  constructor(canvas, { reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.reducedMotion = reducedMotion;
    this.season = 'spring';
    this.particles = [];
    this.butterflies = [];
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.running = false;
    this.raf = 0;
    this.lastTime = 0;
    this.windTarget = 0;
    this.wind = 0;
    this.glowWarm = makeGlowSprite('255, 216, 145');
    this.glowCool = makeGlowSprite('235, 245, 252');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  setSeason(season) {
    if (this.season === season && this.particles.length) return;
    this.season = season;
    this.seed();
    if (!this.running) this.draw(performance.now());
  }

  setReducedMotion(reduced) {
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.draw(performance.now());
    } else if (this.wantsToRun) {
      this.start();
    }
  }

  setWind(normalizedX) {
    this.windTarget = (Math.max(0, Math.min(1, normalizedX)) - 0.5) * 1.4;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const newWidth = Math.round(rect.width);
    const newHeight = Math.round(rect.height);
    if (newWidth === this.width && newHeight === this.height && dpr === this.dpr) return;
    this.width = newWidth;
    this.height = newHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(newWidth * dpr);
    this.canvas.height = Math.round(newHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seed();
    if (!this.running) this.draw(performance.now());
  }

  scaleCount(base) {
    const area = this.width * this.height;
    return Math.max(8, Math.round(base * Math.min(1.4, Math.max(0.55, area / (760 * 760)))));
  }

  seed() {
    const w = this.width;
    const h = this.height;
    this.particles = [];
    this.butterflies = [];
    if (!w || !h) return;

    if (this.season === 'spring') {
      const count = this.scaleCount(26);
      for (let i = 0; i < count; i++) this.particles.push(this.makeFallingPetal(true));
      for (let i = 0; i < 3; i++) {
        this.butterflies.push({
          x: rand(w * 0.12, w * 0.88),
          y: rand(h * 0.18, h * 0.7),
          baseY: 0,
          speed: rand(5, 12) * (Math.random() < 0.5 ? -1 : 1),
          phase: rand(0, TAU),
          flap: rand(7, 10),
          size: rand(3.2, 5.4),
          color: pick(['#f0dcc0', '#e8cfa9', '#f5e8ce']),
        });
        const b = this.butterflies[this.butterflies.length - 1];
        b.baseY = b.y;
      }
    } else if (this.season === 'summer') {
      const count = this.scaleCount(34);
      for (let i = 0; i < count; i++) {
        this.particles.push({
          kind: 'firefly',
          x: rand(0.06 * w, 0.94 * w),
          y: rand(0.18 * h, 0.92 * h),
          size: rand(5, 15),
          phase: rand(0, TAU),
          speed: rand(0.25, 0.65),
          ampX: rand(5, 24),
          ampY: rand(4, 17),
          blink: rand(0.7, 1.9),
          baseAlpha: rand(0.35, 0.85),
          warm: Math.random() > 0.25,
        });
      }
      const dust = this.scaleCount(18);
      for (let i = 0; i < dust; i++) {
        this.particles.push(this.makeDriftingMote());
      }
    } else if (this.season === 'fall') {
      const count = this.scaleCount(30);
      for (let i = 0; i < count; i++) this.particles.push(this.makeLeaf(true));
      // A little late-summer pollen still hanging in the air.
      const dust = this.scaleCount(10);
      for (let i = 0; i < dust; i++) this.particles.push(this.makeDriftingMote());
    } else {
      const count = this.scaleCount(74);
      for (let i = 0; i < count; i++) this.particles.push(this.makeSnowflake(true));
    }
  }

  makeFallingPetal(spread) {
    const size = rand(3.5, 7.5);
    return {
      kind: 'petal',
      x: rand(0, this.width),
      y: spread ? rand(-this.height * 0.1, this.height) : -size * 2,
      vx: rand(-6, 6),
      vy: rand(12, 27),
      size,
      rot: rand(0, TAU),
      vr: rand(-1.1, 1.1),
      sway: rand(10, 28),
      swaySpeed: rand(0.5, 1.3),
      phase: rand(0, TAU),
      alpha: rand(0.42, 0.85),
      color: pick(SPRING_PETALS),
    };
  }

  makeLeaf(spread) {
    const size = rand(5.5, 12);
    return {
      kind: 'leaf',
      x: rand(0, this.width),
      y: spread ? rand(-this.height * 0.15, this.height) : -size * 2,
      vx: rand(-8, 8),
      vy: rand(18, 38),
      size,
      rot: rand(0, TAU),
      vr: rand(-1.7, 1.7),
      sway: rand(16, 38),
      swaySpeed: rand(0.45, 1.15),
      phase: rand(0, TAU),
      alpha: rand(0.55, 0.95),
      color: pick(FALL_LEAVES),
      flip: rand(0.45, 1),
    };
  }

  makeSnowflake(spread) {
    const size = rand(1.3, 4.8);
    return {
      kind: 'snow',
      x: rand(0, this.width),
      y: spread ? rand(-this.height * 0.15, this.height) : -size * 2,
      vx: rand(-4, 4),
      vy: rand(10, 27) * (size > 3.8 ? 0.72 : 1),
      size,
      rot: 0,
      vr: 0,
      sway: rand(7, 26),
      swaySpeed: rand(0.25, 0.85),
      phase: rand(0, TAU),
      alpha: rand(0.35, 0.9),
      big: Math.random() > 0.86,
    };
  }

  makeDriftingMote() {
    return {
      kind: 'mote',
      x: rand(0, this.width),
      y: rand(0, this.height),
      size: rand(4, 12),
      phase: rand(0, TAU),
      speed: rand(0.18, 0.5),
      ampX: rand(6, 18),
      ampY: rand(5, 15),
      baseAlpha: rand(0.08, 0.32),
      warm: Math.random() > 0.4,
    };
  }

  start() {
    this.wantsToRun = true;
    if (this.running || this.reducedMotion) {
      if (this.reducedMotion) this.draw(performance.now());
      return;
    }
    if (!this.width || !this.height) this.resize();
    this.running = true;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick.bind(this));
  }

  stop() {
    this.wantsToRun = false;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.update(dt, now / 1000);
    this.draw(now);
    this.raf = requestAnimationFrame(this.tick.bind(this));
  }

  update(dt, time) {
    const w = this.width;
    const h = this.height;
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 2.5);

    for (const p of this.particles) {
      if (p.kind === 'firefly' || p.kind === 'mote') continue;
      p.x += (p.vx + Math.sin(time * p.swaySpeed + p.phase) * p.sway + this.wind * 34) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > h + p.size * 4) {
        p.y = -p.size * 4;
        p.x = rand(0, w);
      }
      if (p.x < -p.size * 3) p.x = w + p.size * 2;
      if (p.x > w + p.size * 3) p.x = -p.size * 2;
    }

    for (const b of this.butterflies) {
      b.x += b.speed * dt;
      b.y = b.baseY + Math.sin(time * 0.7 + b.phase) * 14;
      if (b.x < -20) b.x = w + 20;
      if (b.x > w + 20) b.x = -20;
    }
  }

  draw(now) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    if (!ctx || !w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const time = now / 1000;

    if (this.season === 'summer') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        if (p.kind === 'firefly') {
          const blink = 0.55 + 0.45 * Math.sin(time * p.blink + p.phase);
          const x = p.x + Math.sin(time * p.speed + p.phase) * p.ampX;
          const y = p.y + Math.cos(time * p.speed * 0.8 + p.phase) * p.ampY;
          const size = p.size * (0.75 + blink * 0.5);
          ctx.globalAlpha = p.baseAlpha * blink * 0.85;
          ctx.drawImage(p.warm ? this.glowWarm : this.glowCool, x - size / 2, y - size / 2, size, size);
          ctx.globalAlpha = p.baseAlpha * blink;
          ctx.fillStyle = p.warm ? '#ffe9bd' : '#eaf4fb';
          ctx.beginPath();
          ctx.arc(x, y, Math.max(0.5, size * 0.055), 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        if (p.kind === 'mote') {
          const x = p.x + Math.sin(time * p.speed + p.phase) * p.ampX;
          const y = p.y + Math.cos(time * p.speed * 0.8 + p.phase) * p.ampY;
          ctx.globalAlpha = p.baseAlpha * 0.7;
          ctx.drawImage(p.warm ? this.glowWarm : this.glowCool, x - p.size / 2, y - p.size / 2, p.size, p.size);
        }
      }
      ctx.restore();
      return;
    }

    if (this.season === 'winter') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.particles) {
        const twinkle = 0.7 + 0.3 * Math.sin(time * p.swaySpeed * 2 + p.phase);
        ctx.globalAlpha = p.alpha * twinkle;
        const size = p.size * (p.big ? 2.7 : 2.1);
        ctx.drawImage(this.glowCool, p.x - size / 2, p.y - size / 2, size, size);
        if (p.big) {
          ctx.globalAlpha = p.alpha * twinkle * 0.9;
          ctx.strokeStyle = '#f4fbff';
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          ctx.moveTo(p.x - p.size * 2.1, p.y);
          ctx.lineTo(p.x + p.size * 2.1, p.y);
          ctx.moveTo(p.x, p.y - p.size * 2.1);
          ctx.lineTo(p.x, p.y + p.size * 2.1);
          ctx.moveTo(p.x - p.size * 1.4, p.y - p.size * 1.4);
          ctx.lineTo(p.x + p.size * 1.4, p.y + p.size * 1.4);
          ctx.moveTo(p.x + p.size * 1.4, p.y - p.size * 1.4);
          ctx.lineTo(p.x - p.size * 1.4, p.y + p.size * 1.4);
          ctx.stroke();
        }
      }
      ctx.restore();
      return;
    }

    if (this.season === 'spring') {
      for (const p of this.particles) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, 0.62 + 0.38 * Math.sin(time * p.swaySpeed + p.phase));
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.bezierCurveTo(p.size * 1.15, -p.size * 0.3, p.size * 0.66, p.size * 0.86, 0, p.size);
        ctx.bezierCurveTo(-p.size * 0.66, p.size * 0.86, -p.size * 1.15, -p.size * 0.3, 0, -p.size);
        ctx.fill();
        ctx.restore();
      }
      for (const b of this.butterflies) {
        this.drawButterfly(b, time);
      }
      return;
    }

    // fall: leaves
    for (const p of this.particles) {
      if (p.kind === 'leaf') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(p.flip, 1);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.35, p.size * 0.75, p.size * 0.55, 0, p.size);
        ctx.bezierCurveTo(-p.size * 0.75, p.size * 0.55, -p.size * 0.9, -p.size * 0.35, 0, -p.size);
        ctx.fill();
        ctx.globalAlpha = p.alpha * 0.45;
        ctx.strokeStyle = '#472313';
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        ctx.moveTo(0, -p.size * 0.7);
        ctx.lineTo(0, p.size * 0.75);
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'mote') {
        const x = p.x + Math.sin(time * p.speed + p.phase) * p.ampX;
        const y = p.y + Math.cos(time * p.speed * 0.8 + p.phase) * p.ampY;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.baseAlpha * 0.5;
        ctx.drawImage(this.glowWarm, x - p.size / 2, y - p.size / 2, p.size, p.size);
        ctx.restore();
      }
    }
  }

  drawButterfly(b, time) {
    const ctx = this.ctx;
    const flap = 0.25 + Math.abs(Math.sin(time * b.flap + b.phase)) * 0.75;
    const tilt = Math.sin(time * 0.8 + b.phase) * 0.25;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(tilt);
    ctx.scale(flap, 1);
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.ellipse(-b.size * 0.72, -b.size * 0.28, b.size * 0.82, b.size * 0.46, -0.45, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(b.size * 0.72, -b.size * 0.28, b.size * 0.82, b.size * 0.46, 0.45, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#3f352b';
    ctx.beginPath();
    ctx.ellipse(0, 0, b.size * 0.1, b.size * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
  }
}
