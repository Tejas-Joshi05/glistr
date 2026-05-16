window.DitherApp = window.DitherApp || {};

DitherApp.defaultState = {
  bitDepth: 4,
  palette: 'monochrome',
  paletteSize: 16,

  algorithm: 'floyd-steinberg',
  errorDiffusionStrength: 1.0,
  bayerMatrixSize: 4,

  threshold: 0,
  patternScale: 1.0,
  anisotropyX: 1.0,
  anisotropyY: 1.0,

  temporalStability: 0.8,
  frameBlending: 0.0,
  noiseSeedSpeed: 1.0,
  refreshRate: 1,

  applyMode: 'luminance',
  bitDepthR: 4,
  bitDepthG: 4,
  bitDepthB: 4,
  shadowIntensity: 1.0,
  midtoneIntensity: 1.0,
  highlightIntensity: 1.0,

  wetDryMix: 1.0,
  preGamma: 1.0,
  postGamma: 1.0,
  colorSpace: 'rgb',
  downscale: 1,

  activePreset: null,
};
