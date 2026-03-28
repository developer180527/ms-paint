// =============================================
//  MS Paint Clone — main.js
//  All drawing logic, tools, undo/redo, etc.
// =============================================

// ── Canvas Setup ─────────────────────────────
const mainCanvas  = document.getElementById('main-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const ctx  = mainCanvas.getContext('2d', { willReadFrequently: true });
const octx = overlayCanvas.getContext('2d');

let CANVAS_W = 900;
let CANVAS_H = 600;

function setCanvasSize(w, h) {
  // Save existing image
  const tmp = document.createElement('canvas');
  tmp.width = mainCanvas.width; tmp.height = mainCanvas.height;
  tmp.getContext('2d').drawImage(mainCanvas, 0, 0);

  mainCanvas.width  = w; mainCanvas.height  = h;
  overlayCanvas.width = w; overlayCanvas.height = h;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);

  document.getElementById('status-size').textContent = `${w} × ${h}px`;
}

setCanvasSize(CANVAS_W, CANVAS_H);

// ── State ─────────────────────────────────────
let tool       = 'pencil';
let brushStyle = 'round';
let activeShape = null;
let color1     = '#000000';   // foreground
let color2     = '#ffffff';   // background
let brushSize  = 3;
let zoom       = 1.0;

let isDrawing  = false;
let startX = 0, startY = 0;
let lastX  = 0, lastY  = 0;

// Undo/Redo stacks (ImageData snapshots)
const undoStack = [];
const redoStack = [];
const MAX_UNDO  = 40;

// Selection
let selection = null; // { x, y, w, h }
let selectionData = null;
let isDraggingSelection = false;
let selDragOffX = 0, selDragOffY = 0;

// Text tool
let textPos = null;

// ── Color Palette ─────────────────────────────
const PALETTE = [
  '#000000','#808080','#800000','#808000','#008000','#008080','#000080','#800080',
  '#ffffff','#c0c0c0','#ff0000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff',
  '#ff8040','#804000','#80ff00','#004040','#0080ff','#8000ff','#ff0080','#ff8080',
  '#ffd700','#40e0d0','#87ceeb','#dda0dd','#f08080','#98fb98','#ffe4b5','#b0c4de',
];

function buildPalette() {
  const grid = document.getElementById('palette-grid');
  PALETTE.forEach(hex => {
    const s = document.createElement('div');
    s.className = 'palette-swatch';
    s.style.background = hex;
    s.title = hex;
    s.addEventListener('click',       () => setColor1(hex));
    s.addEventListener('contextmenu', e => { e.preventDefault(); setColor2(hex); });
    grid.appendChild(s);
  });
}

function setColor1(hex) {
  color1 = hex;
  document.getElementById('color1-swatch').style.background = hex;
}

function setColor2(hex) {
  color2 = hex;
  document.getElementById('color2-swatch').style.background = hex;
}

buildPalette();

// Color swatch clicks
document.getElementById('color1-swatch').addEventListener('click', () => openColorPicker(1));
document.getElementById('color2-swatch').addEventListener('click', () => openColorPicker(2));
document.getElementById('edit-colors-btn').addEventListener('click', () => openColorPicker(1));

const colorInput = document.getElementById('custom-color-input');
let colorPickerTarget = 1;

function openColorPicker(target) {
  colorPickerTarget = target;
  colorInput.value = target === 1 ? color1 : color2;
  colorInput.click();
}

colorInput.addEventListener('input', e => {
  if (colorPickerTarget === 1) setColor1(e.target.value);
  else setColor2(e.target.value);
});

// ── Tool Selection ─────────────────────────────
document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    tool = btn.dataset.tool;
    activeShape = null;
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
    updateCursor();
    commitTextInput();
  });
});

document.querySelectorAll('.shape-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    tool = 'shape';
    activeShape = btn.dataset.shape;
    updateCursor();
  });
});

document.querySelectorAll('.brush-style-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.brush-style-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    brushStyle = btn.dataset.brush;
  });
});

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    brushSize = parseInt(btn.dataset.size);
    document.getElementById('brush-size').value = brushSize;
    document.getElementById('brush-size-label').textContent = brushSize + 'px';
  });
});

const brushSizeSlider = document.getElementById('brush-size');
brushSizeSlider.addEventListener('input', e => {
  brushSize = parseInt(e.target.value);
  document.getElementById('brush-size-label').textContent = brushSize + 'px';
});

function updateCursor() {
  const vp = document.getElementById('canvas-viewport');
  vp.className = 'canvas-viewport';
  const map = {
    pencil: 'cursor-pencil', brush: 'cursor-pencil',
    eraser: 'cursor-eraser', fill: 'cursor-fill',
    picker: 'cursor-picker', text: 'cursor-text',
    shape: 'cursor-crosshair', zoom: 'cursor-crosshair',
    'select-rect': 'cursor-crosshair',
  };
  if (map[tool]) vp.classList.add(map[tool]);
}

