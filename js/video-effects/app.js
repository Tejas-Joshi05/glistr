window.VideoEffects = window.VideoEffects || {};

(function () {
  'use strict';

  const _registry = {};
  let _active = null;
  const _shared = { video: null, hasVideo: false };
  let _isSeeking = false;   // module-level so loadVideo's timeupdate can read it

  // ── Public API ─────────────────────────────────────────────────────────────

  VideoEffects.register = function (name, def) {
    _registry[name] = def;
  };

  VideoEffects.getVideo    = function () { return _shared.video; };
  VideoEffects.getHasVideo = function () { return _shared.hasVideo; };

  VideoEffects.setVideoInfo = function (text) {
    const el = document.getElementById('video-info');
    if (el) el.textContent = text;
  };

  VideoEffects.setExportUI = function (active, progress) {
    const bar    = document.getElementById('export-bar');
    const fill   = document.getElementById('export-fill');
    const label  = document.getElementById('export-label');
    const btnExp = document.getElementById('btn-export-fullres');
    const btnCan = document.getElementById('btn-cancel-export');

    bar.style.display    = active ? 'flex' : 'none';
    btnExp.disabled      = active;
    btnCan.style.display = active ? '' : 'none';

    if (active) {
      const pct = Math.round(progress * 100);
      fill.style.width  = pct + '%';
      label.textContent = pct < 100 ? `Exporting… ${pct}%` : 'Finishing…';
    }
  };

  // ── Seek helpers ───────────────────────────────────────────────────────────

  function formatTime(s) {
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  function updateSeekDisplay(currentTime, duration) {
    const slider = document.getElementById('seek-slider');
    const pct    = duration ? (currentTime / duration) * 100 : 0;
    slider.style.setProperty('--seek-pct', pct.toFixed(2) + '%');
    document.getElementById('seek-current').textContent  = formatTime(currentTime);
    document.getElementById('seek-duration').textContent = formatTime(duration || 0);
  }

  // ── DOMContentLoaded ───────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    // Shared video element (never inserted into DOM)
    const video = document.createElement('video');
    video.playsInline = true;
    video.loop  = true;
    video.muted = true;
    _shared.video = video;

    // Keep scrubber in sync during playback (set up once here)
    video.addEventListener('timeupdate', function () {
      if (_isSeeking || !video.duration) return;
      const slider = document.getElementById('seek-slider');
      slider.value = (video.currentTime / video.duration) * 10000;
      updateSeekDisplay(video.currentTime, video.duration);
    });

    // Init each effect
    for (const [name, def] of Object.entries(_registry)) {
      const canvas   = document.getElementById(name + '-canvas');
      const controls = document.getElementById(name + '-controls');
      if (def.init) def.init(canvas, controls);
    }

    // Tab buttons
    document.querySelectorAll('.effect-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTo(tab.dataset.tab); });
    });

    // Activate the first tab
    const firstTab = document.querySelector('.effect-tab.active');
    if (firstTab) {
      _active = firstTab.dataset.tab;
      if (_registry[_active] && _registry[_active].activate) {
        _registry[_active].activate();
      }
    }

    // File input
    document.getElementById('video-input').addEventListener('change', function (e) {
      if (e.target.files[0]) loadVideo(e.target.files[0]);
    });

    // Drag-and-drop on every canvas wrapper
    document.querySelectorAll('.canvas-wrapper').forEach(function (wrapper) {
      wrapper.addEventListener('dragover', function (e) {
        e.preventDefault();
        wrapper.classList.add('drag-over');
      });
      wrapper.addEventListener('dragleave', function () {
        wrapper.classList.remove('drag-over');
      });
      wrapper.addEventListener('drop', function (e) {
        e.preventDefault();
        wrapper.classList.remove('drag-over');
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('video/')) loadVideo(f);
      });
    });

    // Toolbar buttons
    document.getElementById('btn-play').addEventListener('click', togglePlay);

    document.getElementById('btn-export-frame').addEventListener('click', function () {
      if (_active && _registry[_active] && _registry[_active].exportFrame) {
        _registry[_active].exportFrame();
      }
    });

    document.getElementById('btn-export-fullres').addEventListener('click', function () {
      if (_active && _registry[_active] && _registry[_active].exportFullRes) {
        _registry[_active].exportFullRes();
      }
    });

    document.getElementById('btn-cancel-export').addEventListener('click', function () {
      if (_active && _registry[_active] && _registry[_active].cancelExport) {
        _registry[_active].cancelExport();
      }
    });

    // Seek slider
    const seekSlider = document.getElementById('seek-slider');

    seekSlider.addEventListener('mousedown',  function () { _isSeeking = true; });
    seekSlider.addEventListener('touchstart', function () { _isSeeking = true; }, { passive: true });
    seekSlider.addEventListener('mouseup',    function () { _isSeeking = false; });
    seekSlider.addEventListener('touchend',   function () { _isSeeking = false; });

    seekSlider.addEventListener('input', function () {
      const v = _shared.video;
      if (!_shared.hasVideo || !v.duration) return;
      v.currentTime = (parseFloat(seekSlider.value) / 10000) * v.duration;
      updateSeekDisplay(v.currentTime, v.duration);
      // Tell the active effect to re-render the seeked frame
      if (_registry[_active] && _registry[_active].onSeek) _registry[_active].onSeek();
    });

    requestAnimationFrame(tick);
  });

  // ── Tab switching ──────────────────────────────────────────────────────────

  function switchTo(name) {
    if (!_registry[name] || name === _active) return;

    if (_active && _registry[_active] && _registry[_active].deactivate) {
      _registry[_active].deactivate();
    }

    document.querySelectorAll('.effect-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });

    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.style.display = p.id === 'panel-' + name ? 'flex' : 'none';
    });

    _active = name;

    if (_registry[_active] && _registry[_active].activate) {
      _registry[_active].activate();
    }

    const btnFull = document.getElementById('btn-export-fullres');
    btnFull.disabled = !(_shared.hasVideo && !!(_registry[_active] && _registry[_active].exportFullRes));
  }

  // ── Video loading ──────────────────────────────────────────────────────────

  function loadVideo(file) {
    const v = _shared.video;
    if (v.src) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(file);

    v.onloadedmetadata = function () {
      _shared.hasVideo = true;

      for (const [, def] of Object.entries(_registry)) {
        if (def.onVideoLoad) def.onVideoLoad(v, v.videoWidth, v.videoHeight);
      }

      document.getElementById('btn-play').disabled    = false;
      document.getElementById('btn-play').textContent = 'Pause';

      const btnFull = document.getElementById('btn-export-fullres');
      btnFull.disabled = !(_registry[_active] && _registry[_active].exportFullRes);

      document.querySelectorAll('.drop-overlay').forEach(function (o) {
        o.classList.add('hidden');
      });

      const seekSlider = document.getElementById('seek-slider');
      seekSlider.disabled = false;
      seekSlider.value    = 0;
      updateSeekDisplay(0, v.duration);

      VideoEffects.setVideoInfo('');
      v.play();
    };
  }

  function togglePlay() {
    const v = _shared.video;
    if (!_shared.hasVideo) return;
    if (v.paused) {
      v.play();
      document.getElementById('btn-play').textContent = 'Pause';
    } else {
      v.pause();
      document.getElementById('btn-play').textContent = 'Play';
    }
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  function tick() {
    requestAnimationFrame(tick);
    if (_active && _registry[_active] && _registry[_active].tick) {
      _registry[_active].tick(_shared.video, _shared.hasVideo);
    }
  }
})();
