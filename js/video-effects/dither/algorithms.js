window.DitherApp = window.DitherApp || {};

// ── Flat Bayer matrices (Int32Array — cache-friendly, one indirection) ─────
(function() {
  function build2D(n) {
    if (n === 1) return [[0]];
    const half = build2D(n >> 1), h = n >> 1;
    const m = Array.from({ length: n }, () => new Array(n));
    for (let r = 0; r < h; r++)
      for (let c = 0; c < h; c++) {
        const v = half[r][c] * 4;
        m[r][c] = v;       m[r][c+h] = v+2;
        m[r+h][c] = v+3;   m[r+h][c+h] = v+1;
      }
    return m;
  }
  function buildFlat(n) {
    const m = build2D(n), flat = new Int32Array(n * n);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) flat[r*n+c] = m[r][c];
    return flat;
  }
  DitherApp._BAYER = { 2: buildFlat(2), 4: buildFlat(4), 8: buildFlat(8), 16: buildFlat(16) };
})();

// ── Palette definitions ────────────────────────────────────────────────────
DitherApp.PALETTES = {
  monochrome: null,
  'green-2bit': [[15,56,15],[48,98,48],[139,172,15],[155,188,15]],
  cga: [
    [0,0,0],[0,0,170],[0,170,0],[0,170,170],
    [170,0,0],[170,0,170],[170,85,0],[170,170,170],
    [85,85,85],[85,85,255],[85,255,85],[85,255,255],
    [255,85,85],[255,85,255],[255,255,85],[255,255,255],
  ],
  'web-safe': (function() {
    const p = [];
    for (let r = 0; r <= 5; r++)
      for (let g = 0; g <= 5; g++)
        for (let b = 0; b <= 5; b++) p.push([r*51,g*51,b*51]);
    return p;
  })(),
  custom: null,
};

// ── Hot helpers (inlined in loops via closure, not per-pixel calls) ─────────

// Quantize value to nearest level. step=255/(levels-1), invStep=(levels-1)/255
function qv(v, step, invStep) {
  const c = v < 0 ? 0 : v > 255 ? 255 : v;
  return ((c * invStep + 0.5) | 0) * step;
}

// Intensity factor based on luminance zone
function intf(lum, si, mi, hi) {
  return lum < 85 ? si : lum <= 170 ? mi : hi;
}

// Fast sin-based hash → [0,1)
function sinHash(x, y, seed) {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.9) * 43758.5453;
  return v - (v | 0);
}

// Nearest palette color — returns index
function nearestRGB(r, g, b, palette) {
  let bi = 0, best = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (r-p[0])*(r-p[0]) + (g-p[1])*(g-p[1]) + (b-p[2])*(b-p[2]);
    if (d < best) { best = d; bi = i; }
  }
  return palette[bi];
}

// ── Single-channel algorithms (all in-place on Float32Array 'buf') ─────────
// Caller is responsible for:
//   - Bayer/random: buf already contains input values (written in place)
//   - Error diffusion: buf already contains input values (modified in place, errors accumulate)
// origLuma: Float32Array of original pixel luminance for intensity weighting

DitherApp.Algo = {};

DitherApp.Algo.bayer = function(buf, w, h, bitDepth, state, origLuma) {
  const { bayerMatrixSize:n, patternScale:sc, anisotropyX:ax, anisotropyY:ay,
          threshold:bias, shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  const mat = DitherApp._BAYER[n], n2 = n * n;
  const levels = 1 << bitDepth;
  const step = 255 / (levels - 1), invStep = (levels - 1) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i  = y * w + x;
      const bx = ((Math.floor(x / sc * ax) % n) + n) % n;
      const by = ((Math.floor(y / sc * ay) % n) + n) % n;
      const t  = (mat[by * n + bx] + 0.5) / n2;
      const lum = origLuma ? origLuma[i] : buf[i];
      buf[i] = qv(buf[i] + (t - 0.5) * step * intf(lum, si, mi, hi) + bias, step, invStep);
    }
  }
};

DitherApp.Algo.floydSteinberg = function(buf, w, h, bitDepth, state, origLuma) {
  const { errorDiffusionStrength:str,
          shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  const levels = 1 << bitDepth;
  const step = 255 / (levels-1), invStep = (levels-1) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i], neu = qv(old, step, invStep);
      buf[i] = neu;
      const lum = origLuma ? origLuma[i] : old;
      const e = (old - neu) * str * intf(lum, si, mi, hi);
      if (x+1 < w)           buf[i+1]         += e * 0.4375;
      if (y+1 < h) {
        if (x-1 >= 0)         buf[(y+1)*w+x-1] += e * 0.1875;
                              buf[(y+1)*w+x]    += e * 0.3125;
        if (x+1 < w)          buf[(y+1)*w+x+1] += e * 0.0625;
      }
    }
  }
};

DitherApp.Algo.atkinson = function(buf, w, h, bitDepth, state, origLuma) {
  const { errorDiffusionStrength:str,
          shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  const levels = 1 << bitDepth;
  const step = 255 / (levels-1), invStep = (levels-1) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i], neu = qv(old, step, invStep);
      buf[i] = neu;
      const lum = origLuma ? origLuma[i] : old;
      const e = (old - neu) * str * intf(lum, si, mi, hi) * 0.125;
      if (x+1 < w)           buf[i+1]           += e;
      if (x+2 < w)           buf[i+2]           += e;
      if (y+1 < h) {
        if (x-1 >= 0)         buf[(y+1)*w+x-1]   += e;
                              buf[(y+1)*w+x]      += e;
        if (x+1 < w)          buf[(y+1)*w+x+1]   += e;
      }
      if (y+2 < h)            buf[(y+2)*w+x]     += e;
    }
  }
};