// ── Undo / Redo ────────────────────────────────
function saveState() {
  if (undoStack.length >= MAX_UNDO) undoStack.shift();
  undoStack.push(ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height));
  redoStack.length = 0;
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height));
  ctx.putImageData(undoStack.pop(), 0, 0);
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height));
  ctx.putImageData(redoStack.pop(), 0, 0);
}

// ── Canvas Coordinates ─────────────────────────
function getCanvasPos(e) {
  const rect = mainCanvas.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - rect.left) / zoom),
    y: Math.floor((e.clientY - rect.top)  / zoom),
  };
}

// ── Drawing Core ───────────────────────────────
function applyZoom() {
  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.style.transform = `scale(${zoom})`;
  wrapper.style.transformOrigin = 'top left';
}

function beginPath(x, y) {
  ctx.beginPath();
  ctx.moveTo(x, y);
}

function drawBrushDot(x, y, color, size, style) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (style) {
    case 'round':
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      break;
    case 'calligraphy1':
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-size, -1, size * 2, 2);
      ctx.restore();
      break;
    case 'calligraphy2':
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 4);
      ctx.fillRect(-size, -1, size * 2, 2);
      ctx.restore();
      break;
    case 'spray':
      for (let i = 0; i < 30; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * size * 2;
        ctx.fillRect(x + r * Math.cos(angle), y + r * Math.sin(angle), 1, 1);
      }
      break;
    case 'watercolor':
      ctx.globalAlpha = 0.1;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(x + (Math.random() - 0.5) * size, y + (Math.random() - 0.5) * size, size * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
  }
  ctx.restore();
}

function drawLine(x1, y1, x2, y2, color, size, style) {
  if (style === 'round') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  } else {
    // Interpolate dots for non-round brushes
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const steps = Math.max(1, Math.floor(dist));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      drawBrushDot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, color, size, style);
    }
  }
}

// ── Flood Fill ─────────────────────────────────
function floodFill(startX, startY, fillColor) {
  const imageData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
  const data = imageData.data;

  const toIdx = (x, y) => (y * mainCanvas.width + x) * 4;

  const sr = data[toIdx(startX, startY)];
  const sg = data[toIdx(startX, startY) + 1];
  const sb = data[toIdx(startX, startY) + 2];
  const sa = data[toIdx(startX, startY) + 3];

  const fc = hexToRgb(fillColor);
  if (!fc) return;

  if (sr === fc.r && sg === fc.g && sb === fc.b && sa === 255) return;

  const tolerance = 30;

  function matchesTarget(idx) {
    return Math.abs(data[idx]   - sr) <= tolerance &&
           Math.abs(data[idx+1] - sg) <= tolerance &&
           Math.abs(data[idx+2] - sb) <= tolerance &&
           Math.abs(data[idx+3] - sa) <= tolerance;
  }

  function setPixel(idx) {
    data[idx]   = fc.r;
    data[idx+1] = fc.g;
    data[idx+2] = fc.b;
    data[idx+3] = 255;
  }

  const stack = [[startX, startY]];
  const visited = new Uint8Array(mainCanvas.width * mainCanvas.height);

  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= mainCanvas.width || cy >= mainCanvas.height) continue;
    const vi = cy * mainCanvas.width + cx;
    if (visited[vi]) continue;
    visited[vi] = 1;

    const idx = toIdx(cx, cy);
    if (!matchesTarget(idx)) continue;

    setPixel(idx);
    stack.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
  }

  ctx.putImageData(imageData, 0, 0);
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return { r, g, b };
}

// ── Color Picker ───────────────────────────────
function pickColor(x, y, button) {
  const p = ctx.getImageData(x, y, 1, 1).data;
  const hex = `#${p[0].toString(16).padStart(2,'0')}${p[1].toString(16).padStart(2,'0')}${p[2].toString(16).padStart(2,'0')}`;
  if (button === 2) setColor2(hex);
  else              setColor1(hex);
}

