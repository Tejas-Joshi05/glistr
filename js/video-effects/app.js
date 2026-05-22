window.VideoEffects = window.VideoEffects || {};

(function () {
  'use strict';

  const _registry = {};
  let _active    = null;
  let _realVideo = null;          // always an HTMLVideoElement
  const _shared  = { video: null, hasVideo: false, isImage: false };
  let _isSeeking = false;

  // ── Public API ─────────────────────────────────────────────────────────────

  VideoEffects.register    = function (name, def) { _registry[name] = def; };
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
      label.textContent = pct < 100 ? 'Exporting\u2026 ' + pct + '%' : 'Finishing\u2026';
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

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
    _realVideo             = document.createElement('video');
    _realVideo.playsInline = true;
    _realVideo.loop        = true;
    _realVideo.muted       = true;
    _shared.video          = _realVideo;

    // Keep seek slider in sync during playback
    _realVideo.addEventListener('timeupdate', function () {
      if (_shared.isImage || _isSeeking || !_realVideo.duration) return;
      const slider = document.getElementById('seek-slider');
      slider.value = (_realVideo.currentTime / _realVideo.duration) * 10000;
      updateSeekDisplay(_realVideo.currentTime, _realVideo.duration);
    });

    // Init every registered effect
    for (const [name, def] of Object.entries(_registry)) {
      const canvas   = document.getElementById(name + '-canvas');
      const controls = document.getElementById(name + '-controls');
      if (def.init) def.init(canvas, controls);
    }

    // Tab buttons
    document.querySelectorAll('.effect-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { switchTo(tab.dataset.tab); });
    });

    const firstTab = document.querySelector('.effect-tab.active');
    if (firstTab) {
      _active = firstTab.dataset.tab;
      if (_registry[_active] && _registry[_active].activate) _registry[_active].activate();
    }

    // File input — accepts video and image
    document.getElementById('video-input').addEventListener('change', function (e) {
      if (e.target.files[0]) loadMedia(e.target.files[0]);
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
        if (f) loadMedia(f);
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
      if (_shared.isImage || !_shared.hasVideo || !_realVideo.duration) return;
      _realVideo.currentTime = (parseFloat(seekSlider.value) / 10000) * _realVideo.duration;
      updateSeekDisplay(_realVideo.currentTime, _realVideo.duration);
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
    if (_registry[_active] && _registry[_active].activate) _registry[_active].activate();

    const btnFull = document.getElementById('btn-export-fullres');
    btnFull.disabled = !(
      _shared.hasVideo &&
      !_shared.isImage &&
      !!(_registry[_active] && _registry[_active].exportFullRes)
    );
  }

  // ── Media loading ──────────────────────────────────────────────────────────

  function loadMedia(file) {
    if      (file.type.startsWith('video/')) loadVideo(file);
    else if (file.type.startsWith('image/')) loadImage(file);
  }

  function loadVideo(file) {
    _shared.isImage = false;
    if (_realVideo.src) URL.revokeObjectURL(_realVideo.src);
    _realVideo.src = URL.createObjectURL(file);
    _shared.video  = _realVideo;

    _realVideo.onloadedmetadata = function () {
      _shared.hasVideo = true;

      for (const [, def] of Object.entries(_registry)) {
        if (def.onVideoLoad) def.onVideoLoad(_realVideo, _realVideo.videoWidth, _realVideo.videoHeight);
      }

      document.getElementById('btn-play').disabled    = false;
      document.getElementById('btn-play').textContent = 'Pause';

      const btnFull = document.getElementById('btn-export-fullres');
      btnFull.disabled = !(_registry[_active] && _registry[_active].exportFullRes);

      document.querySelectorAll('.drop-overlay').forEach(function (o) { o.classList.add('hidden'); });

      const seekSlider = document.getElementById('seek-slider');
      seekSlider.disabled = false;
      seekSlider.value    = 0;
      updateSeekDisplay(0, _realVideo.duration);

      VideoEffects.setVideoInfo('');
      _realVideo.play();
    };
  }

  function loadImage(file) {
    _shared.isImage = true;
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);

      // A canvas mimics a video element as a drawImage-compatible source
      const imgCanvas      = document.createElement('canvas');
      imgCanvas.width      = img.naturalWidth;
      imgCanvas.height     = img.naturalHeight;
      imgCanvas.getContext('2d').drawImage(img, 0, 0);

      // Fake video properties so every effect works without modification
      imgCanvas.videoWidth  = img.naturalWidth;
      imgCanvas.videoHeight = img.naturalHeight;
      imgCanvas.readyState  = 4;
      imgCanvas.paused      = false;   // treated as "playing" so effects render
      imgCanvas.currentTime = 0;
      imgCanvas.duration    = 0;
      imgCanvas.play        = function () {};
      imgCanvas.pause       = function () {};

      if (!_realVideo.paused) _realVideo.pause();
      _shared.video    = imgCanvas;
      _shared.hasVideo = true;

      for (const [, def] of Object.entries(_registry)) {
        if (def.onVideoLoad) def.onVideoLoad(imgCanvas, img.naturalWidth, img.naturalHeight);
      }

      document.getElementById('btn-play').disabled    = true;
      document.getElementById('btn-play').textContent = 'Play';
      document.getElementById('btn-export-fullres').disabled = true;

      document.querySelectorAll('.drop-overlay').forEach(function (o) { o.classList.add('hidden'); });

      const seekSlider = document.getElementById('seek-slider');
      seekSlider.disabled = true;
      seekSlider.value    = 0;
      updateSeekDisplay(0, 0);
      VideoEffects.setVideoInfo('');
    };

    img.src = url;
  }

  // ── Play / Pause ───────────────────────────────────────────────────────────

  function togglePlay() {
    if (!_shared.hasVideo || _shared.isImage) return;
    if (_realVideo.paused) {
      _realVideo.play();
      document.getElementById('btn-play').textContent = 'Pause';
    } else {
      _realVideo.pause();
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
