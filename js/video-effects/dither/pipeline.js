window.DitherApp = window.DitherApp || {};

(function() {
  // ── Buffer pool — zero allocations per frame after first call ─────────────
  // Each pool holds all working buffers for a given frame size.
  // Caller creates pools via makePool(); pipeline resizes only on dimension change.

  DitherApp.makePool = function() {
    return { w:0, h:0, wn:0,
             rgba:null, orig:null, luma:null, chan:null,
             prev:null, hasPrev:false,
             out:null, imgData:null };
  };

  function ensurePool(pool, w, h) {
    if (pool.w === w && pool.h === h) return;
    const wn = w * h;
    pool.w  = w; pool.h = h; pool.wn = wn;
    pool.rgba    = new Float32Array(wn * 4);
    pool.orig    = new Float32Array(wn * 4);
    pool.luma    = new Float32Array(wn);
    pool.chan     = new Float32Array(wn);
    pool.out     = new Uint8ClampedArray(wn * 4);
    pool.prev    = new Float32Array(wn * 4);
    pool.hasPrev = false;
    // ImageData shares pool.out's buffer — no copy on putImageData
    pool.imgData = new ImageData(pool.out, w, h);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function applyGamma(buf, gamma) {
    const inv = 1 / gamma;
    for (let i = 0; i < buf.length; i += 4) {
      buf[i]   = Math.pow(buf[i]   / 255, inv) * 255;
      buf[i+1] = Math.pow(buf[i+1] / 255, inv) * 255;
      buf[i+2] = Math.pow(buf[i+2] / 255, inv) * 255;
    }
  }

  function applyColorSpace(rgba, cs) {
    if (cs === 'yuv') {
      for (let i = 0; i < rgba.length; i += 4) {
        const r = rgba[i], g = rgba[i+1], b = rgba[i+2];
        const y =  0.299*r + 0.587*g + 0.114*b;
        const u = -0.147*r - 0.289*g + 0.436*b + 128;
        const v =  0.615*r - 0.515*g - 0.100*b + 128;
        rgba[i]   = y < 0 ? 0 : y > 255 ? 255 : y;
        rgba[i+1] = u < 0 ? 0 : u > 255 ? 255 : u;
        rgba[i+2] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  function getEffectivePalette(state) {
    const raw = DitherApp.PALETTES[state.palette];
    if (!raw) return null;
    if (state.palette === 'web-safe') return raw.slice(0, Math.max(2, Math.min(216, state.paletteSize)));
    return raw;
  }

  // ── Main entry ─────────────────────────────────────────────────────────────
  // Returns pool.imgData (backed by pool.out) — callers must not hold references
  // across frames since pool.out is overwritten each call.

  DitherApp.processFrame = function(srcImgData, state, eng, pool) {
    const { width:w, height:h, data:src } = srcImgData;
    ensurePool(pool, w, h);

    const { rgba, orig, luma, chan, out, prev } = pool;
    const wn = pool.wn;

    // ── Load source into float buffer ────────────────────────────────────────
    for (let i = 0; i < src.length; i++) rgba[i] = src[i];
    orig.set(rgba);  // save for wet/dry blend

    // ── Pre-dither gamma ─────────────────────────────────────────────────────
    if (state.preGamma !== 1.0) applyGamma(rgba, state.preGamma);

    // ── Dither ───────────────────────────────────────────────────────────────
    const palette = getEffectivePalette(state);
    const seed    = eng.noiseSeed;

    if (palette) {
      DitherApp.Algo.dispatchRGB(rgba, w, h, palette, state);

    } else if (state.applyMode === 'luminance') {
      // Compute original luma
      for (let i = 0; i < wn; i++) {
        const j = i << 2;
        luma[i] = 0.299*rgba[j] + 0.587*rgba[j+1] + 0.114*rgba[j+2];
      }
      // Copy luma to scratch and dither in-place
      chan.set(luma);
      DitherApp.Algo.dispatch(chan, w, h, state.bitDepth, state, luma, seed);
      // Reconstruct RGB — scale each channel proportionally
      for (let i = 0; i < wn; i++) {
        const j = i << 2;
        const origL = luma[i];
        const newL  = chan[i] < 0 ? 0 : chan[i] > 255 ? 255 : chan[i];
        if (origL > 1) {
          const s = newL / origL;
          let v;
          v = rgba[j]   * s; rgba[j]   = v > 255 ? 255 : v < 0 ? 0 : v;
          v = rgba[j+1] * s; rgba[j+1] = v > 255 ? 255 : v < 0 ? 0 : v;
          v = rgba[j+2] * s; rgba[j+2] = v > 255 ? 255 : v < 0 ? 0 : v;
        } else {
          rgba[j] = rgba[j+1] = rgba[j+2] = newL;
        }
      }

    } else {
      // Per-channel — compute luma once for intensity weighting
      for (let i = 0; i < wn; i++) {
        const j = i << 2;
        luma[i] = 0.299*rgba[j] + 0.587*rgba[j+1] + 0.114*rgba[j+2];
      }
      const bits = [state.bitDepthR, state.bitDepthG, state.bitDepthB];
      for (let ch = 0; ch < 3; ch++) {
        for (let i = 0; i < wn; i++) chan[i] = rgba[(i<<2)+ch];
        DitherApp.Algo.dispatch(chan, w, h, bits[ch], state, luma, seed + ch * 1.7);
        for (let i = 0; i < wn; i++) rgba[(i<<2)+ch] = chan[i];
      }
    }

    // ── Wet/dry blend ────────────────────────────────────────────────────────
    const mix = state.wetDryMix;
    if (mix < 1.0) {
      const inv = 1 - mix;
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i]   = orig[i]   * inv + rgba[i]   * mix;
        rgba[i+1] = orig[i+1] * inv + rgba[i+1] * mix;
        rgba[i+2] = orig[i+2] * inv + rgba[i+2] * mix;
      }
    }

    // ── Post-dither gamma ────────────────────────────────────────────────────
    if (state.postGamma !== 1.0) applyGamma(rgba, state.postGamma);

    // ── Color space ──────────────────────────────────────────────────────────
    if (state.colorSpace !== 'rgb') applyColorSpace(rgba, state.colorSpace);

    // ── Frame blending ───────────────────────────────────────────────────────
    if (state.frameBlending > 0 && pool.hasPrev) {
      const blend = state.frameBlending, inv = 1 - blend;
      for (let i = 0; i < rgba.length; i += 4) {
        rgba[i]   = prev[i]   * blend + rgba[i]   * inv;
        rgba[i+1] = prev[i+1] * blend + rgba[i+1] * inv;
        rgba[i+2] = prev[i+2] * blend + rgba[i+2] * inv;
      }
    }
    prev.set(rgba);
    pool.hasPrev = true;

    // ── Write output (clamp + copy alpha from source) ────────────────────────
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i], g = rgba[i+1], b = rgba[i+2];
      out[i]   = r   < 0 ? 0 : r   > 255 ? 255 : (r   | 0);
      out[i+1] = g   < 0 ? 0 : g   > 255 ? 255 : (g   | 0);
      out[i+2] = b   < 0 ? 0 : b   > 255 ? 255 : (b   | 0);
      out[i+3] = src[i+3];
    }

    return pool.imgData; // shared reference — no ImageData allocation
  };
})();
