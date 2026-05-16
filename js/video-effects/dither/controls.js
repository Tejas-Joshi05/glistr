window.DitherApp = window.DitherApp || {};

(function() {
  // ── Control spec ──────────────────────────────────────────────────────────
  // `warn` marks danger zones — values inside the range are shown with a clay
  // tint on the slider track + value chip to flag "you're pushing it too far".
  //   warn: { above: N }            — danger when v ≥ N
  //   warn: { below: N }            — danger when v ≤ N
  //   warn: { below: A, above: B }  — danger at both ends
  const SECTIONS = [
    {
      id: 'source-color', title: 'SOURCE & COLOR',
      controls: [
        { key: 'bitDepth',    label: 'Bit Depth',    type: 'slider', min: 1, max: 8, step: 1,
          fmt: v => String(Math.round(v)), warn: { below: 2 } },
        { key: 'palette',     label: 'Palette',      type: 'select',
          options: [['monochrome','Monochrome'],['green-2bit','2-bit Green'],
                    ['cga','CGA'],['web-safe','Web-safe'],['custom','Custom']] },
        { key: 'paletteSize', label: 'Palette Size', type: 'slider', min: 2, max: 256, step: 1,
          fmt: v => String(Math.round(v)), warn: { below: 4 } },
      ],
    },
    {
      id: 'algorithm', title: 'DITHER ALGORITHM',
      controls: [
        { key: 'algorithm', label: 'Algorithm', type: 'select',
          options: [['floyd-steinberg','Floyd-Steinberg'],['bayer','Bayer'],
                    ['atkinson','Atkinson'],['jarvis-judice-ninke','Jarvis-Judice-Ninke'],
                    ['random','Random / Noise']] },
        { key: 'errorDiffusionStrength', label: 'Error Diffusion Strength',
          type: 'slider', min: 0, max: 1, step: 0.01, fmt: v => pct(v),
          warn: { above: 0.95 } },
        { key: 'bayerMatrixSize', label: 'Bayer Matrix Size', type: 'select',
          visible: s => s.algorithm === 'bayer',
          options: [['2','2×2'],['4','4×4'],['8','8×8'],['16','16×16']],
          parseVal: v => parseInt(v) },
      ],
    },
    {
      id: 'spatial', title: 'SPATIAL',
      controls: [
        { key: 'threshold',    label: 'Threshold / Bias', type: 'slider',
          min: -128, max: 128, step: 1, fmt: v => String(Math.round(v)),
          warn: { below: -80, above: 80 } },
        { key: 'patternScale', label: 'Pattern Scale',    type: 'slider',
          min: 0.25, max: 8, step: 0.25, fmt: v => v.toFixed(2) + '×',
          warn: { above: 5 } },
        { key: 'anisotropyX', label: 'Anisotropy X',     type: 'slider',
          min: 0.1, max: 4, step: 0.1, fmt: v => v.toFixed(1),
          warn: { below: 0.4, above: 3 } },
        { key: 'anisotropyY', label: 'Anisotropy Y',     type: 'slider',
          min: 0.1, max: 4, step: 0.1, fmt: v => v.toFixed(1),
          warn: { below: 0.4, above: 3 } },
      ],
    },
    {
      id: 'temporal', title: 'TEMPORAL',
      controls: [
        { key: 'temporalStability', label: 'Temporal Stability', type: 'slider',
          min: 0, max: 1, step: 0.01, fmt: v => pct(v),
          warn: { above: 0.9 } },
        { key: 'frameBlending',    label: 'Frame Blending',    type: 'slider',
          min: 0, max: 1, step: 0.01, fmt: v => pct(v),
          warn: { above: 0.75 } },
        { key: 'noiseSeedSpeed',   label: 'Noise Seed Speed',  type: 'slider',
          min: 0, max: 10, step: 0.1, fmt: v => v.toFixed(1),
          warn: { above: 7 } },
        { key: 'refreshRate', label: 'Pattern Refresh', type: 'select',
          options: [['1','Every frame'],['2','Every 2'],['4','Every 4'],['8','Every 8'],['0','Static']],
          parseVal: v => parseInt(v) },
      ],
    },
    {
      id: 'channel', title: 'LUMINANCE / CHANNEL',
      controls: [
        { key: 'applyMode', label: 'Apply Mode', type: 'toggle',
          options: [['luminance','Luminance Only'],['per-channel','Per Channel']] },
        { key: 'bitDepthR', label: 'Red Bit Depth',   type: 'slider', min: 1, max: 8, step: 1,
          fmt: v => String(Math.round(v)), visible: s => s.applyMode === 'per-channel',
          warn: { below: 2 } },
        { key: 'bitDepthG', label: 'Green Bit Depth', type: 'slider', min: 1, max: 8, step: 1,
          fmt: v => String(Math.round(v)), visible: s => s.applyMode === 'per-channel',
          warn: { below: 2 } },
        { key: 'bitDepthB', label: 'Blue Bit Depth',  type: 'slider', min: 1, max: 8, step: 1,
          fmt: v => String(Math.round(v)), visible: s => s.applyMode === 'per-channel',
          warn: { below: 2 } },
        { key: 'shadowIntensity',    label: 'Shadow Intensity',    type: 'slider',
          min: 0, max: 1, step: 0.01, fmt: v => pct(v) },
        { key: 'midtoneIntensity',   label: 'Midtone Intensity',   type: 'slider',
          min: 0, max: 1, step: 0.01, fmt: v => pct(v) },
        { key: 'highlightIntensity', label: 'Highlight Intensity', type: 'slider',
          min: 0, max: 1, step: 0.01, fmt: v => pct(v) },
      ],
    },
    {
      id: 'blend-output', title: 'BLEND & OUTPUT',
      controls: [
        { key: 'wetDryMix',   label: 'Wet / Dry Mix',   type: 'slider',
          min: 0, max: 1, step: 0.01, fmt: v => pct(v) },
        { key: 'preGamma',    label: 'Pre-Dither Gamma', type: 'slider',
          min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2),
          warn: { below: 0.5, above: 2.4 } },
        { key: 'postGamma',   label: 'Post-Dither Gamma',type: 'slider',
          min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2),
          warn: { below: 0.5, above: 2.4 } },
        { key: 'colorSpace',  label: 'Output Color Space', type: 'select',
          options: [['rgb','RGB'],['yuv','YUV'],['indexed','Indexed']] },
        { key: 'downscale',   label: 'Resolution Downscale', type: 'select',
          options: [['1','1× (none)'],['2','2×'],['4','4×'],['8','8×']],
          parseVal: v => parseInt(v) },
      ],
    },
  ];

  function pct(v) { return Math.round(v * 100) + '%'; }

  // ── Warning zone helpers ──────────────────────────────────────────────────

  // Is the current value inside a declared danger zone?
  function inWarnZone(spec, v) {
    if (!spec.warn) return false;
    if (spec.warn.below !== undefined && v <= spec.warn.below) return true;
    if (spec.warn.above !== undefined && v >= spec.warn.above) return true;
    return false;
  }

  // Paint a striped clay gradient on the slider track for the warn zone(s).
  function paintWarnTrack(input, spec) {
    if (!spec.warn) return;
    const range = spec.max - spec.min;
    const warn  = 'rgba(178, 106, 79, 0.40)';
    const safe  = 'var(--color-surface-2)';
    const stops = [];

    const lowPct  = spec.warn.below !== undefined
      ? ((spec.warn.below - spec.min) / range) * 100
      : null;
    const highPct = spec.warn.above !== undefined
      ? ((spec.warn.above - spec.min) / range) * 100
      : null;

    let bg;
    if (lowPct !== null && highPct !== null) {
      bg = `linear-gradient(to right, ${warn} 0% ${lowPct}%, ${safe} ${lowPct}% ${highPct}%, ${warn} ${highPct}% 100%)`;
    } else if (highPct !== null) {
      bg = `linear-gradient(to right, ${safe} 0% ${highPct}%, ${warn} ${highPct}% 100%)`;
    } else if (lowPct !== null) {
      bg = `linear-gradient(to right, ${warn} 0% ${lowPct}%, ${safe} ${lowPct}% 100%)`;
    }
    if (bg) input.style.background = bg;
  }

  function syncWarnState(input, display, spec, v) {
    const warned = inWarnZone(spec, v);
    input.classList.toggle('in-warn', warned);
    display.classList.toggle('in-warn', warned);
    if (warned) {
      display.title = 'You\u2019re pushing it \u2014 results may get noisy or unstable here.';
    } else {
      display.removeAttribute('title');
    }
  }

  // ── DOM builders ──────────────────────────────────────────────────────────

  function makeSlider(spec, val, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.dataset.key = spec.key;

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;

    const row = document.createElement('div');
    row.className = 'control__row';

    const input = document.createElement('input');
    input.type = 'range';
    input.min  = spec.min;
    input.max  = spec.max;
    input.step = spec.step;
    input.value = val;
    input.className = 'control__slider';

    const display = document.createElement('span');
    display.className = 'control__value';
    display.textContent = spec.fmt(parseFloat(val));

    paintWarnTrack(input, spec);
    syncWarnState(input, display, spec, parseFloat(val));

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      display.textContent = spec.fmt(v);
      syncWarnState(input, display, spec, v);
      onChange(spec.key, v);
    });

    row.appendChild(input);
    row.appendChild(display);
    wrap.appendChild(label);
    wrap.appendChild(row);
    return wrap;
  }

  function makeSelect(spec, val, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.dataset.key = spec.key;

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;

    const sel = document.createElement('select');
    sel.className = 'control__select';
    for (const [v, txt] of spec.options) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = txt;
      if (String(v) === String(val)) opt.selected = true;
      sel.appendChild(opt);
    }

    sel.addEventListener('change', () => {
      const raw = sel.value;
      onChange(spec.key, spec.parseVal ? spec.parseVal(raw) : raw);
    });

    wrap.appendChild(label);
    wrap.appendChild(sel);
    return wrap;
  }

  function makeToggle(spec, val, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.dataset.key = spec.key;

    const label = document.createElement('span');
    label.className = 'control__label';
    label.textContent = spec.label;

    const btns = document.createElement('div');
    btns.className = 'control__toggle';

    for (const [v, txt] of spec.options) {
      const btn = document.createElement('button');
      btn.className = 'toggle-btn' + (v === val ? ' active' : '');
      btn.textContent = txt;
      btn.dataset.val = v;
      btn.addEventListener('click', () => {
        btns.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(spec.key, v);
      });
      btns.appendChild(btn);
    }

    wrap.appendChild(label);
    wrap.appendChild(btns);
    return wrap;
  }

  function makeControl(spec, state, onChange) {
    switch (spec.type) {
      case 'slider': return makeSlider(spec, state[spec.key], onChange);
      case 'select': return makeSelect(spec, state[spec.key], onChange);
      case 'toggle': return makeToggle(spec, state[spec.key], onChange);
    }
  }

  function updateControl(el, spec, state) {
    const visible = !spec.visible || spec.visible(state);
    el.style.display = visible ? '' : 'none';

    if (spec.type === 'slider') {
      const input = el.querySelector('input');
      const disp  = el.querySelector('.control__value');
      if (input) {
        const v = state[spec.key];
        input.value = v;
        disp.textContent = spec.fmt(v);
        syncWarnState(input, disp, spec, parseFloat(v));
      }
    } else if (spec.type === 'select') {
      const sel = el.querySelector('select');
      if (sel) sel.value = String(state[spec.key]);
    } else if (spec.type === 'toggle') {
      el.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === state[spec.key]);
      });
    }
  }

  // ── Presets strip ─────────────────────────────────────────────────────────

  function makePresetsSection(onChange) {
    const details = document.createElement('details');
    details.open = true;
    details.className = 'controls-section';

    const summary = document.createElement('summary');
    summary.className = 'controls-section__header';
    summary.textContent = 'PRESETS';
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'controls-section__body presets-grid';

    for (const [id, preset] of Object.entries(DitherApp.PRESETS)) {
      const btn = document.createElement('button');
      btn.className = 'preset-btn';
      btn.textContent = preset.label;
      btn.dataset.preset = id;
      btn.addEventListener('click', () => {
        body.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange('__preset__', id);
      });
      body.appendChild(btn);
    }

    details.appendChild(body);
    return details;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  DitherApp.buildControlsPanel = function(container, initialState, onChange) {
    container.innerHTML = '';
    const allControls = []; // [{ el, spec }]

    // Presets
    container.appendChild(makePresetsSection(onChange));

    for (const section of SECTIONS) {
      const details = document.createElement('details');
      details.open = true;
      details.className = 'controls-section';

      const summary = document.createElement('summary');
      summary.className = 'controls-section__header';
      summary.textContent = section.title;
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'controls-section__body';

      for (const spec of section.controls) {
        const el = makeControl(spec, initialState, onChange);
        // Initial visibility
        if (spec.visible && !spec.visible(initialState)) el.style.display = 'none';
        body.appendChild(el);
        allControls.push({ el, spec });
      }

      details.appendChild(body);
      container.appendChild(details);
    }

    return {
      update(state) {
        for (const { el, spec } of allControls) updateControl(el, spec, state);
        // Sync active preset button
        container.querySelectorAll('.preset-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.preset === state.activePreset);
        });
      },
    };
  };
})();
