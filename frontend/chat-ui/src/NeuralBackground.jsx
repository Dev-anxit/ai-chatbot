import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 85;
const CONNECTION_DISTANCE = 140;
const SPEED = 0.35;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

export default function NeuralBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animId;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: rand(0, window.innerWidth),
      y: rand(0, window.innerHeight),
      vx: rand(-SPEED, SPEED),
      vy: rand(-SPEED, SPEED),
      radius: rand(1, 2.2),
      isCyan: Math.random() > 0.4,
    }));

    let frame = 0;

    const draw = () => {
      frame++;
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Deep space background
      const bg = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.75);
      bg.addColorStop(0, "#080818");
      bg.addColorStop(0.6, "#050510");
      bg.addColorStop(1, "#020208");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Slow-moving ambient orbs
      const t = frame * 0.003;
      const orb1x = w * (0.15 + 0.08 * Math.sin(t));
      const orb1y = h * (0.25 + 0.06 * Math.cos(t * 0.7));
      const g1 = ctx.createRadialGradient(orb1x, orb1y, 0, orb1x, orb1y, 320);
      g1.addColorStop(0, "rgba(0, 130, 220, 0.1)");
      g1.addColorStop(1, "transparent");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);

      const orb2x = w * (0.82 + 0.07 * Math.cos(t * 0.8));
      const orb2y = h * (0.72 + 0.08 * Math.sin(t * 0.6));
      const g2 = ctx.createRadialGradient(orb2x, orb2y, 0, orb2x, orb2y, 380);
      g2.addColorStop(0, "rgba(130, 40, 220, 0.09)");
      g2.addColorStop(1, "transparent");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);

      const orb3x = w * (0.5 + 0.05 * Math.sin(t * 1.2));
      const orb3y = h * (0.1 + 0.04 * Math.cos(t));
      const g3 = ctx.createRadialGradient(orb3x, orb3y, 0, orb3x, orb3y, 250);
      g3.addColorStop(0, "rgba(0, 212, 255, 0.06)");
      g3.addColorStop(1, "transparent");
      ctx.fillStyle = g3;
      ctx.fillRect(0, 0, w, h);

      // Update and draw particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) { p.x = 0; p.vx *= -1; }
        if (p.x > w) { p.x = w; p.vx *= -1; }
        if (p.y < 0) { p.y = 0; p.vy *= -1; }
        if (p.y > h) { p.y = h; p.vy *= -1; }

        // Connections
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DISTANCE) {
            const alpha = (1 - dist / CONNECTION_DISTANCE) * 0.22;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(0, 190, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }

        // Particle glow
        const cr = p.isCyan ? "0, 212, 255" : "168, 85, 247";
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 5);
        glow.addColorStop(0, `rgba(${cr}, 0.35)`);
        glow.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius * 5, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Particle core
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.isCyan ? "#00d4ff" : "#a855f7";
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
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