// ── Shape Drawing (overlay) ────────────────────
function drawShape(shape, x1, y1, x2, y2, canvasCtx, strokeColor, fillColor, lineWidth, shift) {
  canvasCtx.save();
  canvasCtx.strokeStyle = strokeColor;
  canvasCtx.fillStyle   = fillColor || 'transparent';
  canvasCtx.lineWidth   = lineWidth;
  canvasCtx.lineCap     = 'round';
  canvasCtx.lineJoin    = 'round';
  canvasCtx.beginPath();

  const w = x2 - x1;
  const h = y2 - y1;

  if (shift) {
    // Constrain to square/circle
    const size = Math.min(Math.abs(w), Math.abs(h));
    // keep direction sign
  }

  switch (shape) {
    case 'line':
      canvasCtx.moveTo(x1, y1);
      if (shift) {
        const angle = Math.round(Math.atan2(h, w) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(w, h);
        canvasCtx.lineTo(x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len);
      } else {
        canvasCtx.lineTo(x2, y2);
      }
      canvasCtx.stroke();
      break;

    case 'rect':
      if (shift) {
        const s = Math.min(Math.abs(w), Math.abs(h)) * Math.sign(w);
        const sv = Math.min(Math.abs(w), Math.abs(h)) * Math.sign(h);
        canvasCtx.strokeRect(x1, y1, s, sv);
      } else {
        canvasCtx.strokeRect(x1, y1, w, h);
      }
      break;

    case 'round-rect':
      const rw = shift ? Math.min(Math.abs(w), Math.abs(h)) * Math.sign(w) : w;
      const rh = shift ? Math.min(Math.abs(w), Math.abs(h)) * Math.sign(h) : h;
      const r = Math.min(10, Math.abs(rw) / 4, Math.abs(rh) / 4);
      canvasCtx.roundRect(x1, y1, rw, rh, r);
      canvasCtx.stroke();
      break;

    case 'ellipse': {
      const ew = shift ? Math.min(Math.abs(w), Math.abs(h)) * Math.sign(w) : w;
      const eh = shift ? Math.min(Math.abs(w), Math.abs(h)) * Math.sign(h) : h;
      canvasCtx.ellipse(x1 + ew/2, y1 + eh/2, Math.abs(ew/2), Math.abs(eh/2), 0, 0, Math.PI * 2);
      canvasCtx.stroke();
      break;
    }

    case 'triangle': {
      canvasCtx.moveTo(x1 + w / 2, y1);
      canvasCtx.lineTo(x2, y2);
      canvasCtx.lineTo(x1, y2);
      canvasCtx.closePath();
      canvasCtx.stroke();
      break;
    }

    case 'right-triangle': {
      canvasCtx.moveTo(x1, y1);
      canvasCtx.lineTo(x1, y2);
      canvasCtx.lineTo(x2, y2);
      canvasCtx.closePath();
      canvasCtx.stroke();
      break;
    }

    case 'diamond': {
      const cx = x1 + w / 2, cy = y1 + h / 2;
      canvasCtx.moveTo(cx, y1);
      canvasCtx.lineTo(x2, cy);
      canvasCtx.lineTo(cx, y2);
      canvasCtx.lineTo(x1, cy);
      canvasCtx.closePath();
      canvasCtx.stroke();
      break;
    }

    case 'pentagon': {
      const pcx = x1 + w / 2, pcy = y1 + h / 2;
      const pr = Math.min(Math.abs(w), Math.abs(h)) / 2;
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
        if (i === 0) canvasCtx.moveTo(pcx + pr * Math.cos(a), pcy + pr * Math.sin(a));
        else         canvasCtx.lineTo(pcx + pr * Math.cos(a), pcy + pr * Math.sin(a));
      }
      canvasCtx.closePath();
      canvasCtx.stroke();
      break;
    }

    case 'arrow': {
      const aw = w, ah = h;
      const hw = Math.abs(aw) * 0.4, hh = Math.abs(ah) * 0.4;
      canvasCtx.moveTo(x1, y1 + ah / 2);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, y1 + ah / 2);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, y1 + ah / 2 - hh);
      canvasCtx.lineTo(x2, y1 + ah / 2 + 0);
      canvasCtx.moveTo(x2, y1 + ah / 2);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, y1 + ah / 2 + hh);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, y1 + ah / 2);
      canvasCtx.moveTo(x1, y1 + ah / 2);
      canvasCtx.stroke();
      // Redraw properly
      canvasCtx.beginPath();
      const shaft_y1 = y1 + ah / 2 - Math.abs(ah) * 0.15;
      const shaft_y2 = y1 + ah / 2 + Math.abs(ah) * 0.15;
      canvasCtx.moveTo(x1, shaft_y1);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, shaft_y1);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, y1 + ah / 2 - hh);
      canvasCtx.lineTo(x2, y1 + ah / 2);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, y1 + ah / 2 + hh);
      canvasCtx.lineTo(x2 - Math.sign(aw) * hw, shaft_y2);
      canvasCtx.lineTo(x1, shaft_y2);
      canvasCtx.closePath();
      canvasCtx.stroke();
      break;
    }

    case 'curve': {
      const cpx = x1 + w * 0.5, cpy = y1 - Math.abs(h) * 0.5;
      canvasCtx.moveTo(x1, y1);
      canvasCtx.quadraticCurveTo(cpx, cpy, x2, y2);
      canvasCtx.stroke();
      break;
    }
  }

  canvasCtx.restore();
}

