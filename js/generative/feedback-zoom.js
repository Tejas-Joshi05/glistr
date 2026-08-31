/* ══ Feedback Zoom ════════════════════════════════════════════════════════
   Video feedback without a camera: each frame redraws the previous frame
   slightly scaled and rotated, then stamps a fresh shape on top. The trails
   are the history of the shape falling into (or out of) the centre.

   One drawImage per frame carries all the history, so this is cheap no
   matter how deep the tunnel looks.                                         */

(function () {
  'use strict';

  const G = window.Generative;

  Generative.create({
    name:  'gen-feedback',
    title: 'Feedback Zoom',
    hint:  'Click to move the feedback centre',

    audioSuggest: [
      { key: 'zoom',      band: 'beat', amount: 0.35 },
      { key: 'stampSize', band: 'bass', amount: 0.4 },
      { key: 'rotate',    band: 'mid',  amount: 0.25 },
    ],

    defaults: {
      zoom:       1.024,
      rotate:     0.6,
      decay:      0.055,
      hueShift:   0,
      stamp:      'ring',
      stampSize:  0.18,
      stampWidth: 6,
      pulse:      1,
      spinStamp:  0.5,
      mirror:     'none',
      palette:    'violet',
      background: '#04040a',
      cycle:      0.25,
    },

    sections: [
      {
        title: 'FEEDBACK',
        specs: [
          { key: 'zoom', label: 'Zoom Per Frame', type: 'slider',
            min: 0.97, max: 1.06, step: 0.001,
            fmt: v => v > 1.0005 ? 'In ' + ((v - 1) * 100).toFixed(1) + '%'
                    : v < 0.9995 ? 'Out ' + ((1 - v) * 100).toFixed(1) + '%' : 'Hold' },
          { key: 'rotate', label: 'Rotation Per Frame', type: 'slider',
            min: -6, max: 6, step: 0.05, fmt: v => v.toFixed(2) + '°' },
          { key: 'decay', label: 'Trail Fade', type: 'slider',
            min: 0, max: 0.35, step: 0.005,
            fmt: v => v < 0.005 ? 'Infinite' : Math.round(v * 100) + '%' },
          { key: 'mirror', label: 'Mirror', type: 'select',
            options: [
              { value: 'none', label: 'Off' },
              { value: 'x',    label: 'Horizontal' },
              { value: 'y',    label: 'Vertical' },
              { value: 'quad', label: 'Quad' },
            ] },
        ],
      },
      {
        title: 'STAMP',
        specs: [
          { key: 'stamp', label: 'Shape', type: 'select',
            options: [
              { value: 'ring',    label: 'Ring' },
              { value: 'bar',     label: 'Bar' },
              { value: 'cross',   label: 'Cross' },
              { value: 'tri',     label: 'Triangle' },
              { value: 'dots',    label: 'Dot Ring' },
              { value: 'none',    label: 'Nothing' },
            ] },
          { key: 'stampSize', label: 'Size', type: 'slider',
            min: 0.02, max: 0.6, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
          { key: 'stampWidth', label: 'Line Weight', type: 'slider',
            min: 1, max: 40, step: 0.5, fmt: v => v.toFixed(1) + 'px' },
          { key: 'spinStamp', label: 'Stamp Spin', type: 'slider',
            min: -3, max: 3, step: 0.01, fmt: v => v.toFixed(2) },
          { key: 'pulse', label: 'Pulse', type: 'slider',
            min: 0, max: 3, step: 0.01,
            fmt: v => v < 0.03 ? 'Steady' : v.toFixed(2),
            hint: 'Breathes the stamp size over time' },
        ],
      },
      {
        title: 'COLOR',
        specs: [
          { key: 'palette', label: 'Palette', type: 'select',
            options: G.PALETTE_OPTIONS },
          { key: 'cycle', label: 'Color Cycle', type: 'slider',
            min: 0, max: 2, step: 0.01,
            fmt: v => v < 0.02 ? 'Fixed' : v.toFixed(2) },
          { key: 'background', label: 'Background', type: 'color' },
        ],
      },
    ],

    setup: function (env) {
      env.buf     = document.createElement('canvas');
      env.buf.width = env.w; env.buf.height = env.h;
      env.bufCtx  = env.buf.getContext('2d');
      env.bufCtx.fillStyle = env.state.background;
      env.bufCtx.fillRect(0, 0, env.w, env.h);
      env.cx = 0.5; env.cy = 0.5;
    },

    pointer: function (env, x, y) {
      env.cx = x / env.w;
      env.cy = y / env.h;
    },

    draw: function (env, dt) {
      const s   = env.state;
      const ctx = env.ctx;
      const w   = env.w, h = env.h;
      const bc  = env.bufCtx;
      const cx  = w * env.cx, cy = h * env.cy;

      // ── Re-draw the previous frame, transformed ────────────────────────
      bc.save();
      bc.translate(cx, cy);
      bc.rotate(s.rotate * Math.PI / 180);
      bc.scale(s.zoom, s.zoom);
      bc.translate(-cx, -cy);
      bc.drawImage(env.buf, 0, 0);
      bc.restore();

      // ── Fade toward the background ─────────────────────────────────────
      if (s.decay > 0.005) {
        bc.globalAlpha = s.decay;
        bc.fillStyle   = s.background;
        bc.fillRect(0, 0, w, h);
        bc.globalAlpha = 1;
      }

      // ── Stamp ──────────────────────────────────────────────────────────
      if (s.stamp !== 'none') {
        const stops = G.PALETTES[s.palette] || G.PALETTES.violet;
        const t     = s.cycle > 0.02 ? (env.time * s.cycle) % 1 : 0.8;
        const c     = G.rampAt(stops, 0.3 + t * 0.7);
        const pulse = 1 + Math.sin(env.time * 3.1) * 0.25 * s.pulse;
        const size  = Math.min(w, h) * s.stampSize * pulse;

        bc.save();
        bc.translate(cx, cy);
        bc.rotate(env.time * s.spinStamp);
        bc.strokeStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        bc.fillStyle   = bc.strokeStyle;
        bc.lineWidth   = s.stampWidth;
        bc.lineJoin    = 'round';
        drawStamp(bc, s.stamp, size, env.time);
        bc.restore();
      }

      // ── Present, with optional mirroring ───────────────────────────────
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(env.buf, 0, 0);

      if (s.mirror !== 'none') {
        ctx.save();
        if (s.mirror === 'x' || s.mirror === 'quad') {
          ctx.setTransform(-1, 0, 0, 1, w, 0);
          ctx.drawImage(env.buf, 0, 0, w / 2, h, 0, 0, w / 2, h);
        }
        if (s.mirror === 'y' || s.mirror === 'quad') {
          ctx.setTransform(1, 0, 0, -1, 0, h);
          ctx.drawImage(env.buf, 0, 0, w, h / 2, 0, 0, w, h / 2);
        }
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    },
  });

  function drawStamp(c, kind, size, time) {
    switch (kind) {
      case 'bar':
        c.fillRect(-size, -size * 0.09, size * 2, size * 0.18);
        break;

      case 'cross':
        c.beginPath();
        c.moveTo(-size, 0); c.lineTo(size, 0);
        c.moveTo(0, -size); c.lineTo(0, size);
        c.stroke();
        break;

      case 'tri': {
        c.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
          const x = Math.cos(a) * size, y = Math.sin(a) * size;
          if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
        }
        c.closePath();
        c.stroke();
        break;
      }

      case 'dots': {
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + time * 0.4;
          c.beginPath();
          c.arc(Math.cos(a) * size, Math.sin(a) * size, c.lineWidth * 0.9, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }

      default:  // ring
        c.beginPath();
        c.arc(0, 0, size, 0, Math.PI * 2);
        c.stroke();
    }
  }
})();
