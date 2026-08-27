/**
 * The map tracer's browser shell. Everything that can be wrong in a testable
 * way lives in `trace.mjs` (and is tested from core's own suite,
 * `tests/tools/mapTracer.test.ts`); this file is wiring — load an image,
 * sample colors into classes, run the pipeline on every knob change, paint
 * the overlay, hand over the snippet.
 *
 * Run it with `npx vite tools/map-tracer --open` from the repo root — ES
 * modules do not load over `file://`.
 */
import {
  classifyMask,
  downsampleMask,
  tracePolygons,
  scaleLoops,
  geometrySnippet,
} from './trace.mjs';

const CLASSES = [
  { id: 'wall', tint: [224, 138, 138], stroke: '#ff5252' },
  { id: 'bush', tint: [138, 208, 138], stroke: '#3ddc3d' },
  { id: 'water', tint: [138, 180, 224], stroke: '#4da3ff' },
];

const state = {
  image: null, // { pixels, w, h } at full resolution
  active: 'wall',
  // per class: swatches [[r,g,b]], tolerance
  classes: Object.fromEntries(CLASSES.map(c => [c.id, { swatches: [], tolerance: 48 }])),
  traced: {}, // per class: polygons in full-image pixel coords
};

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
let sourceCanvas = null; // untinted image, for sampling and redraw

/* ------------------------------------------------------------ image load */

const loadImage = file => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = img.width;
    sourceCanvas.height = img.height;
    sourceCanvas.getContext('2d').drawImage(img, 0, 0);
    const data = sourceCanvas.getContext('2d').getImageData(0, 0, img.width, img.height);
    state.image = { pixels: data.data, w: img.width, h: img.height };
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.hidden = false;
    $('drop-hint').hidden = true;
    $('image-info').textContent = `${img.width} × ${img.height}px`;
    retrace();
  };
  img.src = url;
};

$('file').addEventListener('change', event => {
  if (event.target.files[0]) loadImage(event.target.files[0]);
});
document.body.addEventListener('dragover', event => event.preventDefault());
document.body.addEventListener('drop', event => {
  event.preventDefault();
  const file = [...event.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (file) loadImage(file);
});

/* --------------------------------------------------------------- classes */

const tabs = $('tabs');
for (const cls of CLASSES) {
  const button = document.createElement('button');
  button.textContent = cls.id;
  button.dataset.class = cls.id;
  button.addEventListener('click', () => {
    state.active = cls.id;
    renderClassUi();
  });
  tabs.appendChild(button);
}

const renderClassUi = () => {
  for (const button of tabs.children) {
    button.classList.toggle('active', button.dataset.class === state.active);
  }
  const active = state.classes[state.active];
  const box = $('swatches');
  box.innerHTML = '';
  for (let i = 0; i < active.swatches.length; i++) {
    const [r, g, b] = active.swatches[i];
    const chip = document.createElement('button');
    chip.style.background = `rgb(${r},${g},${b})`;
    chip.title = `rgb(${r},${g},${b}) — click to remove`;
    chip.addEventListener('click', () => {
      active.swatches.splice(i, 1);
      renderClassUi();
      retrace();
    });
    box.appendChild(chip);
  }
  $('tolerance').value = active.tolerance;
  $('tolerance-value').textContent = active.tolerance;
};

$('tolerance').addEventListener('input', () => {
  state.classes[state.active].tolerance = Number($('tolerance').value);
  $('tolerance-value').textContent = $('tolerance').value;
  retrace();
});

canvas.addEventListener('click', event => {
  if (!state.image) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.image.w);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * state.image.h);
  const i = (y * state.image.w + x) * 4;
  const { pixels } = state.image;
  state.classes[state.active].swatches.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  renderClassUi();
  retrace();
});

/* ----------------------------------------------------------------- knobs */

const knobs = ['downsample', 'epsilon', 'min-area'];
for (const id of knobs) {
  const show = () => ($(`${id}-value`).textContent = $(id).value);
  $(id).addEventListener('input', () => {
    show();
    retrace();
  });
  show();
}
$('map-size').addEventListener('input', () => retrace());

$('copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('export').value);
});

/* -------------------------------------------------------------- pipeline */

let pending = 0;
const retrace = () => {
  clearTimeout(pending);
  pending = setTimeout(run, 120);
};

const run = () => {
  if (!state.image) return;
  const { pixels, w, h } = state.image;
  const k = Number($('downsample').value);
  const epsilon = Number($('epsilon').value);
  // The min-area knob is in image px²; masks are traced at 1/k so cells are
  // k×k px each.
  const minAreaCells = Number($('min-area').value) / (k * k);

  state.traced = {};
  const tintedMasks = [];
  for (const cls of CLASSES) {
    const { swatches, tolerance } = state.classes[cls.id];
    if (swatches.length === 0) continue;
    const full = classifyMask(pixels, w * h, swatches, tolerance);
    tintedMasks.push({ cls, mask: full });
    const down = k > 1 ? downsampleMask(full, w, h, k) : { mask: full, w, h };
    const polygons = tracePolygons(down.mask, down.w, down.h, {
      epsilon: epsilon / k,
      minArea: Math.max(1, minAreaCells),
    });
    // Back to full-image pixel coordinates for the preview.
    state.traced[cls.id] = scaleLoops(polygons, k, false);
  }
  paint(tintedMasks);
  exportSnippet();
};

const paint = tintedMasks => {
  ctx.drawImage(sourceCanvas, 0, 0);
  const { w, h } = state.image;
  if (tintedMasks.length > 0) {
    const overlay = ctx.getImageData(0, 0, w, h);
    for (const { cls, mask } of tintedMasks) {
      const [tr, tg, tb] = cls.tint;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        overlay.data[i * 4] = (overlay.data[i * 4] + tr * 2) / 3;
        overlay.data[i * 4 + 1] = (overlay.data[i * 4 + 1] + tg * 2) / 3;
        overlay.data[i * 4 + 2] = (overlay.data[i * 4 + 2] + tb * 2) / 3;
      }
    }
    ctx.putImageData(overlay, 0, 0);
  }
  for (const cls of CLASSES) {
    const polygons = state.traced[cls.id];
    if (!polygons) continue;
    ctx.strokeStyle = cls.stroke;
    ctx.lineWidth = Math.max(1, state.image.w / 600);
    for (const polygon of polygons) {
      ctx.beginPath();
      for (const p of polygon) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.stroke();
    }
  }
};

const exportSnippet = () => {
  const { w, h } = state.image;
  const mapSize = Number($('map-size').value) || 6400;
  // The image's larger dimension spans the whole map.
  const factor = mapSize / Math.max(w, h);
  const scaled = {};
  const stats = [];
  for (const cls of CLASSES) {
    const polygons = state.traced[cls.id] ?? [];
    scaled[cls.id] = scaleLoops(polygons, factor);
    const vertices = polygons.reduce((sum, polygon) => sum + polygon.length, 0);
    if (polygons.length > 0) stats.push(`${cls.id}: ${polygons.length} polygons, ${vertices} pts`);
  }
  $('stats').textContent = stats.join(' · ') || 'sample a color to start';
  $('export').value = geometrySnippet(scaled);
};