// ── Text Tool ──────────────────────────────────
const textInput = document.getElementById('text-input');

function placeTextInput(x, y) {
  textPos = { x, y };
  textInput.style.display = 'block';
  textInput.style.left  = x + 'px';
  textInput.style.top   = y + 'px';
  textInput.style.color = color1;
  textInput.style.fontSize = Math.max(brushSize * 3, 12) + 'px';
  textInput.value = '';
  textInput.style.width  = '150px';
  textInput.style.height = '30px';
  textInput.focus();
}

function commitTextInput() {
  if (textInput.style.display === 'none') return;
  const text = textInput.value;
  if (text && textPos) {
    saveState();
    ctx.save();
    ctx.fillStyle = color1;
    ctx.font = `${Math.max(brushSize * 3, 12)}px Arial`;
    // Draw each line
    const lines = text.split('\n');
    const lineH  = Math.max(brushSize * 3, 12) + 4;
    lines.forEach((line, i) => ctx.fillText(line, textPos.x, textPos.y + lineH * (i + 1)));
    ctx.restore();
  }
  textInput.style.display = 'none';
  textPos = null;
}

textInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { textInput.style.display = 'none'; textPos = null; }
});

// ── Selection ──────────────────────────────────
const selBox = document.getElementById('selection-box');

function showSelectionBox(x, y, w, h) {
  selBox.style.display = 'block';
  selBox.style.left   = (Math.min(x, x + w)) * zoom + 'px';
  selBox.style.top    = (Math.min(y, y + h)) * zoom + 'px';
  selBox.style.width  = Math.abs(w) * zoom + 'px';
  selBox.style.height = Math.abs(h) * zoom + 'px';
}

function hideSelectionBox() {
  selBox.style.display = 'none';
  selection = null;
  selectionData = null;
}

// ── Mouse Events ───────────────────────────────
overlayCanvas.style.pointerEvents = 'auto'; // overlay takes mouse events

const eventTarget = overlayCanvas;

eventTarget.addEventListener('mousedown', onMouseDown);
eventTarget.addEventListener('mousemove', onMouseMove);
eventTarget.addEventListener('mouseup',   onMouseUp);
eventTarget.addEventListener('mouseleave',onMouseLeave);
eventTarget.addEventListener('contextmenu', e => e.preventDefault());

function onMouseDown(e) {
  const pos = getCanvasPos(e);
  const btn = e.button; // 0=left, 2=right
  const drawColor = btn === 2 ? color2 : color1;

  startX = pos.x; startY = pos.y;
  lastX  = pos.x; lastY  = pos.y;

  switch (tool) {
    case 'pencil':
    case 'brush':
      saveState();
      isDrawing = true;
      drawBrushDot(pos.x, pos.y, drawColor, brushSize, brushStyle);
      break;

    case 'eraser':
      saveState();
      isDrawing = true;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      drawBrushDot(pos.x, pos.y, 'rgba(0,0,0,1)', brushSize * 2, 'square');
      ctx.restore();
      break;

    case 'fill':
      saveState();
      floodFill(pos.x, pos.y, drawColor);
      break;

    case 'picker':
      pickColor(pos.x, pos.y, btn);
      break;

    case 'text':
      commitTextInput();
      placeTextInput(pos.x, pos.y);
      break;

    case 'zoom':
      if (btn === 2) zoom = Math.max(0.1, zoom / 2);
      else           zoom = Math.min(8,   zoom * 2);
      setZoom(zoom);
      break;

    case 'shape':
      saveState();
      isDrawing = true;
      break;

    case 'select-rect':
      commitSelection();
      hideSelectionBox();
      isDrawing = true;
      break;
  }
}

function onMouseMove(e) {
  const pos = getCanvasPos(e);
  document.getElementById('status-coords').textContent = `${pos.x}, ${pos.y}px`;

  const btn = e.buttons === 2 ? 2 : 0;
  const drawColor = btn === 2 ? color2 : color1;

  if (!isDrawing) return;

  switch (tool) {
    case 'pencil':
    case 'brush':
      drawLine(lastX, lastY, pos.x, pos.y, drawColor, brushSize, brushStyle);
      lastX = pos.x; lastY = pos.y;
      break;

    case 'eraser':
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      drawLine(lastX, lastY, pos.x, pos.y, 'rgba(0,0,0,1)', brushSize * 2, 'square');
      ctx.restore();
      // Also fill with bg color
      ctx.save();
      ctx.strokeStyle = color2;
      ctx.lineWidth = brushSize * 2;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'square';
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();
      lastX = pos.x; lastY = pos.y;
      break;

    case 'shape': {
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      const drawColor2 = e.buttons === 2 ? color1 : color2;
      drawShape(activeShape, startX, startY, pos.x, pos.y, octx, drawColor, null, brushSize, e.shiftKey);
      break;
    }

    case 'select-rect':
      showSelectionBox(startX, startY, pos.x - startX, pos.y - startY);
      // Draw overlay
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      octx.save();
      octx.setLineDash([4, 4]);
      octx.strokeStyle = '#000';
      octx.lineWidth = 1;
      octx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
      octx.restore();
      break;
  }
}

