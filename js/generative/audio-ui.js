/* ══ Audio bar ════════════════════════════════════════════════════════════
   The one place audio is set up: pick a source, see the bands and the beat,
   set sensitivity. Routing itself happens on the parameters — the ∿ chip
   beside any slider in the controls panel.                                  */

(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    const dock    = document.getElementById('audio-dock');
    const toggle  = document.getElementById('btn-audio');
    if (!dock || !toggle) return;

    const srcBtns = dock.querySelectorAll('.audio-src');
    const fileRow = document.getElementById('audio-file-row');
    const fileName = document.getElementById('audio-file-name');
    const filePlay = document.getElementById('audio-file-play');
    const status  = document.getElementById('audio-status');
    const beatDot = document.getElementById('audio-beat');
    const bpmEl   = document.getElementById('audio-bpm');
    const gainIn  = document.getElementById('audio-gain');
    const smoothIn = document.getElementById('audio-smooth');
    const bars = {
      bass: document.querySelector('#audio-bar-bass i'),
      mid:  document.querySelector('#audio-bar-mid i'),
      high: document.querySelector('#audio-bar-high i'),
    };

    // ── Open / close ───────────────────────────────────────────────────────

    function setOpen(open) {
      dock.classList.toggle('audio-dock--open', open);
      toggle.classList.toggle('btn--active', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    toggle.addEventListener('click', function () {
      setOpen(!dock.classList.contains('audio-dock--open'));
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setOpen(false);
    });

    document.getElementById('audio-close').addEventListener('click', function () {
      setOpen(false);
    });

    // ── Source selection ───────────────────────────────────────────────────

    srcBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const src = btn.dataset.src;
        if (src === 'mic')       GenAudio.useMic();
        else if (src === 'file') Generative.pickAudioFile();
        else                     GenAudio.stop();
        syncSource();
      });
    });

    filePlay.addEventListener('click', function () {
      GenAudio.togglePlayback();
      filePlay.textContent = GenAudio.isPlaying() ? 'Pause' : 'Play';
    });

    gainIn.value = GenAudio.gain;
    gainIn.addEventListener('input', function () {
      GenAudio.gain = parseFloat(gainIn.value);
    });

    smoothIn.value = GenAudio.smoothing;
    smoothIn.addEventListener('input', function () {
      GenAudio.smoothing = parseFloat(smoothIn.value);
    });

    // ── State sync ─────────────────────────────────────────────────────────

    function syncSource() {
      const src = GenAudio.source;
      srcBtns.forEach(function (b) {
        b.classList.toggle('active', b.dataset.src === src);
      });
      fileRow.style.display = src === 'file' ? '' : 'none';
      fileName.textContent  = GenAudio.fileName || '';
      filePlay.textContent  = GenAudio.isPlaying() ? 'Pause' : 'Play';

      if (GenAudio.error)        status.textContent = GenAudio.error;
      else if (src === 'mic')    status.textContent = 'Listening to the microphone.';
      else if (src === 'file')   status.textContent = 'Playing through your speakers while it drives the visuals.';
      else                       status.textContent = 'Pick a source, then tap the \u223f beside any slider to route it.';
      status.classList.toggle('audio-status--error', !!GenAudio.error);

      dock.classList.toggle('audio-dock--live', GenAudio.isActive());
      if (!GenAudio.isActive()) {
        bpmEl.textContent = '—';
        for (const k in bars) bars[k].style.height = '0%';
      }
    }

    GenAudio.onChange(syncSource);
    syncSource();

    // ── Live meters ────────────────────────────────────────────────────────

    let lastBeat = -1;
    GenAudio.onFrame(function (b) {
      bars.bass.style.height = (b.bass * 100).toFixed(0) + '%';
      bars.mid.style.height  = (b.mid  * 100).toFixed(0) + '%';
      bars.high.style.height = (b.high * 100).toFixed(0) + '%';
      beatDot.style.opacity  = (0.22 + b.beat * 0.78).toFixed(2);
      beatDot.style.transform = 'scale(' + (1 + b.beat * 0.45).toFixed(2) + ')';

      if (GenAudio.beatCount !== lastBeat) {
        lastBeat = GenAudio.beatCount;
        bpmEl.textContent = GenAudio.bpm ? GenAudio.bpm + ' BPM' : '…';
      }

      // Compact meter on the toolbar button, for when the dock is closed
      VideoEffects.setAudioMeter(b, GenAudio.isActive());
    });
  });
})();
