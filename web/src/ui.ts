// Small DOM helpers shared by the screens: element lookup, animations, confetti.

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id} in index.html`);
  return found as T;
}

/** True when the system asks for less motion; animations then jump to the end. */
export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Calls frame(t) with t going from 0 to 1 over `ms` milliseconds (eased). */
export function animate(ms: number, frame: (t: number) => void): Promise<void> {
  if (reducedMotion() || ms <= 0) {
    frame(1);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const linear = Math.min(1, (now - start) / ms);
      frame(1 - (1 - linear) ** 3); // ease-out
      if (linear < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

/** Counts a number up in an element, e.g. 0 → 788. */
export function countUp(node: HTMLElement, to: number, ms = 900): Promise<void> {
  return animate(ms, (t) => {
    node.textContent = formatNumber(to * t);
  });
}

/** A short burst of confetti over `host` (which should be position: relative). */
export function confetti(host: HTMLElement): void {
  if (reducedMotion()) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  const rect = host.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const colors = ["#FFD23F", "#00D5FF", "#FF4FA0", "#7C5CFF", "#2EE59D"];
  const pieces = Array.from({ length: 90 }, () => ({
    x: canvas.width / 2,
    y: canvas.height * 0.45,
    vx: (Math.random() - 0.5) * 18 * devicePixelRatio,
    vy: (-Math.random() * 16 - 4) * devicePixelRatio,
    size: (4 + Math.random() * 6) * devicePixelRatio,
    spin: Math.random() * Math.PI,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  void animate(1400, (t) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of pieces) {
      p.vy += 0.6 * devicePixelRatio;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += 0.2;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }).then(() => canvas.remove());
}
