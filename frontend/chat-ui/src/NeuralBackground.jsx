import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 75;
const CONNECTION_DISTANCE = 130;
const SPEED = 0.3;
const REPEL_RADIUS = 100;
const REPEL_FORCE  = 1.8;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

export default function NeuralBackground() {
  const canvasRef = useRef(null);
  const mouse     = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animId;
    let lastTime = 0;
    const FPS_CAP = 60;
    const FRAME_MIN = 1000 / FPS_CAP;

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const onMouseMove = (e) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
    };
    window.addEventListener("mousemove", onMouseMove);

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x:    rand(0, window.innerWidth),
      y:    rand(0, window.innerHeight),
      vx:   rand(-SPEED, SPEED),
      vy:   rand(-SPEED, SPEED),
      radius: rand(1, 2.2),
      isCyan: Math.random() > 0.4,
    }));

    let frame = 0;

    const draw = (timestamp) => {
      animId = requestAnimationFrame(draw);
      if (timestamp - lastTime < FRAME_MIN) return;
      lastTime = timestamp;
      frame++;

      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Background
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.75);
      bg.addColorStop(0, "#080818");
      bg.addColorStop(0.6, "#050510");
      bg.addColorStop(1, "#020208");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Ambient orbs
      const t = frame * 0.003;
      const orbs = [
        { cx: w * (0.15 + 0.08 * Math.sin(t)),       cy: h * (0.25 + 0.06 * Math.cos(t * 0.7)),   r: 320, color: "0, 130, 220",   a: 0.10 },
        { cx: w * (0.82 + 0.07 * Math.cos(t * 0.8)), cy: h * (0.72 + 0.08 * Math.sin(t * 0.6)),   r: 380, color: "130, 40, 220",  a: 0.09 },
        { cx: w * (0.5  + 0.05 * Math.sin(t * 1.2)), cy: h * (0.1  + 0.04 * Math.cos(t)),         r: 250, color: "0, 212, 255",   a: 0.06 },
        { cx: w * (0.3  + 0.06 * Math.cos(t * 0.5)), cy: h * (0.8  + 0.05 * Math.sin(t * 0.9)),   r: 300, color: "80, 0, 200",    a: 0.05 },
      ];
      orbs.forEach(({ cx, cy, r, color, a }) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${color}, ${a})`);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      });

      // Particles
      const mx = mouse.current.x;
      const my = mouse.current.y;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Mouse repulsion
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < REPEL_RADIUS && dist > 0) {
          const force = (1 - dist / REPEL_RADIUS) * REPEL_FORCE;
          p.vx += (dx / dist) * force * 0.04;
          p.vy += (dy / dist) * force * 0.04;
        }

        // Dampen velocity to prevent runaway
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > SPEED * 3) {
          p.vx = (p.vx / speed) * SPEED * 3;
          p.vy = (p.vy / speed) * SPEED * 3;
        }

        p.x += p.vx;
        p.y += p.vy;

        // Bounce off walls
        if (p.x < 0)  { p.x = 0;  p.vx *= -1; }
        if (p.x > w)  { p.x = w;  p.vx *= -1; }
        if (p.y < 0)  { p.y = 0;  p.vy *= -1; }
        if (p.y > h)  { p.y = h;  p.vy *= -1; }

        // Connections
        for (let j = i + 1; j < particles.length; j++) {
          const p2  = particles[j];
          const ddx = p.x - p2.x;
          const ddy = p.y - p2.y;
          const d   = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < CONNECTION_DISTANCE) {
            const alpha = (1 - d / CONNECTION_DISTANCE) * 0.22;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(0, 190, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        // Glow halo
        const cr   = p.isCyan ? "0, 212, 255" : "168, 85, 247";
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 5);
        glow.addColorStop(0, `rgba(${cr}, 0.35)`);
        glow.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 5, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.isCyan ? "#00d4ff" : "#a855f7";
        ctx.fill();
      }
    };

    draw(0);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