function onMouseUp(e) {
  const pos = getCanvasPos(e);
  const btn = e.button;
  const drawColor = btn === 2 ? color2 : color1;

  if (!isDrawing) return;
  isDrawing = false;

  switch (tool) {
    case 'shape':
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      drawShape(activeShape, startX, startY, pos.x, pos.y, ctx, drawColor, null, brushSize, e.shiftKey);
      break;

    case 'select-rect':
      selection = {
        x: Math.min(startX, pos.x),
        y: Math.min(startY, pos.y),
        w: Math.abs(pos.x - startX),
        h: Math.abs(pos.y - startY),
      };
      if (selection.w < 2 || selection.h < 2) { hideSelectionBox(); return; }
      selectionData = ctx.getImageData(selection.x, selection.y, selection.w, selection.h);
      break;
  }
}

function onMouseLeave() {
  if (isDrawing && (tool === 'shape')) {
    octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
}

function commitSelection() {
  if (selectionData && selection) {
    ctx.putImageData(selectionData, selection.x, selection.y);
  }
  hideSelectionBox();
  octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

// ── Zoom ───────────────────────────────────────
const zoomSlider = document.getElementById('zoom-slider');
const zoomLabel  = document.getElementById('zoom-label');

function setZoom(z) {
  zoom = Math.min(8, Math.max(0.1, z));
  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.style.transform = `scale(${zoom})`;
  wrapper.style.transformOrigin = 'top left';
  // Adjust wrapper size so scrollbars work
  wrapper.style.width  = (mainCanvas.width  * zoom) + 'px';
  wrapper.style.height = (mainCanvas.height * zoom) + 'px';
  zoomSlider.value = Math.round(zoom * 100);
  zoomLabel.textContent = Math.round(zoom * 100) + '%';
}

zoomSlider.addEventListener('input', () => setZoom(zoomSlider.value / 100));
document.getElementById('zoom-in-btn').addEventListener('click', () => setZoom(zoom * 1.25));
document.getElementById('zoom-out-btn').addEventListener('click', () => setZoom(zoom / 1.25));

// ── Keyboard Shortcuts ─────────────────────────
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;

  // Don't fire shortcuts when typing in any input, textarea or modal
  const tag = document.activeElement.tagName.toLowerCase();
  const inModal = document.activeElement.closest('.modal-overlay');

  if (tag === 'input' || tag === 'textarea' || tag === 'select' || inModal) return;
  if (ctrl && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (ctrl && e.key === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key === 'n') { e.preventDefault(); newCanvas(); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveImage(); return; }
  if (ctrl && e.key === 'o') { e.preventDefault(); openImage(); return; }
  if (ctrl && e.key === 'a') { e.preventDefault(); selectAll(); return; }
  if (e.key === 'Escape') { commitTextInput(); hideSelectionBox(); }

  // Tool shortcuts
  const toolKeys = { p: 'pencil', b: 'brush', e: 'eraser', f: 'fill', t: 'text', k: 'picker', z: 'zoom', s: 'select-rect' };
  if (!ctrl && toolKeys[e.key]) {
    tool = toolKeys[e.key];
    activeShape = null;
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
    updateCursor();
  }
});

// ── File Operations ────────────────────────────
function newCanvas() {
  openNewCanvasDialog();
  document.getElementById('new-filename').value = 'Untitled';
}

// ── New Canvas Dialog ─────────────────────────
const PRESETS = {
  'custom':      null,
  '900x600':     [900,  600],
  '1920x1080':   [1920, 1080],
  '3840x2160':   [3840, 2160],
  '1080x1080':   [1080, 1080],
  '2480x3508':   [2480, 3508],
  '3508x2480':   [3508, 2480],
  '800x600':     [800,  600],
};

let _newBg          = 'white';
let _newAspectRatio = null;   // stores W/H ratio when lock is on

function openNewCanvasDialog() {
  // Reset to defaults
  document.getElementById('new-preset').value  = '900x600';
  document.getElementById('new-width').value   = 900;
  document.getElementById('new-height').value  = 600;
  document.getElementById('new-lock-ratio').checked = false;
  document.querySelector('input[name="new-orientation"][value="portrait"]').checked = true;
  _newBg = 'white';
  _newAspectRatio = null;
  document.querySelectorAll('.new-bg-btn').forEach(b => {
    b.style.border = b.dataset.bg === 'white' ? '2px solid #6daee0' : '1px solid #ccc';
  });
  _updateNewPreview();
  document.getElementById('new-canvas-modal').style.display = 'flex';
}

function _updateNewPreview() {
  const w = parseInt(document.getElementById('new-width').value)  || 900;
  const h = parseInt(document.getElementById('new-height').value) || 600;

  // Aspect-fit into 80x54 preview box
  const scale  = Math.min(78 / w, 52 / h);
  const pw     = Math.round(w * scale);
  const ph     = Math.round(h * scale);

  const inner  = document.getElementById('new-canvas-preview-inner');
  const info   = document.getElementById('new-canvas-info');

  inner.style.width  = pw + 'px';
  inner.style.height = ph + 'px';
  inner.style.margin = 'auto';

  if (_newBg === 'white') {
    inner.style.background = '#ffffff';
  } else if (_newBg === 'black') {
    inner.style.background = '#000000';
  } else if (_newBg === 'transparent') {
    inner.style.background = 'repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 0 0 / 8px 8px';
  } else {
    inner.style.background = _newBg;
  }

  info.textContent = w + ' × ' + h + ' px';
}

// ── Preset change ─────────────────────────────
document.getElementById('new-preset').addEventListener('change', e => {
  const val = e.target.value;
  if (val === 'custom') return;
  const [w, h] = PRESETS[val];
  const orientation = document.querySelector('input[name="new-orientation"]:checked').value;
  document.getElementById('new-width').value  = orientation === 'landscape' ? Math.max(w,h) : Math.min(w,h);
  document.getElementById('new-height').value = orientation === 'landscape' ? Math.min(w,h) : Math.max(w,h);
  if (document.getElementById('new-lock-ratio').checked) {
    _newAspectRatio = parseInt(document.getElementById('new-width').value) /
                     parseInt(document.getElementById('new-height').value);
  }
  _updateNewPreview();
});

// ── Orientation toggle ────────────────────────
document.querySelectorAll('input[name="new-orientation"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const w = parseInt(document.getElementById('new-width').value);
    const h = parseInt(document.getElementById('new-height').value);
    if (radio.value === 'landscape' && w < h) {
      document.getElementById('new-width').value  = h;
      document.getElementById('new-height').value = w;
    } else if (radio.value === 'portrait' && w > h) {
      document.getElementById('new-width').value  = h;
      document.getElementById('new-height').value = w;
    }
    _updateNewPreview();
  });
});

