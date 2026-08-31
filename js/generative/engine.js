/* ══ Generative engine ════════════════════════════════════════════════════
   Shared runtime for source-less effects: they draw themselves from time and
   a bit of state instead of from a video frame.

   An effect module supplies a definition and the engine handles canvas
   sizing, the control panel, play/pause, PNG export and video recording:

     Generative.create({
       name:     'gen-explosion',        // must match <canvas id="NAME-canvas">
       hint:     'Click the canvas …',   // optional chip over the canvas
       defaults: { … },                  // state object
       sections: [ … ],                  // control specs (see buildControls)
       setup(env),                       // canvas resized / state reset
       draw(env, dt),                    // one frame; dt in seconds
       pointer(env, x, y),               // optional — canvas-space click
     });

   `env` is { canvas, ctx, w, h, state, time, frame }, plus whatever the
   effect stashes on it in setup().                                          */

window.Generative = window.Generative || {};

(function () {
  'use strict';

  // ── Canvas size presets ──────────────────────────────────────────────────

  const ASPECTS = {
    '16:9': [16, 9],
    '1:1':  [1, 1],
    '9:16': [9, 16],
    '4:5':  [4, 5],
  };

  const QUALITY = { standard: 960, high: 1440 };

  function canvasSize(state) {
    const [aw, ah] = ASPECTS[state.aspect] || ASPECTS['16:9'];
    const long     = QUALITY[state.quality] || QUALITY.standard;
    return aw >= ah
      ? [long, Math.round(long * ah / aw)]
      : [Math.round(long * aw / ah), long];
  }

  // ── Control panel builder ────────────────────────────────────────────────
  // Spec types: slider | toggle | select | color | text | seed | action

  function buildControl(spec, state, onChange, rebuild) {
    const wrap = document.createElement('div');
    wrap.className = 'control';
    wrap.dataset.key = spec.key || '';

    if (spec.type !== 'action') {
      const label = document.createElement('span');
      label.className = 'control__label';
      label.textContent = spec.label;
      wrap.appendChild(label);
    }

    if (spec.hint) {
      const h = document.createElement('span');
      h.className = 'control__hint';
      h.textContent = spec.hint;
      wrap.appendChild(h);
    }

    switch (spec.type) {

      case 'slider': {
        const row   = document.createElement('div');
        row.className = 'control__row';
        const input = document.createElement('input');
        input.type  = 'range';
        input.min   = spec.min; input.max = spec.max; input.step = spec.step;
        input.value = state[spec.key];
        input.className = 'control__slider';
        input.dataset.param = spec.key;
        const disp  = document.createElement('span');
        disp.className   = 'control__value';
        disp.textContent = spec.fmt ? spec.fmt(state[spec.key]) : state[spec.key];
        input.addEventListener('input', function () {
          const v = parseFloat(input.value);
          disp.textContent = spec.fmt ? spec.fmt(v) : v;
          onChange(spec.key, v);
        });
        row.appendChild(input); row.appendChild(disp);

        // Audio routing lives next to the parameter it drives, not in a
        // separate matrix — click the chip to pick a band and an amount.
        wrap.appendChild(row);

        if (spec.routable) {
          row.appendChild(routeChip(spec, state, onChange));
          wrap.classList.add('control--routable');
          const bar = document.createElement('div');
          bar.className = 'modbar';
          bar.dataset.param = spec.key;
          bar.innerHTML = '<i></i>';
          wrap.appendChild(bar);      // sits under the slider it modulates
        }
        break;
      }

      case 'toggle': {
        const grp = document.createElement('div');
        grp.className = 'control__toggle';
        for (const opt of spec.options) {
          const btn = document.createElement('button');
          btn.className = 'toggle-btn' + (state[spec.key] === opt.value ? ' active' : '');
          btn.textContent = opt.label;
          btn.addEventListener('click', function () {
            grp.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            onChange(spec.key, opt.value);
          });
          grp.appendChild(btn);
        }
        wrap.appendChild(grp);
        break;
      }

      case 'select': {
        const sel = document.createElement('select');
        sel.className = 'control__select';
        for (const opt of spec.options) {
          const o = document.createElement('option');
          o.value = opt.value; o.textContent = opt.label;
          if (state[spec.key] === opt.value) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', function () { onChange(spec.key, sel.value); });
        wrap.appendChild(sel);
        break;
      }

      case 'color': {
        const input = document.createElement('input');
        input.type      = 'color';
        input.value     = state[spec.key];
        input.className = 'control__color';
        input.addEventListener('input', function () { onChange(spec.key, input.value); });
        wrap.appendChild(input);
        break;
      }

      case 'text': {
        const input = document.createElement('input');
        input.type        = 'text';
        input.className   = 'control__text';
        input.value       = state[spec.key] || '';
        input.placeholder = spec.placeholder || '';
        input.spellcheck  = false;
        input.addEventListener('input', function () { onChange(spec.key, input.value); });
        wrap.appendChild(input);
        break;
      }

      case 'seed': {
        const row = document.createElement('div');
        row.className = 'control__row';
        const input = document.createElement('input');
        input.type      = 'number';
        input.min       = 1; input.max = 9999999;
        input.value     = state[spec.key];
        input.className = 'control__text';
        input.style.cssText = 'width:78px;flex:none;';
        input.addEventListener('change', function () {
          const v = Math.max(1, parseInt(input.value, 10) || 1);
          input.value = v;
          onChange(spec.key, v);
        });
        const btn = document.createElement('button');
        btn.className   = 'btn';
        btn.textContent = 'Shuffle';
        btn.addEventListener('click', function () {
          const v = Math.floor(Math.random() * 999998) + 1;
          input.value = v;
          onChange(spec.key, v);
        });
        row.appendChild(input); row.appendChild(btn);
        wrap.appendChild(row);
        break;
      }

      case 'presets': {
        const grid = document.createElement('div');
        grid.className = 'presets-grid';
        const names = Object.keys(spec.list());
        if (!names.length) {
          const empty = document.createElement('span');
          empty.className = 'control__hint';
          empty.textContent = 'No presets saved yet.';
          grid.appendChild(empty);
        }
        for (const nm of names) {
          const btn = document.createElement('button');
          btn.className = 'preset-btn';
          btn.textContent = nm;
          btn.title = 'Click to load · shift-click to delete';
          btn.addEventListener('click', function (e) {
            if (e.shiftKey) spec.remove(nm, rebuild);
            else            spec.load(nm, rebuild);
          });
          grid.appendChild(btn);
        }
        wrap.appendChild(grid);

        const row = document.createElement('div');
        row.className = 'control__row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'control__text';
        input.placeholder = 'Preset name';
        const save = document.createElement('button');
        save.className = 'btn';
        save.textContent = 'Save';
        save.addEventListener('click', function () {
          const nm = (input.value || '').trim();
          if (!nm) { input.focus(); return; }
          spec.save(nm, rebuild);
        });
        row.appendChild(input); row.appendChild(save);
        wrap.appendChild(row);
        break;
      }

      case 'status': {
        const el = document.createElement('span');
        el.className = 'control__status';
        el.dataset.role = 'audio-status';
        wrap.appendChild(el);
        break;
      }

      case 'action': {
        const btn = document.createElement('button');
        btn.className   = 'btn';
        btn.style.width = '100%';
        btn.style.justifyContent = 'center';
        btn.textContent = spec.label;
        btn.addEventListener('click', function () { spec.run(rebuild); });
        wrap.appendChild(btn);
        break;
      }
    }

    return wrap;
  }

  // ── Routing chip + popover ───────────────────────────────────────────────

  const BANDS = [
    { value: 'bass',  label: 'Bass',  short: 'BASS', hint: 'Kick and sub' },
    { value: 'mid',   label: 'Mids',  short: 'MID',  hint: 'Synths and vocals' },
    { value: 'high',  label: 'Highs', short: 'HIGH', hint: 'Hats and air' },
    { value: 'level', label: 'Level', short: 'LVL',  hint: 'Overall loudness' },
    { value: 'beat',  label: 'Beat',  short: 'BEAT', hint: 'Kick envelope' },
  ];

  Generative.BANDS = BANDS;

  function bandShort(band) {
    const b = BANDS.find(x => x.value === band);
    return b ? b.short : '';
  }

  function routeChip(spec, state, onChange) {
    const chip = document.createElement('button');
    chip.className = 'route-chip';
    chip.type = 'button';
    chip.dataset.param = spec.key;
    syncChip(chip, state.routes[spec.key]);
    chip.title = 'Route audio to ' + spec.label;
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      openRoutePopover(chip, spec, state, onChange);
    });
    return chip;
  }

  function syncChip(chip, route) {
    if (route) {
      chip.classList.add('route-chip--on');
      chip.textContent = bandShort(route.band);
      chip.dataset.band = route.band;
    } else {
      chip.classList.remove('route-chip--on');
      chip.textContent = '∿';
      delete chip.dataset.band;
    }
  }

  let _pop = null, _popCloser = null;

  function closeRoutePopover() {
    if (_pop) { _pop.remove(); _pop = null; }
    if (_popCloser) {
      document.removeEventListener('pointerdown', _popCloser, true);
      _popCloser = null;
    }
  }

  Generative.closeRoutePopover = closeRoutePopover;

  function openRoutePopover(chip, spec, state, onChange) {
    const already = _pop && _pop.dataset.param === spec.key;
    closeRoutePopover();
    if (already) return;

    const route = state.routes[spec.key];

    const pop = document.createElement('div');
    pop.className = 'route-pop';
    pop.dataset.param = spec.key;

    const head = document.createElement('div');
    head.className = 'route-pop__head';
    head.textContent = spec.label;
    pop.appendChild(head);

    const sub = document.createElement('div');
    sub.className = 'route-pop__sub';
    sub.textContent = 'Driven by';
    pop.appendChild(sub);

    const bandRow = document.createElement('div');
    bandRow.className = 'route-pop__bands';
    for (const b of BANDS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'route-band' + (route && route.band === b.value ? ' active' : '');
      btn.textContent = b.label;
      btn.title = b.hint;
      btn.addEventListener('click', function () {
        const cur = state.routes[spec.key];
        state.routes[spec.key] = { band: b.value, amount: cur ? cur.amount : 0.5 };
        bandRow.querySelectorAll('.route-band').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
        syncChip(chip, state.routes[spec.key]);
        amount.value = state.routes[spec.key].amount;
        amountVal.textContent = fmtAmount(state.routes[spec.key].amount);
        VideoEffects.refreshSliderFills(pop);
        onChange('__routes__', null);
      });
      bandRow.appendChild(btn);
    }
    pop.appendChild(bandRow);

    const amtLabel = document.createElement('div');
    amtLabel.className = 'route-pop__label';
    amtLabel.textContent = 'Amount';
    pop.appendChild(amtLabel);

    const amtRow = document.createElement('div');
    amtRow.className = 'control__row';
    const amount = document.createElement('input');
    amount.type = 'range';
    amount.min = -1; amount.max = 1; amount.step = 0.01;
    amount.value = route ? route.amount : 0.5;
    amount.className = 'control__slider';
    const amountVal = document.createElement('span');
    amountVal.className = 'control__value';
    amountVal.textContent = fmtAmount(parseFloat(amount.value));
    amount.addEventListener('input', function () {
      const v = parseFloat(amount.value);
      amountVal.textContent = fmtAmount(v);
      const cur = state.routes[spec.key] || { band: 'bass' };
      state.routes[spec.key] = { band: cur.band, amount: v };
      syncChip(chip, state.routes[spec.key]);
      onChange('__routes__', null);
    });
    amtRow.appendChild(amount); amtRow.appendChild(amountVal);
    pop.appendChild(amtRow);

    if (!GenAudio.isActive()) {
      const note = document.createElement('div');
      note.className = 'route-pop__note';
      note.textContent = 'Audio is off — open the Audio bar to start a source.';
      pop.appendChild(note);
    }

    const foot = document.createElement('div');
    foot.className = 'route-pop__foot';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn';
    clear.textContent = route ? 'Remove Route' : 'Cancel';
    clear.addEventListener('click', function () {
      delete state.routes[spec.key];
      syncChip(chip, null);
      onChange('__routes__', null);
      closeRoutePopover();
    });
    foot.appendChild(clear);
    pop.appendChild(foot);

    document.body.appendChild(pop);
    _pop = pop;

    // Anchor beside the chip, nudged back on screen if it would overflow
    const r = chip.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.left + r.width / 2 - w / 2;
    let top  = r.bottom + 8;
    left = Math.max(8, Math.min(window.innerWidth  - w - 8, left));
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    VideoEffects.refreshSliderFills(pop);

    _popCloser = function (e) { if (!pop.contains(e.target) && e.target !== chip) closeRoutePopover(); };
    document.addEventListener('pointerdown', _popCloser, true);
  }

  function fmtAmount(v) {
    return (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  }

  // Shows/hides controls whose `showIf(state)` says they are irrelevant.
  function applyVisibility(container, sections, state) {
    for (const section of sections) {
      for (const spec of section.specs) {
        if (!spec.showIf || !spec.key) continue;
        const el = container.querySelector('.control[data-key="' + spec.key + '"]');
        if (el) el.style.display = spec.showIf(state) ? '' : 'none';
      }
    }
  }

  function buildControls(container, sections, state, onChange, onReset) {
    container.innerHTML = '';
    const rebuild = () => buildControls(container, sections, state, onChange, onReset);

    const resetBar = document.createElement('div');
    resetBar.className = 'controls-reset-bar';
    const resetBtn = document.createElement('button');
    resetBtn.className   = 'btn';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', function () { onReset(); });
    resetBar.appendChild(resetBtn);
    container.appendChild(resetBar);

    for (const section of sections) {
      const details = document.createElement('details');
      details.open = section.open !== false;
      details.className = 'controls-section';

      const summary = document.createElement('summary');
      summary.className   = 'controls-section__header';
      summary.textContent = section.title;
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'controls-section__body';
      if (section.hint) {
        const p = document.createElement('p');
        p.className = 'controls-hint';
        p.textContent = section.hint;
        body.appendChild(p);
      }
      for (const spec of section.specs) {
        body.appendChild(buildControl(spec, state, onChange, rebuild));
      }
      details.appendChild(body);
      container.appendChild(details);
    }

    applyVisibility(container, sections, state);
    if (window.VideoEffects && VideoEffects.refreshSliderFills) {
      VideoEffects.refreshSliderFills(container);
    }
  }

  Generative.buildControls = buildControls;

  // ── Small shared helpers effects can use ─────────────────────────────────

  // Mulberry32 — deterministic, fast, good enough for visual noise.
  Generative.prng = function (seed) {
    let s = (seed | 0) || 1;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // Value noise on a hashed lattice — smooth, seamless enough for fields.
  Generative.noise2 = function (x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi,        yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    function h(a, b) {
      let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(seed | 0, 2147483647);
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
    const a = h(xi, yi),     b = h(xi + 1, yi);
    const c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
  };

  Generative.hexToRgb = function (hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // Sample a ramp of [r,g,b] stops at t ∈ [0,1].
  Generative.rampAt = function (stops, t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const f  = t * (stops.length - 1);
    const i  = Math.min(stops.length - 2, f | 0);
    const k  = f - i;
    const a  = stops[i], b = stops[i + 1];
    return [
      (a[0] + (b[0] - a[0]) * k) | 0,
      (a[1] + (b[1] - a[1]) * k) | 0,
      (a[2] + (b[2] - a[2]) * k) | 0,
    ];
  };

  // ── Shared glyph ramps and palettes (dark → bright) ──────────────────────

  Generative.RAMPS = {
    blocks:   ' ·░▒▓█',
    ascii:    ' .:-=+*#%@',
    dots:     ' .·:∙•●',
    binary:   ' ..0011',
    hex:      ' .159ADF',
    katakana: ' ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ',
    lines:    ' ˙-–—≡█',
    tech:     ' .:!/(|)[]{}#$@',
  };

  Generative.RAMP_OPTIONS = [
    { value: 'blocks',   label: 'Blocks  ░▒▓█' },
    { value: 'ascii',    label: 'ASCII  .:-=+*#@' },
    { value: 'dots',     label: 'Dots  ·:∙•' },
    { value: 'tech',     label: 'Technical  /(|)[]#' },
    { value: 'binary',   label: 'Binary  0011' },
    { value: 'hex',      label: 'Hex  159ADF' },
    { value: 'katakana', label: 'Katakana  ｱｳｴｵ' },
    { value: 'lines',    label: 'Lines  -–—≡' },
  ];

  // Ramps run dark → hot; index 0 is the deepest value.
  Generative.PALETTES = {
    heat:   [[24,6,2],   [120,18,6],  [222,74,12], [255,168,40], [255,246,214]],
    mono:   [[18,18,20], [70,72,76],  [140,144,150], [206,210,214], [255,255,255]],
    acid:   [[10,16,4],  [58,96,14],  [140,190,32], [201,242,77], [238,255,190]],
    ice:    [[4,10,20],  [16,58,104], [42,130,196], [126,206,240], [232,250,255]],
    ember:  [[16,4,10],  [92,14,52],  [190,36,84],  [244,116,96], [255,214,168]],
    toxic:  [[6,16,10],  [12,86,58],  [24,170,110], [120,230,150], [226,255,232]],
    violet: [[12,6,24],  [56,20,110], [122,52,196], [186,132,246], [238,224,255]],
  };

  Generative.PALETTE_OPTIONS = [
    { value: 'heat',   label: 'Heat' },
    { value: 'ember',  label: 'Ember' },
    { value: 'acid',   label: 'Acid' },
    { value: 'toxic',  label: 'Toxic' },
    { value: 'ice',    label: 'Ice' },
    { value: 'violet', label: 'Violet' },
    { value: 'mono',   label: 'Mono' },
  ];

  // Pre-quantise a palette into N css color strings — lets a renderer batch
  // every cell of the same level into one fillStyle change.
  Generative.quantizePalette = function (name, levels) {
    const stops = Generative.PALETTES[name] || Generative.PALETTES.heat;
    const out   = new Array(levels);
    for (let i = 0; i < levels; i++) {
      const c = Generative.rampAt(stops, levels === 1 ? 1 : i / (levels - 1));
      out[i] = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }
    return out;
  };

  // ── Audio reactivity ─────────────────────────────────────────────────────
  // Source selection lives in the global Audio bar; per-parameter routing
  // lives on the parameters themselves (see routeChip). What is left here is
  // the per-effect summary: one-click suggested routing, and a way to clear.

  function audioSection(def) {
    return {
      title: 'AUDIO',
      open: true,
      specs: [
        { key: '__audioSummary', label: '', type: 'status' },
        { key: '__autoRoute', label: 'Suggest Routing for This Effect', type: 'action',
          run: null },   // wired up in create()
        { key: '__clearRoutes', label: 'Clear All Routes', type: 'action',
          run: null },
      ],
    };
  }

  let _audioInput = null;

  function pickAudioFile() {
    if (!_audioInput) {
      _audioInput = document.createElement('input');
      _audioInput.type   = 'file';
      _audioInput.accept = 'audio/*';
      _audioInput.style.display = 'none';
      _audioInput.addEventListener('change', function () {
        if (_audioInput.files[0]) GenAudio.useFile(_audioInput.files[0]);
      });
      document.body.appendChild(_audioInput);
    }
    _audioInput.value = '';
    _audioInput.click();
  }

  Generative.pickAudioFile = pickAudioFile;

  // ── Effect factory ───────────────────────────────────────────────────────

  const SHARED_CANVAS_SECTION = {
    title: 'CANVAS',
    open: false,
    specs: [
      { key: 'aspect', label: 'Aspect Ratio', type: 'select',
        options: [
          { value: '16:9', label: '16:9  Landscape' },
          { value: '1:1',  label: '1:1  Square' },
          { value: '4:5',  label: '4:5  Portrait' },
          { value: '9:16', label: '9:16  Vertical' },
        ] },
      { key: 'quality', label: 'Resolution', type: 'toggle',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'high',     label: 'High' },
        ] },
      { key: 'recordMode', label: 'Clip Length', type: 'toggle',
        options: [
          { value: 'seconds', label: 'Seconds' },
          { value: 'bars',    label: 'Bars' },
        ],
        hint: 'Bars renders a whole number of bars at a fixed tempo, so the clip loops' },
      { key: 'recordSecs', label: 'Duration', type: 'slider',
        min: 2, max: 30, step: 1, fmt: v => v + 's',
        showIf: s => s.recordMode === 'seconds' },
      { key: 'recordBars', label: 'Bars', type: 'slider',
        min: 1, max: 32, step: 1, fmt: v => v + (v === 1 ? ' bar' : ' bars'),
        showIf: s => s.recordMode === 'bars' },
      { key: 'recordBpm', label: 'Tempo', type: 'slider',
        min: 60, max: 200, step: 1, fmt: v => Math.round(v) + ' BPM',
        showIf: s => s.recordMode === 'bars',
        hint: 'Use the tempo the Audio bar detected for a beat-locked clip' },
    ],
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function pickMime() {
    return [
      'video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm',
    ].find(t => MediaRecorder.isTypeSupported(t));
  }

  Generative._defs = {};

  // ── Layer runtime ────────────────────────────────────────────────────────
  // A second, headless instance of another effect, drawing into an offscreen
  // canvas at the host's size. It runs on the host's clock and uses that
  // effect's default state — enough to stack two looks without a second
  // control panel.

  function makeLayer(name, w, h) {
    const def = Generative._defs[name];
    if (!def) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;

    const env = {
      canvas: canvas,
      ctx:    canvas.getContext('2d'),
      w: w, h: h,
      state:  Object.assign({}, def.defaults),
      time:   0,
      frame:  0,
      audio:  GenAudio.bands,
      beats:  GenAudio.beatCount,
      audioActive: GenAudio.isActive(),
    };
    if (def.setup) def.setup(env);

    return {
      name:   name,
      canvas: canvas,
      resize: function (nw, nh) {
        if (canvas.width === nw && canvas.height === nh) return;
        canvas.width = nw; canvas.height = nh;
        env.w = nw; env.h = nh;
        if (def.setup) def.setup(env);
      },
      draw: function (dt) {
        env.audio       = GenAudio.bands;
        env.beats       = GenAudio.beatCount;
        env.audioActive = GenAudio.isActive();
        def.draw(env, dt);
        env.time  += dt;
        env.frame += 1;
      },
    };
  }

  const BLEND_MODES = [
    { value: 'screen',     label: 'Screen  (brighten)' },
    { value: 'lighter',    label: 'Add  (glow)' },
    { value: 'difference', label: 'Difference' },
    { value: 'overlay',    label: 'Overlay' },
    { value: 'multiply',   label: 'Multiply' },
    { value: 'exclusion',  label: 'Exclusion' },
    { value: 'source-over', label: 'Normal  (cover)' },
  ];

  // ── Presets ──────────────────────────────────────────────────────────────

  const PRESET_KEY = 'glistr.presets.';

  function loadPresets(name) {
    try { return JSON.parse(localStorage.getItem(PRESET_KEY + name)) || {}; }
    catch (e) { return {}; }
  }

  function savePresets(name, all) {
    try { localStorage.setItem(PRESET_KEY + name, JSON.stringify(all)); }
    catch (e) { /* private mode — presets just won't persist */ }
  }

  Generative.create = function (def) {
    const defaults = Object.assign(
      {
        aspect: '16:9', quality: 'standard',
        recordSecs: 8, recordMode: 'seconds', recordBars: 8, recordBpm: 128,
        layer: 'none', layerBlend: 'screen', layerOpacity: 0.85,
      },
      def.defaults
    );

    // Any plain slider can take a route; the ones that rebuild the canvas
    // cannot, since re-allocating buffers every frame would stutter.
    const skip   = ['recordSecs'].concat(def.resetKeys || []);
    const bounds = {};
    for (const section of def.sections) {
      for (const spec of section.specs) {
        if (spec.type !== 'slider' || !spec.key) continue;
        bounds[spec.key] = spec;
        if (skip.indexOf(spec.key) === -1) spec.routable = true;
      }
    }

    const audioSec = audioSection(def);

    const presetSec = {
      title: 'PRESETS', open: false,
      specs: [
        { key: '__presets', label: 'Saved Looks', type: 'presets',
          list: null, load: null, save: null, remove: null },   // wired in init
        { key: '__randomise', label: 'Randomise Within Taste', type: 'action',
          run: null },
      ],
    };

    const layerSec = {
      title: 'LAYERS', open: false,
      specs: [
        { key: 'layer', label: 'Background Layer', type: 'select',
          options: [{ value: 'none', label: 'None' }],           // filled in init
          hint: 'Renders another generative effect underneath this one' },
        { key: 'layerBlend', label: 'Blend Mode', type: 'select',
          options: BLEND_MODES, showIf: s => s.layer !== 'none' },
        { key: 'layerOpacity', label: 'This Effect\u2019s Opacity', type: 'slider',
          min: 0.05, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%',
          showIf: s => s.layer !== 'none' },
      ],
    };

    const sections = [presetSec].concat(def.sections, [audioSec, layerSec, SHARED_CANVAS_SECTION]);

    const state    = Object.assign({ routes: {} }, defaults);
    const mstate   = Object.assign({}, state);      // state + audio modulation
    let controlsEl = null;
    let env        = null;
    let playing    = true;
    let dirty      = true;
    let lastNow    = 0;
    let exporting  = false, cancelExport = false;

    // Frame-rate meter (shown in the toolbar)
    let fpsAccum = 0, fpsFrames = 0, fpsValue = 0;

    function resize() {
      const [w, h] = canvasSize(state);
      if (env.canvas.width !== w || env.canvas.height !== h) {
        env.canvas.width  = w;
        env.canvas.height = h;
      }
      env.w = w; env.h = h;
      if (def.setup) def.setup(env);
      dirty = true;
    }

    function onChange(key, value) {
      if (key === '__routes__') {
        updateAudioStatus();
        dirty = true;
        return;
      }

      const needsSetup = key === 'aspect' || key === 'quality' ||
                         (def.resetKeys && def.resetKeys.indexOf(key) !== -1);
      state[key] = value;
      env.state  = state;
      if (needsSetup) resize();
      else if (def.setup && def.liveSetup) def.setup(env);
      applyVisibility(controlsEl, sections, state);
      dirty = true;
    }

    // Applies the effect's own suggested routing — the fastest way from
    // "audio is on" to "this looks like a music video".
    function autoRoute() {
      const suggest = def.audioSuggest || [];
      for (const item of suggest) {
        if (item.value !== undefined) state[item.key] = item.value;
        else if (bounds[item.key])   state.routes[item.key] = { band: item.band, amount: item.amount };
      }
      dirty = true;
    }

    // Nudges every slider by up to a quarter of its range and re-rolls any
    // seed — enough to find a new look, not so much that it stops being the
    // look you were working on.
    function randomise() {
      for (const section of def.sections) {
        for (const spec of section.specs) {
          if (spec.type === 'slider' && spec.key) {
            const range = spec.max - spec.min;
            let v = state[spec.key] + (Math.random() - 0.5) * range * 0.5;
            v = Math.max(spec.min, Math.min(spec.max, v));
            if (spec.step >= 1) v = Math.round(v);
            state[spec.key] = v;
          } else if (spec.type === 'seed' && spec.key) {
            state[spec.key] = Math.floor(Math.random() * 999998) + 1;
          }
        }
      }
      dirty = true;
    }

    // Replaces every value without replacing the object, so every control
    // closure and `env.state` keep pointing at the live state.
    function replaceState(next) {
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, next);
      env.state = state;
    }

    function reset() {
      replaceState(Object.assign({ routes: {} }, defaults));
      buildControls(controlsEl, sections, state, onChange, reset);
      resize();
    }

    // Copies user state into mstate, then offsets any routed parameter by its
    // band energy scaled to that slider's own range.
    function applyModulation() {
      Object.assign(mstate, state);
      const routes = state.routes;
      if (!GenAudio.isActive()) return;
      const bands = GenAudio.bands;
      for (const key in routes) {
        const spec = bounds[key];
        if (!spec) continue;
        const r = routes[key];
        const v = state[key] + r.amount * (spec.max - spec.min) * (bands[r.band] || 0);
        mstate[key] = v < spec.min ? spec.min : v > spec.max ? spec.max : v;
      }
    }

    // Paints the live modulated value under each routed slider so you can see
    // what the music is doing to the parameter.
    function updateModBars() {
      if (!controlsEl) return;
      const bars = controlsEl.querySelectorAll('.modbar');
      for (let i = 0; i < bars.length; i++) {
        const key  = bars[i].dataset.param;
        const spec = bounds[key];
        const on   = !!state.routes[key] && GenAudio.isActive();
        bars[i].classList.toggle('modbar--on', on);
        if (!on || !spec) continue;
        const pct = ((mstate[key] - spec.min) / (spec.max - spec.min)) * 100;
        bars[i].firstChild.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
        bars[i].dataset.band = state.routes[key].band;
      }
    }

    // Offscreen buffer used only while a background layer is active
    let hostBuf = null, hostBufCtx = null, layer = null;

    function ensureLayer() {
      if (state.layer === 'none' || !Generative._defs[state.layer]) {
        layer = null;
        return false;
      }
      if (!layer || layer.name !== state.layer) {
        layer = makeLayer(state.layer, env.w, env.h);
      } else {
        layer.resize(env.w, env.h);
      }
      if (!hostBuf) {
        hostBuf = document.createElement('canvas');
        hostBufCtx = hostBuf.getContext('2d');
      }
      if (hostBuf.width !== env.w || hostBuf.height !== env.h) {
        hostBuf.width = env.w; hostBuf.height = env.h;
      }
      return !!layer;
    }

    function step(dt) {
      applyModulation();
      env.state = mstate;
      env.audio       = GenAudio.bands;
      env.beats       = GenAudio.beatCount;
      env.audioActive = GenAudio.isActive();

      const display = env.canvas.getContext('2d');

      if (ensureLayer()) {
        // Host renders into its own buffer so the layer shows through it
        env.ctx = hostBufCtx;
        def.draw(env, dt);
        layer.draw(dt);

        display.globalCompositeOperation = 'source-over';
        display.globalAlpha = 1;
        display.clearRect(0, 0, env.w, env.h);
        display.drawImage(layer.canvas, 0, 0);

        display.globalCompositeOperation = state.layerBlend;
        display.globalAlpha = state.layerOpacity;
        display.drawImage(hostBuf, 0, 0);

        display.globalCompositeOperation = 'source-over';
        display.globalAlpha = 1;
      } else {
        env.ctx = display;
        def.draw(env, dt);
      }

      env.state  = state;
      env.time  += dt;
      env.frame += 1;
    }

    function updateAudioStatus() {
      if (!controlsEl) return;
      const el = controlsEl.querySelector('[data-role="audio-status"]');
      if (!el) return;
      const keys = Object.keys(state.routes);
      const live = GenAudio.isActive();
      if (!keys.length) {
        el.textContent = live
          ? 'No routes yet — click the \u223f beside any slider.'
          : 'Open the Audio bar below to start a source, then click the \u223f beside any slider.';
        el.classList.remove('control__status--on');
        return;
      }
      const names = keys.map(function (k) {
        return (bounds[k] ? bounds[k].label : k) + ' ← ' + state.routes[k].band;
      });
      el.textContent = (live ? '' : 'Audio is off · ') +
                       keys.length + ' route' + (keys.length > 1 ? 's' : '') + ': ' + names.join(', ');
      el.classList.toggle('control__status--on', live);
    }

    // ── Export ──────────────────────────────────────────────────────────────

    function exportFrame() {
      if (!env) return;
      const a = document.createElement('a');
      a.download = def.name + '.png';
      a.href     = env.canvas.toDataURL('image/png');
      a.click();
    }

    async function exportFullRes() {
      if (exporting || !env) return;
      const mime = pickMime();
      if (!mime) { alert('MediaRecorder is not supported in this browser.'); return; }
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';

      exporting = true; cancelExport = false;
      const wasPlaying = playing;
      playing = true;

      const fps      = 60;
      const bars     = state.recordMode === 'bars';
      const beatSecs = 60 / state.recordBpm;
      const secs     = bars ? state.recordBars * 4 * beatSecs : state.recordSecs;
      const total    = Math.round(secs * fps);
      const stream   = env.canvas.captureStream(fps);
      const recorder = new MediaRecorder(stream, {
        mimeType: mime, videoBitsPerSecond: 16_000_000,
      });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      VideoEffects.setExportUI(true, 0);
      recorder.start();

      // Fixed timestep so the recorded clip plays back at exactly 60fps
      // regardless of how fast the machine can actually render it. In bars
      // mode the beat is generated from the clip's own tempo rather than read
      // from live audio, so beat-driven effects land on the grid and the clip
      // loops cleanly.
      const restoreBeat = bars ? GenAudio.beginSyntheticBeat(state.recordBpm) : null;

      await new Promise(resolve => {
        let i = 0;
        function frame() {
          if (cancelExport || i >= total) { resolve(); return; }
          if (bars) GenAudio.advanceSyntheticBeat(1 / fps);
          step(1 / fps);
          i++;
          VideoEffects.setExportUI(true, i / total);
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });

      if (restoreBeat) restoreBeat();

      await sleep(150);
      recorder.stop();
      await new Promise(r => { recorder.onstop = r; });

      if (!cancelExport) {
        const blob = new Blob(chunks, { type: mime });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = def.name + '.' + ext;
        a.click();
      }

      exporting = false;
      playing   = wasPlaying;
      lastNow   = 0;
      VideoEffects.setExportUI(false, 0);
      VideoEffects.syncPlayButton();
    }

    // ── Registration ────────────────────────────────────────────────────────

    Generative._defs[def.name] = def;

    VideoEffects.register(def.name, {

      generative: true,
      hint: def.hint || '',

      init: function (canvas, container) {
        controlsEl = container;
        env = {
          canvas: canvas,
          ctx:    canvas.getContext('2d'),
          w: 0, h: 0,
          state:  state,
          time:   0,
          frame:  0,
        };
        // Presets — saved per effect in localStorage
        presetSec.specs[0].list = function () { return loadPresets(def.name); };
        presetSec.specs[0].save = function (nm, rebuild) {
          const all = loadPresets(def.name);
          all[nm] = JSON.parse(JSON.stringify(state));
          savePresets(def.name, all);
          rebuild();
        };
        presetSec.specs[0].load = function (nm) {
          const all = loadPresets(def.name);
          if (!all[nm]) return;
          replaceState(Object.assign({ routes: {} }, defaults, all[nm]));
          buildControls(controlsEl, sections, state, onChange, reset);
          resize();
          updateAudioStatus();
        };
        presetSec.specs[0].remove = function (nm, rebuild) {
          const all = loadPresets(def.name);
          delete all[nm];
          savePresets(def.name, all);
          rebuild();
        };
        presetSec.specs[1].run = function () {
          randomise();
          buildControls(controlsEl, sections, state, onChange, reset);
          resize();
        };

        // Layer picker lists every other generative effect
        layerSec.specs[0].options = [{ value: 'none', label: 'None' }].concat(
          Object.keys(Generative._defs)
            .filter(function (n) { return n !== def.name; })
            .map(function (n) {
              return { value: n, label: Generative._defs[n].title || n };
            })
        );

        audioSec.specs[1].run = function (rebuild) { autoRoute(); rebuild(); updateAudioStatus(); };
        audioSec.specs[2].run = function (rebuild) {
          state.routes = {};
          rebuild(); updateAudioStatus();
        };

        buildControls(controlsEl, sections, state, onChange, reset);
        resize();

        GenAudio.onChange(updateAudioStatus);

        if (def.pointer) {
          canvas.style.cursor = 'crosshair';
          canvas.addEventListener('pointerdown', function (e) {
            const r = canvas.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const x = (e.clientX - r.left) * (canvas.width  / r.width);
            const y = (e.clientY - r.top)  * (canvas.height / r.height);
            def.pointer(env, x, y);
            dirty = true;
          });
        }
      },

      activate: function () {
        dirty = true; lastNow = 0;
        updateAudioStatus();
        updateModBars();
      },
      deactivate: function () {},

      isPlaying:  function () { return playing; },
      setPlaying: function (v) { playing = v; lastNow = 0; dirty = true; },

      tick: function () {
        if (exporting) return;

        const now = performance.now();
        let dt = lastNow ? (now - lastNow) / 1000 : 1 / 60;
        lastNow = now;
        if (dt > 0.1) dt = 0.1;        // don't fast-forward after a stall

        if (!playing) {
          if (dirty) { step(0); dirty = false; }
          return;
        }

        step(dt);
        dirty = false;
        updateModBars();

        fpsAccum += dt; fpsFrames++;
        if (fpsAccum >= 0.5) {
          fpsValue = Math.round(fpsFrames / fpsAccum);
          fpsAccum = 0; fpsFrames = 0;
          VideoEffects.setGenFps(fpsValue);
        }
      },

      exportFrame:   exportFrame,
      exportFullRes: exportFullRes,
      cancelExport:  function () { cancelExport = true; },
    });
  };
})();