DitherApp.Algo.jjn = function(buf, w, h, bitDepth, state, origLuma) {
  const { errorDiffusionStrength:str,
          shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  const levels = 1 << bitDepth;
  const step = 255 / (levels-1), invStep = (levels-1) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = buf[i], neu = qv(old, step, invStep);
      buf[i] = neu;
      const lum = origLuma ? origLuma[i] : old;
      const e = (old - neu) * str * intf(lum, si, mi, hi) / 48;
      if (x+1 < w)            buf[i+1]            += e * 7;
      if (x+2 < w)            buf[i+2]            += e * 5;
      if (y+1 < h) {
        const r1 = (y+1)*w;
        if (x-2 >= 0)          buf[r1+x-2]         += e * 3;
        if (x-1 >= 0)          buf[r1+x-1]         += e * 5;
                               buf[r1+x]            += e * 7;
        if (x+1 < w)           buf[r1+x+1]         += e * 5;
        if (x+2 < w)           buf[r1+x+2]         += e * 3;
      }
      if (y+2 < h) {
        const r2 = (y+2)*w;
        if (x-2 >= 0)          buf[r2+x-2]         += e;
        if (x-1 >= 0)          buf[r2+x-1]         += e * 3;
                               buf[r2+x]            += e * 5;
        if (x+1 < w)           buf[r2+x+1]         += e * 3;
        if (x+2 < w)           buf[r2+x+2]         += e;
      }
    }
  }
};

DitherApp.Algo.random = function(buf, w, h, bitDepth, state, origLuma, seed) {
  const { patternScale:sc, shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  const levels = 1 << bitDepth;
  const step = 255 / (levels-1), invStep = (levels-1) / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const lum = origLuma ? origLuma[i] : buf[i];
      buf[i] = qv(buf[i] + (sinHash(x, y, seed) - 0.5) * step * sc * intf(lum, si, mi, hi), step, invStep);
    }
  }
};

// ── RGB palette algorithms (modify rgba Float32Array in-place) ─────────────

DitherApp.Algo.fsRGB = function(rgba, w, h, palette, state) {
  const { errorDiffusionStrength:str, shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const nr = rgba[i], ng = rgba[i+1], nb = rgba[i+2];
      const [qr, qg, qb] = nearestRGB(nr, ng, nb, palette);
      const lum = 0.299*nr + 0.587*ng + 0.114*nb;
      const f = str * intf(lum, si, mi, hi);
      const er = (nr-qr)*f, eg = (ng-qg)*f, eb = (nb-qb)*f;
      rgba[i] = qr; rgba[i+1] = qg; rgba[i+2] = qb;
      function add(xi, yi, w16) {
        if (xi < 0 || xi >= w || yi >= h) return;
        const j = (yi*w+xi)*4;
        rgba[j]+=er*w16; rgba[j+1]+=eg*w16; rgba[j+2]+=eb*w16;
      }
      add(x+1,y,0.4375); add(x-1,y+1,0.1875); add(x,y+1,0.3125); add(x+1,y+1,0.0625);
    }
  }
};

DitherApp.Algo.bayerRGB = function(rgba, w, h, palette, state) {
  const { bayerMatrixSize:n, patternScale:sc, anisotropyX:ax, anisotropyY:ay,
          shadowIntensity:si, midtoneIntensity:mi, highlightIntensity:hi } = state;
  const mat = DitherApp._BAYER[n], n2 = n*n, spread = 40;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y*w+x)*4;
      const bx = ((Math.floor(x/sc*ax) % n) + n) % n;
      const by = ((Math.floor(y/sc*ay) % n) + n) % n;
      const t  = (mat[by*n+bx]+0.5)/n2 - 0.5;
      const lum = 0.299*rgba[i] + 0.587*rgba[i+1] + 0.114*rgba[i+2];
      const off = t * spread * intf(lum, si, mi, hi);
      const [qr,qg,qb] = nearestRGB(rgba[i]+off, rgba[i+1]+off, rgba[i+2]+off, palette);
      rgba[i]=qr; rgba[i+1]=qg; rgba[i+2]=qb;
    }
  }
};

// ── Dispatch ───────────────────────────────────────────────────────────────
DitherApp.Algo.dispatch = function(buf, w, h, bitDepth, state, origLuma, seed) {
  switch (state.algorithm) {
    case 'bayer':               DitherApp.Algo.bayer(buf, w, h, bitDepth, state, origLuma); break;
    case 'floyd-steinberg':     DitherApp.Algo.floydSteinberg(buf, w, h, bitDepth, state, origLuma); break;
    case 'atkinson':            DitherApp.Algo.atkinson(buf, w, h, bitDepth, state, origLuma); break;
    case 'jarvis-judice-ninke': DitherApp.Algo.jjn(buf, w, h, bitDepth, state, origLuma); break;
    case 'random':              DitherApp.Algo.random(buf, w, h, bitDepth, state, origLuma, seed); break;
  }
};

DitherApp.Algo.dispatchRGB = function(rgba, w, h, palette, state) {
  if (state.algorithm === 'bayer') DitherApp.Algo.bayerRGB(rgba, w, h, palette, state);
  else                             DitherApp.Algo.fsRGB(rgba, w, h, palette, state);
};