// ── Swap W / H ────────────────────────────────
document.getElementById('new-swap-btn').addEventListener('click', () => {
  const w = document.getElementById('new-width').value;
  const h = document.getElementById('new-height').value;
  document.getElementById('new-width').value  = h;
  document.getElementById('new-height').value = w;
  _updateNewPreview();
});

// ── Aspect ratio lock ─────────────────────────
document.getElementById('new-lock-ratio').addEventListener('change', e => {
  if (e.target.checked) {
    const w = parseInt(document.getElementById('new-width').value);
    const h = parseInt(document.getElementById('new-height').value);
    _newAspectRatio = w / h;
  } else {
    _newAspectRatio = null;
  }
});

document.getElementById('new-width').addEventListener('input', () => {
  if (_newAspectRatio) {
    const w = parseInt(document.getElementById('new-width').value) || 1;
    document.getElementById('new-height').value = Math.round(w / _newAspectRatio);
  }
  document.getElementById('new-preset').value = 'custom';
  _updateNewPreview();
});

document.getElementById('new-height').addEventListener('input', () => {
  if (_newAspectRatio) {
    const h = parseInt(document.getElementById('new-height').value) || 1;
    document.getElementById('new-width').value = Math.round(h * _newAspectRatio);
  }
  document.getElementById('new-preset').value = 'custom';
  _updateNewPreview();
});

// ── Background buttons ────────────────────────
document.querySelectorAll('.new-bg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    _newBg = btn.dataset.bg;
    document.querySelectorAll('.new-bg-btn').forEach(b => {
      b.style.border = '1px solid #ccc';
    });
    btn.style.border = '2px solid #6daee0';
    _updateNewPreview();
  });
});

document.getElementById('new-bg-color').addEventListener('input', e => {
  _newBg = e.target.value;
  document.querySelectorAll('.new-bg-btn').forEach(b => b.style.border = '1px solid #ccc');
  document.getElementById('new-bg-custom-label').style.border = '2px solid #6daee0';
  _updateNewPreview();
});

