window.DitherApp = window.DitherApp || {};

DitherApp.PRESETS = {
  'game-boy': {
    label: 'Game Boy',
    state: {
      bitDepth: 1, palette: 'green-2bit', algorithm: 'bayer',
      bayerMatrixSize: 4, applyMode: 'luminance', patternScale: 1.0,
      anisotropyX: 1.0, anisotropyY: 1.0, activePreset: 'game-boy',
    },
  },
  'cga': {
    label: 'CGA',
    state: {
      bitDepth: 2, palette: 'cga', algorithm: 'floyd-steinberg',
      errorDiffusionStrength: 1.0, applyMode: 'per-channel',
      activePreset: 'cga',
    },
  },
  'newspaper': {
    label: '1-bit Newspaper',
    state: {
      bitDepth: 1, palette: 'monochrome', algorithm: 'atkinson',
      applyMode: 'luminance', anisotropyX: 2.5, anisotropyY: 1.0,
      patternScale: 1.0, activePreset: 'newspaper',
    },
  },
  'web-gif': {
    label: 'Early Web GIF',
    state: {
      bitDepth: 8, palette: 'web-safe', paletteSize: 256,
      algorithm: 'floyd-steinberg', errorDiffusionStrength: 1.0,
      applyMode: 'per-channel', activePreset: 'web-gif',
    },
  },
  'vhs': {
    label: 'VHS Noise',
    state: {
      algorithm: 'random', noiseSeedSpeed: 8.0, temporalStability: 0.1,
      frameBlending: 0.2, patternScale: 1.5, applyMode: 'luminance',
      bitDepth: 3, activePreset: 'vhs',
    },
  },
  'pixel': {
    label: 'Clean Pixel',
    state: {
      algorithm: 'bayer', bayerMatrixSize: 8, refreshRate: 0,
      bitDepth: 4, frameBlending: 0.0, applyMode: 'luminance',
      patternScale: 1.0, activePreset: 'pixel',
    },
  },
};

DitherApp.applyPreset = function(name) {
  const preset = DitherApp.PRESETS[name];
  if (!preset) return { ...DitherApp.defaultState };
  return { ...DitherApp.defaultState, ...preset.state };
};
