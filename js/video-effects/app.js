window.VideoEffects = window.VideoEffects || {};

(function () {
  'use strict';

  const _registry = {};
  let _active    = null;
  let _realVideo = null;
  const _shared  = { video: null, hasVideo: false, isImage: false };
  let _isSeeking = false;

  // Zoom / pan state
  let _zoom      = 1;
  let _panX      = 0;
  let _panY      = 0;
  let _isPanning = false;
  let _panMouseX = 0;
  let _panMouseY = 0;
  // Pinch-to-zoom touch state
  let _touchStartDist = null;
  let _touchStartZoom = null;

  const ZOOM_MIN  = 0.1;
  const ZOOM_MAX  = 8;
  const ZOOM_STEP = 1.15;

  // ── Public API ─────────────────────────────────────────────────────────────

  VideoEffects.register    = function (name, def) { _registry[name] = def; };
  VideoEffects.getVideo    = function () { return _shared.video; };
  VideoEffects.getHasVideo = function () { return _shared.hasVideo; };

  VideoEffects.setVideoInfo = function (text) {
    var el = document.getElementById('video-info');
    if (el) el.textContent = text;
  };

  VideoEffects.setExportUI = function (active, progress) {
    var bar    = document.getElementById('export-bar');
    var fill   = document.getElementById('export-fill');
    var label  = document.getElementById('export-label');
    var btnExp = document.getElementById('btn-export-fullres');
    var btnCan = document.getElementById('btn-cancel-export');

    bar.style.display    = active ? 'flex' : 'none';
    btnExp.disabled      = active;
    btnCan.style.display = active ? '' : 'none';

    if (active) {
      var pct = Math.round(progress * 100);
      fill.style.width  = pct + '%';
      label.textContent = pct < 100 ? 'Exporting… ' + pct + '%' : 'Finishing…';
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function formatTime(s) {
    var m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  function updateSeekDisplay(currentTime, duration) {
    var slider = document.getElementById('seek-slider');
    var pct    = duration ? (currentTime / duration) * 100 : 0;
    slider.style.setProperty('--seek-pct', pct.toFixed(2) + '%');
    document.getElementById('seek-current').textContent  = formatTime(currentTime);
    document.getElementById('seek-duration').textContent = formatTime(duration || 0);
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  function getActiveCanvas() {
    return _active ? document.getElementById(_active + '-canvas') : null;
  }

  function applyZoomTransform() {
    var canvas = getActiveCanvas();
    if (!canvas) return;
    canvas.style.transformOrigin = 'center center';
    canvas.style.transform = 'translate(' + _panX + 'px, ' + _panY + 'px) scale(' + _zoom + ')';
    var el = document.getElementById('zoom-level');
    if (el) el.textContent = Math.round(_zoom * 100) + '%';
    updateCursors();
  }

  function updateCursors() {
    document.querySelectorAll('.canvas-wrapper').forEach(function (w) {
      w.style.cursor = _isPanning ? 'grabbing' : (_zoom !== 1 ? 'grab' : 'default');
    });
  }

  function zoomBy(factor) {
    _zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, _zoom * factor));
    applyZoomTransform();
  }

  function resetZoom() {
    _zoom = 1; _panX = 0; _panY = 0;
    applyZoomTransform();
  }

  // ── Mobile controls panel toggle ───────────────────────────────────────────

  function closeMobileControls() {
    document.querySelectorAll('.controls-panel').forEach(function (p) {
      p.classList.remove('mobile-open');
    });
    var b = document.getElementById('btn-controls-mobile');
    if (b) b.textContent = 'Controls';
  }

  // ── DOMContentLoaded ───────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', function () {
    _realVideo             = document.createElement('video');
    _realVideo.playsInline = true;
    _realVideo.loop        = true;
    _realVideo.muted       = true;
    _shared.video          = _realVideo;

    _realVideo.addEventListener('timeupdate', function () {
      if (_shared.isImage || _isSeeking || !_realVideo.duration) return;
      var slider = document.getElementById('seek-slider');
      slider.value = (_realVideo.currentTime / _realVideo.duration) * 10000;
      updateSeekDisplay(_realVideo.currentTime, _realVideo.duration);
    });

    for (var name in _registry) {
      var def      = _registry[name];
      var canvas   = document.getElementById(name + '-canvas');
      var controls = document.getElementById(name + '-controls');
      if (def.init) def.init(canvas, controls);
    }

    document.querySelectorAll('.effect-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        if (!tab.disabled) switchTo(tab.dataset.tab);
      });
    });

    var firstTab = document.querySelector('.effect-tab.active');
    if (firstTab) {
      _active = firstTab.dataset.tab;
      if (_registry[_active] && _registry[_active].activate) _registry[_active].activate();
    }

    document.getElementById('video-input').addEventListener('change', function (e) {
      if (e.target.files[0]) loadMedia(e.target.files[0]);
    });

    // ── Canvas wrappers: drag-drop, wheel zoom, mouse pan, touch pan/pinch ──
    document.querySelectorAll('.canvas-wrapper').forEach(function (wrapper) {

      // Drag-and-drop
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
        var f = e.dataTransfer.files[0];
        if (f) loadMedia(f);
      });

      // Wheel zoom
      wrapper.addEventListener('wheel', function (e) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      }, { passive: false });

      // Mouse pan
      wrapper.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        _isPanning = true;
        _panMouseX = e.clientX;
        _panMouseY = e.clientY;
        updateCursors();
      });
      wrapper.addEventListener('mousemove', function (e) {
        if (!_isPanning) return;
        _panX += e.clientX - _panMouseX;
        _panY += e.clientY - _panMouseY;
        _panMouseX = e.clientX;
        _panMouseY = e.clientY;
        applyZoomTransform();
      });
      wrapper.addEventListener('mouseup', function () {
        _isPanning = false;
        updateCursors();
      });
      wrapper.addEventListener('mouseleave', function () {
        _isPanning = false;
        updateCursors();
      });

      // Touch: single-finger pan, two-finger pinch-to-zoom
      wrapper.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          _touchStartDist = Math.sqrt(dx * dx + dy * dy);
          _touchStartZoom = _zoom;
          _isPanning = false;
        } else if (e.touches.length === 1) {
          _isPanning = true;
          _panMouseX = e.touches[0].clientX;
          _panMouseY = e.touches[0].clientY;
        }
      }, { passive: true });

      wrapper.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2 && _touchStartDist !== null) {
          e.preventDefault();
          var dx   = e.touches[0].clientX - e.touches[1].clientX;
          var dy   = e.touches[0].clientY - e.touches[1].clientY;
          var dist = Math.sqrt(dx * dx + dy * dy);
          _zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, _touchStartZoom * (dist / _touchStartDist)));
          applyZoomTransform();
        } else if (e.touches.length === 1 && _isPanning) {
          e.preventDefault();
          _panX += e.touches[0].clientX - _panMouseX;
          _panY += e.touches[0].clientY - _panMouseY;
          _panMouseX = e.touches[0].clientX;
          _panMouseY = e.touches[0].clientY;
          applyZoomTransform();
        }
      }, { passive: false });

      wrapper.addEventListener('touchend', function () {
        _isPanning      = false;
        _touchStartDist = null;
        _touchStartZoom = null;
      });
      wrapper.addEventListener('touchcancel', function () {
        _isPanning      = false;
        _touchStartDist = null;
        _touchStartZoom = null;
      });
    });

    // Click-to-browse on every drop overlay
    document.querySelectorAll('.drop-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function () {
        document.getElementById('video-input').click();
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

    // Change file button
    var changeFileBtn = document.getElementById('btn-change-file');
    if (changeFileBtn) {
      changeFileBtn.addEventListener('click', function () {
        document.getElementById('video-input').click();
      });
    }

    // Zoom buttons
    document.getElementById('btn-zoom-in').addEventListener('click', function () { zoomBy(ZOOM_STEP); });
    document.getElementById('btn-zoom-out').addEventListener('click', function () { zoomBy(1 / ZOOM_STEP); });
    document.getElementById('zoom-level').addEventListener('click', resetZoom);

    // Mobile: controls panel toggle
    var ctrlBtn = document.getElementById('btn-controls-mobile');
    if (ctrlBtn) {
      ctrlBtn.addEventListener('click', function () {
        var panel = document.querySelector('#panel-' + _active + ' .controls-panel');
        if (!panel) return;
        var isOpen = panel.classList.toggle('mobile-open');
        ctrlBtn.textContent = isOpen ? 'Controls ▴' : 'Controls';
      });
    }

    // Seek slider
    var seekSlider = document.getElementById('seek-slider');
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

    var btnFull = document.getElementById('btn-export-fullres');
    btnFull.disabled = !(
      _shared.hasVideo &&
      !_shared.isImage &&
      !!(_registry[_active] && _registry[_active].exportFullRes)
    );

    // Close mobile controls panel on tab switch
    closeMobileControls();

    applyZoomTransform();
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

    var blobTab = document.querySelector('.effect-tab[data-tab="blob"]');
    if (blobTab) blobTab.disabled = false;

    _realVideo.onloadedmetadata = function () {
      _shared.hasVideo = true;

      for (var key in _registry) {
        var def = _registry[key];
        if (def.onVideoLoad) def.onVideoLoad(_realVideo, _realVideo.videoWidth, _realVideo.videoHeight);
      }

      document.getElementById('btn-play').disabled    = false;
      document.getElementById('btn-play').textContent = 'Pause';

      var btnFull = document.getElementById('btn-export-fullres');
      btnFull.disabled = !(_registry[_active] && _registry[_active].exportFullRes);

      document.querySelectorAll('.drop-overlay').forEach(function (o) { o.classList.add('hidden'); });

      var seekSlider = document.getElementById('seek-slider');
      seekSlider.disabled = false;
      seekSlider.value    = 0;
      updateSeekDisplay(0, _realVideo.duration);

      VideoEffects.setVideoInfo('');
      var cfb = document.getElementById('btn-change-file');
      if (cfb) cfb.style.display = '';
      _realVideo.play();
    };
  }

  function loadImage(file) {
    _shared.isImage = true;
    var url = URL.createObjectURL(file);
    var img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);

      var imgCanvas      = document.createElement('canvas');
      imgCanvas.width      = img.naturalWidth;
      imgCanvas.height     = img.naturalHeight;
      imgCanvas.getContext('2d').drawImage(img, 0, 0);

      imgCanvas.videoWidth  = img.naturalWidth;
      imgCanvas.videoHeight = img.naturalHeight;
      imgCanvas.readyState  = 4;
      imgCanvas.paused      = false;
      imgCanvas.currentTime = 0;
      imgCanvas.duration    = 0;
      imgCanvas.play        = function () {};
      imgCanvas.pause       = function () {};

      if (!_realVideo.paused) _realVideo.pause();
      _shared.video    = imgCanvas;
      _shared.hasVideo = true;

      var blobTab = document.querySelector('.effect-tab[data-tab="blob"]');
      if (blobTab) {
        blobTab.disabled = true;
        if (_active === 'blob') switchTo('dither');
      }

      for (var key in _registry) {
        var def = _registry[key];
        if (def.onVideoLoad) def.onVideoLoad(imgCanvas, img.naturalWidth, img.naturalHeight);
      }

      document.getElementById('btn-play').disabled    = true;
      document.getElementById('btn-play').textContent = 'Play';
      document.getElementById('btn-export-fullres').disabled = true;

      document.querySelectorAll('.drop-overlay').forEach(function (o) { o.classList.add('hidden'); });

      var seekSlider = document.getElementById('seek-slider');
      seekSlider.disabled = true;
      seekSlider.value    = 0;
      updateSeekDisplay(0, 0);
      VideoEffects.setVideoInfo('');
      var cfb = document.getElementById('btn-change-file');
      if (cfb) cfb.style.display = '';
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