// ── Cancel ────────────────────────────────────
document.getElementById('new-canvas-cancel').addEventListener('click', () => {
  document.getElementById('new-canvas-modal').style.display = 'none';
});

// ── Create ────────────────────────────────────
document.getElementById('new-canvas-ok').addEventListener('click', () => {
  const w = parseInt(document.getElementById('new-width').value);
  const h = parseInt(document.getElementById('new-height').value);
  if (!w || !h || w < 1 || h < 1) return;

  saveState();
  setCanvasSize(w, h);

  // Fill background
  if (_newBg === 'transparent') {
    ctx.clearRect(0, 0, w, h);
  } else if (_newBg === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  } else if (_newBg === 'black') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = _newBg;
    ctx.fillRect(0, 0, w, h);
  }

  _currentFilePath = null;
  const filename = document.getElementById('new-filename').value.trim() || 'Untitled';
  setTitleFilename(filename);
  setZoom(1);
  document.getElementById('new-canvas-modal').style.display = 'none';
});

function openImage() {
  document.getElementById('open-file-input').click();
}

document.getElementById('open-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    saveState();
    setCanvasSize(img.width, img.height);
    ctx.drawImage(img, 0, 0);
    setZoom(1);
    setTitleFilename(file.name);
    URL.revokeObjectURL(url);
  };
  img.src = url;
  e.target.value = '';
});



// ── Current file path (set after first Save As) ─
let _currentFilePath = null;

// ── Update title bar filename display ─────────
function setTitleFilename(name) {
  const el = document.getElementById('title-filename');
  if (el) el.textContent = name + ' - Paint';
}

// ── Ctrl+S: save to known path or open dialog ─
async function saveImage() {
  if (_currentFilePath && window.__TAURI__) {
    await _writeToDisk(_currentFilePath);
  } else {
    await saveAs();
  }
}

// ── Save As: native OS dialog ─────────────────
async function saveAs() {

  function _getCurrentFilename() {
  const titleEl = document.getElementById('title-filename');
  if (!titleEl) return 'untitled.png';

  // Strip " - Paint" suffix to get just the name
  const name = titleEl.textContent.replace(' - Paint', '').trim();

  // If it already has an extension keep it, otherwise add .png
  const hasExt = /\.(png|jpg|jpeg|bmp|webp)$/i.test(name);
  return hasExt ? name : name + '.png';
  }
  
  if (!window.__TAURI__) { _browserDownload(); return; }

  try {
    const { save } = await import('@tauri-apps/plugin-dialog');

    const filePath = await save({
      title:       'Save Image As',
        defaultPath: _currentFilePath || _getCurrentFilename(),
      filters: [
        { name: 'PNG Image',  extensions: ['png']         },
        { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
        { name: 'BMP Image',  extensions: ['bmp']         },
        { name: 'WebP Image', extensions: ['webp']        },
      ],
    });

    if (!filePath) return; // user cancelled

    await _writeToDisk(filePath);
    _currentFilePath = filePath;

    const fileName = filePath.split(/[\\/]/).pop();
    setTitleFilename(fileName);

  } catch (err) {
    console.error('Save As failed:', err);
    _browserDownload();
  }
}

// ── Write canvas → disk via Tauri fs plugin ───
async function _writeToDisk(filePath) {
  const { writeFile } = await import('@tauri-apps/plugin-fs');

  const ext      = filePath.split('.').pop().toLowerCase();
  const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp' };
  const mimeType = mimeMap[ext] ?? 'image/png';
  const quality  = ['image/jpeg', 'image/webp'].includes(mimeType) ? 0.92 : 1.0;

  const dataUrl = mainCanvas.toDataURL(mimeType, quality);
  const base64  = dataUrl.split(',')[1];
  const bytes   = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  await writeFile(filePath, bytes);
}

// ── Browser download fallback ─────────────────
function _browserDownload() {
  const link    = document.createElement('a');
  link.download = 'untitled.png';
  link.href     = mainCanvas.toDataURL('image/png');
  link.click();
}

function selectAll() {
  selection = { x: 0, y: 0, w: mainCanvas.width, h: mainCanvas.height };
  selectionData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
  showSelectionBox(0, 0, mainCanvas.width, mainCanvas.height);
}

function clearImage() {
  saveState();
  ctx.fillStyle = color2;
  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
}

// ── Menu Actions ───────────────────────────────
// Menu open/close
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', e => {
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
    e.stopPropagation();
  });
});

document.addEventListener('click', () => {
  document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('open'));
});

// Menu item bindings
document.getElementById('dd-new').addEventListener('click', newCanvas);
document.getElementById('dd-open').addEventListener('click', openImage);
document.getElementById('dd-save').addEventListener('click', saveImage);
document.getElementById('dd-save-as').addEventListener('click', saveAs);
document.getElementById('dd-exit').addEventListener('click', () => window.close());
document.getElementById('dd-undo').addEventListener('click', undo);
document.getElementById('dd-redo').addEventListener('click', redo);
document.getElementById('dd-select-all').addEventListener('click', selectAll);
document.getElementById('dd-clear').addEventListener('click', clearImage);

// Ribbon button bindings
document.getElementById('rb-paste').addEventListener('click', async () => {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('image/png')) {
        const blob = await item.getType('image/png');
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { saveState(); ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); };
        img.src = url;
        return;
      }
    }
  } catch(err) { console.log('Paste failed:', err); }
});

document.getElementById('rb-select').addEventListener('click', () => {
  tool = 'select-rect';
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tool-select-rect').classList.add('active');
  updateCursor();
});

// Resize modal
document.getElementById('rb-resize').addEventListener('click', () => {
  document.getElementById('resize-modal').style.display = 'flex';
});
document.getElementById('resize-cancel').addEventListener('click', () => {
  document.getElementById('resize-modal').style.display = 'none';
});
document.getElementById('resize-ok').addEventListener('click', () => {
  const unit = document.querySelector('input[name="resize-unit"]:checked').value;
  const hv = parseInt(document.getElementById('resize-h').value);
  const vv = parseInt(document.getElementById('resize-v').value);
  const maintain = document.getElementById('resize-maintain').checked;

  saveState();
  let nw, nh;
  if (unit === 'percent') {
    nw = Math.round(mainCanvas.width  * hv / 100);
    nh = Math.round(mainCanvas.height * (maintain ? hv : vv) / 100);
  } else {
    nw = hv;
    nh = maintain ? Math.round(mainCanvas.height * hv / mainCanvas.width) : vv;
  }
  setCanvasSize(nw, nh);
  document.getElementById('resize-modal').style.display = 'none';
});

// Open from URL
document.getElementById('dd-open-url').addEventListener('click', () => {
  document.getElementById('url-input').value = '';
  document.getElementById('url-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('url-input').focus(), 50);
});

document.getElementById('url-cancel').addEventListener('click', () => {
  document.getElementById('url-modal').style.display = 'none';
});

document.getElementById('url-ok').addEventListener('click', loadFromUrl);

document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadFromUrl();
  if (e.key === 'Escape') document.getElementById('url-modal').style.display = 'none';
});

async function loadFromUrl() {
  const url = document.getElementById('url-input').value.trim();
  if (!url) return;

  document.getElementById('url-modal').style.display = 'none';

  const img = new Image();
  img.crossOrigin = 'anonymous'; // needed to avoid canvas taint
  
  img.onload = () => {
    saveState();
    setCanvasSize(img.width, img.height);
    ctx.drawImage(img, 0, 0);
    setZoom(1);
    setTitleFilename(url.split('/').pop() || 'image');
  };

  img.onerror = () => {
    alert('Failed to load image.\n\nThis is usually a CORS restriction — the server doesn\'t allow cross-origin requests.\n\nTry downloading the image and using Open... instead.');
  };

  img.src = url;
}

// Maintain aspect ratio sync
document.getElementById('resize-h').addEventListener('input', e => {
  if (document.getElementById('resize-maintain').checked) {
    document.getElementById('resize-v').value = e.target.value;
  }
});

// Title bar buttons
document.getElementById('btn-close').addEventListener('click', () => window.close());
document.getElementById('btn-minimize').addEventListener('click', () => {
  // Tauri specific: will work if Tauri is connected
  if (window.__TAURI__) window.__TAURI__.window.getCurrent().minimize();
});
document.getElementById('btn-maximize').addEventListener('click', () => {
  if (window.__TAURI__) window.__TAURI__.window.getCurrent().toggleMaximize();
});

// ── Eraser proper fill with background ─────────
// Override eraser to actually paint bg color not erase alpha
eventTarget.addEventListener('mousedown', e => {
  if (tool !== 'eraser') return;
});

// Fix eraser on mousedown too
const origMouseDown = onMouseDown;
eventTarget.removeEventListener('mousedown', onMouseDown);
eventTarget.addEventListener('mousedown', function(e) {
  const pos = getCanvasPos(e);
  if (tool === 'eraser') {
    saveState();
    isDrawing = true;
    ctx.save();
    ctx.fillStyle = color2;
    ctx.fillRect(pos.x - brushSize, pos.y - brushSize, brushSize * 2, brushSize * 2);
    ctx.restore();
    lastX = pos.x; lastY = pos.y;
    return;
  }
  origMouseDown(e);
});

// ── Initial fill ───────────────────────────────
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
setZoom(1);
updateCursor();

console.log('🎨 MS Paint Clone loaded. Happy drawing!');