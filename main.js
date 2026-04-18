const imageUpload = document.getElementById('imageUpload');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const outputSvg = document.getElementById('outputSvg');
const previewCanvas = document.getElementById('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');
const thresholdInput = document.getElementById('threshold');
const thresholdVal = document.getElementById('thresholdVal');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const generateBtnMobile = document.getElementById('generateBtnMobile');
const downloadBtnMobile = document.getElementById('downloadBtnMobile');
const statusEl = document.getElementById('status');

let imageWidth = 0;
let imageHeight = 0;
let highlightZone = null; // zone key to isolate in preview, or null for all

// --- Performance: adjusted image cache ---
let _adjustedCache = null;
function invalidateAdjustedCache() { _adjustedCache = null; }

function setPackingBusy(busy) {
    generateBtn.disabled = busy;
    if (generateBtnMobile) generateBtnMobile.disabled = busy;
}
function enableDownload(yes) {
    downloadBtn.disabled = !yes;
    if (downloadBtnMobile) downloadBtnMobile.disabled = !yes;
}

// --- Performance: rAF-based rendering debounce ---
let _previewRaf = null;
function schedulePreview(fn) {
    if (_previewRaf) cancelAnimationFrame(_previewRaf);
    _previewRaf = requestAnimationFrame(() => { _previewRaf = null; fn(); });
}

// --- Preview mode: canvas for raster previews, SVG for circle output ---
function showPreviewCanvas() {
    previewCanvas.style.display = '';
    outputSvg.style.display = 'none';
}
function showPreviewSvg() {
    previewCanvas.style.display = 'none';
    outputSvg.style.display = '';
}

// --- Worker handle for cancellation ---
let _packingWorker = null;

const TARGET_WIDTH = 1000;

// --- Source reference thumbnail (steps 2–4) ---
const sourceThumb = document.getElementById('sourceThumb');
function refreshSourceThumb() {
    if (imageWidth === 0) { sourceThumb.removeAttribute('src'); return; }
    sourceThumb.src = hiddenCanvas.toDataURL('image/jpeg', 0.75);
}
function updateSourceThumb(step) {
    const show = step > 0 && imageWidth > 0;
    sourceThumb.classList.toggle('d-none', !show);
    if (show && !sourceThumb.src) refreshSourceThumb();
}
(function wireSourceThumbDrag() {
    let dragging = false, sx = 0, sy = 0, startLeft = 0, startTop = 0;
    sourceThumb.addEventListener('pointerdown', (e) => {
        dragging = true;
        const rect = sourceThumb.getBoundingClientRect();
        const parentRect = sourceThumb.parentElement.getBoundingClientRect();
        startLeft = rect.left - parentRect.left;
        startTop = rect.top - parentRect.top;
        sx = e.clientX; sy = e.clientY;
        sourceThumb.style.left = `${startLeft}px`;
        sourceThumb.style.top = `${startTop}px`;
        sourceThumb.classList.add('dragging');
        sourceThumb.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    sourceThumb.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parentRect = sourceThumb.parentElement.getBoundingClientRect();
        const w = sourceThumb.offsetWidth, h = sourceThumb.offsetHeight;
        let nx = startLeft + (e.clientX - sx);
        let ny = startTop + (e.clientY - sy);
        nx = Math.max(0, Math.min(parentRect.width - w, nx));
        ny = Math.max(0, Math.min(parentRect.height - h, ny));
        sourceThumb.style.left = `${nx}px`;
        sourceThumb.style.top = `${ny}px`;
    });
    const end = (e) => {
        if (!dragging) return;
        dragging = false;
        sourceThumb.classList.remove('dragging');
        try { sourceThumb.releasePointerCapture(e.pointerId); } catch {}
    };
    sourceThumb.addEventListener('pointerup', end);
    sourceThumb.addEventListener('pointercancel', end);
})();

// --- Persistence ---
const SETTINGS_KEY = 'circlePackerSettings';
const IMAGE_KEY = 'circlePackerImage';

function saveSetting(key, value) {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        s[key] = value;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch(e) {}
}

function getSetting(key, fallback) {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return s[key] !== undefined ? s[key] : fallback;
    } catch(e) { return fallback; }
}

function saveImage() {
    try {
        localStorage.setItem(IMAGE_KEY, hiddenCanvas.toDataURL('image/jpeg', 0.85));
    } catch(e) {}
}

function restoreImage() {
    try {
        const dataUrl = localStorage.getItem(IMAGE_KEY);
        if (!dataUrl) return;
        const img = new Image();
        img.onload = function() {
            imageWidth = img.width;
            imageHeight = img.height;
            hiddenCanvas.width = imageWidth;
            hiddenCanvas.height = imageHeight;
            ctx.drawImage(img, 0, 0);
            invalidateAdjustedCache();
            refreshSourceThumb();
            updateSourceThumb(currentStep);
            statusEl.textContent = `Image restored: ${imageWidth}×${imageHeight}px`;
            enableDownload(false);
            // showStep will pick the right preview when setTimeout fires
            if (currentStep === 0) renderAdjustedPreview();
            else renderZonePreview();
        };
        img.src = dataUrl;
    } catch(e) {}
}

// --- Zone mode helpers (in-memory, localStorage is persistence only) ---
let zoneMode         = getSetting('zoneMode', 'brightness');
let zoneHueStarts    = null; // array of N start angles; initialised on demand
let blackZoneEnabled = getSetting('blackZoneEnabled', false);
let blackThreshold   = parseInt(getSetting('blackThreshold', 20));
let whiteZoneEnabled = getSetting('whiteZoneEnabled', false);
let whiteThreshold   = parseInt(getSetting('whiteThreshold', 235));
function getZoneMode() { return zoneMode; }

// Effective luminance range for hue zones (shrinks when black/white zones active)
function getHueLumRange() {
    const threshold = parseInt(thresholdInput.value, 10);
    return {
        lo: blackZoneEnabled ? blackThreshold : 0,
        hi: whiteZoneEnabled ? whiteThreshold : threshold,
    };
}

function ensureHueStarts(n) {
    const saved = getSetting('zoneHueStarts', null);
    if (!Array.isArray(zoneHueStarts) || zoneHueStarts.length !== n) {
        if (Array.isArray(saved) && saved.length === n) {
            zoneHueStarts = saved.map(Number);
        } else {
            zoneHueStarts = Array.from({ length: n }, (_, i) => (i * 360 / n));
        }
    }
    return zoneHueStarts;
}

function resizeHueStarts(newN) {
    const current = ensureHueStarts(zoneHueStarts ? zoneHueStarts.length : newN);
    if (newN === current.length) return;
    // Always redistribute evenly when the count changes; user can fine-tune in step 3.
    zoneHueStarts = Array.from({ length: newN }, (_, i) => (i * 360 / newN));
    saveSetting('zoneHueStarts', zoneHueStarts);
}

function zoneMidHue(lo, hi) {
    if (hi > lo) return (lo + hi) / 2;
    return (lo + (hi + 360 - lo) / 2) % 360;
}

function hueToAngle(hue) { return (hue - 90) * Math.PI / 180; }

function updateBgZoneVisibility() {
    const section = document.getElementById('bgZoneSection');
    if (section) section.style.display = zoneMode === 'hue' ? 'none' : 'block';
}

function getZoneBounds(z, n, threshold) {
    const lo = Math.round(z * threshold / n);
    const hi = z === n - 1 ? threshold : Math.round((z + 1) * threshold / n);
    return { lo, hi };
}

function getZoneHueBounds(z, n) {
    const starts = ensureHueStarts(n);
    return { lo: starts[z], hi: starts[(z + 1) % n] };
}

function rgbToHue(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h;
    if      (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    return h * 60;
}

function updateModeUI() {
    const mode = getZoneMode();
    const btnB = document.getElementById('modeBrightness');
    const btnH = document.getElementById('modeHue');
    btnB.className = `btn btn-sm ${mode === 'brightness' ? 'btn-primary' : 'btn-outline-primary'}`;
    btnH.className = `btn btn-sm ${mode === 'hue'        ? 'btn-primary' : 'btn-outline-primary'}`;
    const ts = document.getElementById('thresholdSection');
    // In hue mode, threshold is only hidden when white zone owns the upper bound.
    if (ts) ts.style.display = (mode === 'hue' && whiteZoneEnabled) ? 'none' : '';
    const nz = document.getElementById('neutralZoneToggles');
    if (nz) nz.classList.toggle('d-none', mode !== 'hue');
    const hrn = document.getElementById('hueResetNote');
    if (hrn) hrn.classList.toggle('d-none', mode !== 'hue');
    // Sync toggle checkboxes with state
    const bToggle = document.getElementById('blackZoneToggle');
    const wToggle = document.getElementById('whiteZoneToggle');
    if (bToggle) bToggle.checked = blackZoneEnabled;
    if (wToggle) wToggle.checked = whiteZoneEnabled;
    updateBgZoneVisibility();
}

// --- Zone settings ---
function getZoneSettings(z) {
    return {
        minR:      getSetting(`zone_${z}_minR`,       2),
        maxR:      getSetting(`zone_${z}_maxR`,       100),
        colorMode: getSetting(`zone_${z}_colorMode`,  'solid'),
        solidColor:getSetting(`zone_${z}_solidColor`, '#000000'),
    };
}

function saveZoneSetting(z, key, value) {
    saveSetting(`zone_${z}_${key}`, value);
}

function zoneControlsHTML(zKey, s) {
    return `
        <div class="compact-row">
            <label>Min R</label>
            <input type="number" class="form-control form-control-sm zone-minR" value="${s.minR}" min="1" max="500">
        </div>
        <div class="compact-row">
            <label>Max R</label>
            <input type="number" class="form-control form-control-sm zone-maxR" value="${s.maxR}" min="1" max="500">
        </div>
        <div class="mt-2">
            <div class="form-check form-check-sm py-0">
                <input class="form-check-input" type="radio" name="z${zKey}_cm" value="solid" ${s.colorMode==='solid'?'checked':''}>
                <label class="form-check-label small">Solid colour</label>
            </div>
            <div class="form-check form-check-sm py-0">
                <input class="form-check-input" type="radio" name="z${zKey}_cm" value="per-circle" ${s.colorMode==='per-circle'?'checked':''}>
                <label class="form-check-label small">Average per circle</label>
            </div>
            <div class="form-check form-check-sm py-0">
                <input class="form-check-input" type="radio" name="z${zKey}_cm" value="global" ${s.colorMode==='global'?'checked':''}>
                <label class="form-check-label small">Global average</label>
            </div>
        </div>
        <div class="zone-color-wrap mt-2" ${s.colorMode!=='solid'?'style="display:none"':''}>
            <input type="color" class="form-control form-control-color w-100 zone-color" value="${s.solidColor}">
        </div>`;
}

function wireZoneControls(panel, zKey) {
    const minREl    = panel.querySelector('.zone-minR');
    const maxREl    = panel.querySelector('.zone-maxR');
    const colorEl   = panel.querySelector('.zone-color');
    const colorWrap = panel.querySelector('.zone-color-wrap');
    minREl.addEventListener('change', () => saveZoneSetting(zKey, 'minR', minREl.value));
    maxREl.addEventListener('change', () => saveZoneSetting(zKey, 'maxR', maxREl.value));
    colorEl.addEventListener('input',  () => saveZoneSetting(zKey, 'solidColor', colorEl.value));
    panel.querySelectorAll(`input[name="z${zKey}_cm"]`).forEach(r => {
        r.addEventListener('change', () => {
            saveZoneSetting(zKey, 'colorMode', r.value);
            colorWrap.style.display = r.value === 'solid' ? 'block' : 'none';
        });
    });
}

function buildZonePanelEl(zKey, label, swatchColor, rangeText, s) {
    const panel = document.createElement('div');
    panel.className = 'card zone-card';
    panel.dataset.zone = zKey;
    panel.innerHTML = `
        <div class="card-header">
            <span class="zone-swatch" style="background:${swatchColor}"></span>
            ${label}
            <span class="zone-range">${rangeText}</span>
        </div>
        <div class="card-body">${zoneControlsHTML(zKey, s)}</div>`;
    wireZoneControls(panel, zKey);
    return panel;
}

function buildNeutralZonePanel(key, swatchColor, circleControls) {
    const isBlack   = key === 'black';
    const thresh    = isBlack ? blackThreshold : whiteThreshold;
    const threshold = parseInt(thresholdInput.value, 10);
    const rangeText = isBlack ? `L: 0–${thresh}` : `L: ${thresh}–255`;
    const swatchBg  = swatchColor || (isBlack ? '#111' : '#eee');
    const label     = isBlack ? 'Black zone' : 'White zone';
    const sliderMin = 1;
    const sliderMax = isBlack ? Math.max(2, threshold - 1) : 254;
    const s         = getZoneSettings(key);

    const panel = document.createElement('div');
    panel.className = 'card zone-card';
    panel.dataset.zone = key;
    panel.innerHTML = `
        <div class="card-header">
            <span class="zone-swatch" style="background:${swatchBg};border-color:#999;"></span>
            ${label}
            <span class="zone-range neutral-range">${rangeText}</span>
        </div>
        <div class="card-body">
            <div class="neutral-thresh-row">
                <label>${isBlack ? 'Max L' : 'Min L'}</label>
                <input type="range" class="form-range neutral-thresh" min="${sliderMin}" max="${sliderMax}" value="${thresh}">
                <span class="val neutral-thresh-val">${thresh}</span>
            </div>
            ${circleControls ? zoneControlsHTML(key, s) : ''}
        </div>`;

    const rangeEl     = panel.querySelector('.neutral-range');
    const threshEl    = panel.querySelector('.neutral-thresh');
    const threshValEl = panel.querySelector('.neutral-thresh-val');
    threshEl.addEventListener('input', () => {
        const v = parseInt(threshEl.value, 10);
        if (isBlack) { blackThreshold = v; saveSetting('blackThreshold', v); rangeEl.textContent = `L: 0–${v}`; }
        else         { whiteThreshold = v; saveSetting('whiteThreshold', v); rangeEl.textContent = `L: ${v}–255`; }
        threshValEl.textContent = v;
        if (imageWidth > 0) renderZonePreview();
    });

    if (circleControls) wireZoneControls(panel, key);
    return panel;
}

// SVG-based hue wheel — static conic-gradient ring, dynamic SVG sectors + handles
function arcPath(cx, cy, r, startDeg, endDeg) {
    const s = (startDeg - 90) * Math.PI / 180;
    const e = (endDeg   - 90) * Math.PI / 180;
    const large = (endDeg - startDeg + 360) % 360 > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
    return `M${cx},${cy} L${x1},${y1} A${r},${r},0,${large},1,${x2},${y2} Z`;
}

function updateHueWheel(svgEl, n) {
    const S = 240;
    const cx = S / 2, cy = S / 2;
    const innerR = S * 0.26;
    const outerR = S * 0.40;
    const handleR = S * 0.045;
    const starts = ensureHueStarts(n);

    // Clear dynamic content (keep the static ring + inner disc)
    const ring = svgEl.querySelector('.hue-ring');
    while (ring.nextSibling) ring.nextSibling.remove();

    // Boundary lines + handles
    for (let z = 0; z < n; z++) {
        const a = hueToAngle(starts[z]);
        const x1 = cx + innerR * Math.cos(a), y1 = cy + innerR * Math.sin(a);
        const x2 = cx + (outerR + 3) * Math.cos(a), y2 = cy + (outerR + 3) * Math.sin(a);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('stroke', 'white'); line.setAttribute('stroke-width', '2');
        svgEl.appendChild(line);

        const hx = cx + outerR * Math.cos(a), hy = cy + outerR * Math.sin(a);
        const handle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        handle.setAttribute('cx', hx); handle.setAttribute('cy', hy);
        handle.setAttribute('r', handleR);
        handle.setAttribute('fill', 'white'); handle.setAttribute('stroke', '#333');
        handle.setAttribute('stroke-width', '1.5'); handle.setAttribute('cursor', 'grab');
        handle.classList.add('hue-handle');
        handle.dataset.zone = z;
        svgEl.appendChild(handle);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', hx); label.setAttribute('y', hy);
        label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('font-size', `${Math.round(S * 0.06)}px`);
        label.setAttribute('font-weight', 'bold'); label.setAttribute('fill', '#333');
        label.setAttribute('pointer-events', 'none');
        label.textContent = z + 1;
        svgEl.appendChild(label);
    }
}

function createHueWheelSVG(n) {
    const S = 240;
    const cx = S / 2, cy = S / 2;
    const innerR = S * 0.26;
    const outerR = S * 0.40;

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.setAttribute('viewBox', `0 0 ${S} ${S}`);
    svgEl.style.cssText = 'width:100%;aspect-ratio:1;display:block;cursor:grab;margin-bottom:.5rem;';

    const conicBg = `conic-gradient(from -90deg,hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))`;
    const innerPct = (innerR / S * 100).toFixed(1);
    const outerPct = (outerR / S * 100).toFixed(1);

    // Inner filled disc (same conic-gradient, masked to inner circle)
    const foInner = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foInner.setAttribute('x', '0'); foInner.setAttribute('y', '0');
    foInner.setAttribute('width', S); foInner.setAttribute('height', S);
    const innerDiv = document.createElement('div');
    innerDiv.style.cssText = `width:${S}px;height:${S}px;border-radius:50%;background:${conicBg};` +
        `-webkit-mask:radial-gradient(circle at center,black ${innerPct}%,transparent ${innerPct}%);` +
        `mask:radial-gradient(circle at center,black ${innerPct}%,transparent ${innerPct}%);`;
    foInner.appendChild(innerDiv);
    foInner.classList.add('hue-inner');
    svgEl.appendChild(foInner);

    // Outer hue ring
    const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    fo.setAttribute('x', '0'); fo.setAttribute('y', '0');
    fo.setAttribute('width', S); fo.setAttribute('height', S);
    const ringDiv = document.createElement('div');
    ringDiv.style.cssText = `width:${S}px;height:${S}px;border-radius:50%;background:${conicBg};` +
        `-webkit-mask:radial-gradient(circle at center,transparent ${innerPct}%,black ${innerPct}%,black ${outerPct}%,transparent ${outerPct}%);` +
        `mask:radial-gradient(circle at center,transparent ${innerPct}%,black ${innerPct}%,black ${outerPct}%,transparent ${outerPct}%);`;
    fo.appendChild(ringDiv);
    fo.classList.add('hue-ring');
    svgEl.appendChild(fo);

    updateHueWheel(svgEl, n);
    return svgEl;
}

function setupHueWheelDrag(svgEl, n, onDrag, onDragEnd) {
    const S = 240;
    const cx = S / 2, cy = S / 2;
    const outerR = S * 0.40;
    const hitR = S * 0.045 + 8;
    let drag = -1;

    function evPos(e) {
        const rect = svgEl.getBoundingClientRect();
        const sx = S / rect.width, sy = S / rect.height;
        const t = e.touches ? e.touches[0] : e;
        return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy };
    }
    function angleToHue(x, y) {
        let d = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
        if (d < 0) d += 360;
        if (d >= 360) d -= 360;
        return d;
    }

    svgEl.addEventListener('pointerdown', e => {
        const p = evPos(e);
        const starts = ensureHueStarts(n);
        drag = -1;
        for (let z = 0; z < n; z++) {
            const a = hueToAngle(starts[z]);
            const hx = cx + outerR * Math.cos(a), hy = cy + outerR * Math.sin(a);
            if ((p.x-hx)**2 + (p.y-hy)**2 <= hitR*hitR) { drag = z; break; }
        }
        if (drag >= 0) { e.preventDefault(); svgEl.setPointerCapture(e.pointerId); svgEl.style.cursor = 'grabbing'; }
    });
    svgEl.addEventListener('pointermove', e => {
        if (drag < 0) return;
        const p = evPos(e);
        zoneHueStarts[drag] = angleToHue(p.x, p.y);
        saveSetting('zoneHueStarts', zoneHueStarts);
        updateHueWheel(svgEl, n);
        onDrag();
    });
    svgEl.addEventListener('pointerup', () => {
        if (drag >= 0) { drag = -1; svgEl.style.cursor = 'grab'; onDragEnd(); }
    });
    svgEl.addEventListener('pointercancel', () => {
        if (drag >= 0) { drag = -1; onDragEnd(); }
    });
}

function computeAllSwatches(n) {
    if (imageWidth === 0) return null;
    const mode = getZoneMode();
    const threshold = parseInt(thresholdInput.value, 10);
    // Zone membership is driven by adjusted luminance/hue; swatch colour
    // is the average of the *source* pixels so zones reflect the true image.
    const adj = getAdjustedImageData().data;
    const src = ctx.getImageData(0, 0, imageWidth, imageHeight).data;
    const total = imageWidth * imageHeight;
    const zS = Array.from({length: n}, () => [0,0,0,0]);
    let bkS = [0,0,0,0], wS = [0,0,0,0], bgS = [0,0,0,0];
    const { lo: lumLo, hi: lumHi } = mode === 'hue' ? getHueLumRange() : { lo: 0, hi: threshold };

    for (let i = 0; i < total; i++) {
        const si = i * 4;
        const ar = adj[si], ag = adj[si+1], ab = adj[si+2];
        const sr = src[si], sg = src[si+1], sb = src[si+2];
        const lum = ar * 0.299 + ag * 0.587 + ab * 0.114;
        if (lum >= threshold) { bgS[0]+=sr; bgS[1]+=sg; bgS[2]+=sb; bgS[3]++; continue; }
        if (mode === 'hue') {
            if (blackZoneEnabled && lum < blackThreshold) { bkS[0]+=sr; bkS[1]+=sg; bkS[2]+=sb; bkS[3]++; }
            else if (whiteZoneEnabled && lum >= whiteThreshold) { wS[0]+=sr; wS[1]+=sg; wS[2]+=sb; wS[3]++; }
            else if (lum >= lumLo && lum < lumHi) {
                const hue = rgbToHue(ar, ag, ab);
                for (let z = 0; z < n; z++) {
                    const { lo, hi } = getZoneHueBounds(z, n);
                    const wraps = hi <= lo;
                    if (wraps ? (hue >= lo || hue < hi) : (hue >= lo && hue < hi)) {
                        zS[z][0]+=sr; zS[z][1]+=sg; zS[z][2]+=sb; zS[z][3]++; break;
                    }
                }
            }
        } else {
            const z = Math.min(n-1, Math.floor(lum * n / threshold));
            zS[z][0]+=sr; zS[z][1]+=sg; zS[z][2]+=sb; zS[z][3]++;
        }
    }
    const hex = ([r,g,b,c]) => c > 0 ? rgbToHex(Math.round(r/c), Math.round(g/c), Math.round(b/c)) : null;
    return { zones: zS.map(hex), black: hex(bkS), white: hex(wS), bg: hex(bgS) };
}

// --- Panel builders ---

function buildHueWheelUI(n) {
    const wheelContainer = document.getElementById('hueWheelContainer');
    ensureHueStarts(n);
    wheelContainer.innerHTML = '';
    const svgEl = createHueWheelSVG(n);
    wheelContainer.appendChild(svgEl);
    setupHueWheelDrag(svgEl, n,
        // onDrag — lightweight: only redraw wheel chrome
        () => { updateAccordionRanges(n); },
        // onDragEnd — expensive: full preview rebuild
        () => { if (imageWidth > 0) renderZonePreview(); }
    );
}

function updateAccordionRanges(n) {
    for (let z = 0; z < n; z++) {
        const item = document.querySelector(`#zonesAccordion [data-zone="${z}"]`);
        if (!item) continue;
        const { lo, hi } = getZoneHueBounds(z, n);
        const sw = item.querySelector('.zone-swatch');
        if (sw) sw.style.background = `hsl(${zoneMidHue(lo, hi).toFixed(0)},100%,50%)`;
        const rng = item.querySelector('.zone-range');
        if (rng) rng.textContent = `${Math.round(lo)}°–${Math.round(hi === 0 ? 360 : hi)}°`;
    }
}

function buildPanel2() {
    updateModeUI(); // keep threshold visibility in sync
}

function buildPanel3() {
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const mode = getZoneMode();

    document.getElementById('panel2Brightness').classList.toggle('d-none', mode !== 'brightness');
    document.getElementById('panel2Hue').classList.toggle('d-none', mode !== 'hue');

    if (mode === 'hue') {
        buildHueWheelUI(n);
        const bc = document.getElementById('blackZoneContainer');
        const wc = document.getElementById('whiteZoneContainer');
        bc.innerHTML = ''; wc.innerHTML = '';
        if (blackZoneEnabled) bc.appendChild(buildNeutralZonePanel('black', null));
        if (whiteZoneEnabled) wc.appendChild(buildNeutralZonePanel('white', null));
    } else {
        buildZoneSummary(n);
    }
    updateBgZoneVisibility();
}

function buildZoneSummary(n) {
    const threshold = parseInt(thresholdInput.value, 10);
    const sw = imageWidth > 0 ? computeAllSwatches(n) : null;
    const container = document.getElementById('zoneSummaryContainer');
    container.innerHTML = '';
    for (let z = 0; z < n; z++) {
        const { lo, hi } = getZoneBounds(z, n, threshold);
        const mid = Math.round((lo + hi) / 2);
        const swatch = sw?.zones[z] || `rgb(${mid},${mid},${mid})`;
        const div = document.createElement('div');
        div.className = 'zone-summary';
        div.innerHTML = `<span class="zone-swatch" style="background:${swatch};"></span>
                         <span>Zone ${z + 1}</span>
                         <span class="ms-auto text-muted small">L: ${lo}–${hi}</span>`;
        container.appendChild(div);
    }
}

function buildPanel4() {
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const threshold = parseInt(thresholdInput.value, 10);
    const mode = getZoneMode();
    const sw = imageWidth > 0 ? computeAllSwatches(n) : null;

    const accordion = document.getElementById('zonesAccordion');
    accordion.innerHTML = '';
    highlightZone = '0'; // first zone starts expanded

    for (let z = 0; z < n; z++) {
        let swatchColor, rangeText;
        if (mode === 'hue') {
            const { lo, hi } = getZoneHueBounds(z, n);
            const [hr, hg, hb] = hslToRgb(zoneMidHue(lo, hi), 1.0, 0.5);
            swatchColor = sw?.zones[z] || rgbToHex(hr, hg, hb);
            rangeText = `${Math.round(lo)}°–${Math.round(hi === 0 ? 360 : hi)}°`;
        } else {
            const { lo, hi } = getZoneBounds(z, n, threshold);
            const mid = Math.round((lo + hi) / 2);
            swatchColor = sw?.zones[z] || rgbToHex(mid, mid, mid);
            rangeText = `L: ${lo}–${hi}`;
        }
        const s = getZoneSettings(z);
        if (!getSetting(`zone_${z}_solidColor`, null)) s.solidColor = swatchColor || '#000000';
        accordion.appendChild(buildZoneAccordionItem(z, `Zone ${z + 1}`, swatchColor, rangeText, s, z === 0));
    }

    // Neutral zones (hue mode)
    if (mode === 'hue') {
        for (const key of ['black', 'white']) {
            const isBlack = key === 'black';
            const enabled = isBlack ? blackZoneEnabled : whiteZoneEnabled;
            if (!enabled) continue;
            const lo = isBlack ? 0 : whiteThreshold;
            const hi = isBlack ? blackThreshold : 255;
            const label = isBlack ? 'Black zone' : 'White zone';
            const swatch = sw?.[key] || (isBlack ? '#111111' : '#eeeeee');
            const ks = getZoneSettings(key);
            if (!getSetting(`zone_${key}_solidColor`, null)) ks.solidColor = swatch || '#000000';
            accordion.appendChild(buildZoneAccordionItem(key, label, swatch, `L: ${lo}–${hi}`, ks, false));
        }
    }

    // Background zone as an accordion item (when enabled)
    if (mode !== 'hue' && document.getElementById('bgZoneEnabled').checked) {
        const midGray = Math.round((threshold + 255) / 2);
        const swatch = sw?.bg || rgbToHex(midGray, midGray, midGray);
        const bgs = getZoneSettings('bg');
        if (!getSetting('zone_bg_solidColor', null)) bgs.solidColor = swatch;
        accordion.appendChild(buildZoneAccordionItem('bg', 'Background', swatch, `L: ${threshold}–255`, bgs, false));
    }

    updateBgZoneVisibility();

    // Highlight active zone in preview when an accordion item is opened
    accordion.addEventListener('show.bs.collapse', (e) => {
        const item = e.target.closest('.accordion-item');
        if (item) {
            highlightZone = item.dataset.zone;
            if (imageWidth > 0) renderZonePreview();
        }
    });
    accordion.addEventListener('hide.bs.collapse', (e) => {
        const item = e.target.closest('.accordion-item');
        if (item && item.dataset.zone == highlightZone) {
            // Find another open accordion, if any
            const otherOpen = accordion.querySelector('.accordion-collapse.show:not(#' + e.target.id + ')');
            highlightZone = otherOpen
                ? otherOpen.closest('.accordion-item').dataset.zone
                : null;
            if (imageWidth > 0) renderZonePreview();
        }
    });
}

function buildZoneAccordionItem(zKey, label, swatchColor, rangeText, s, expanded) {
    const item = document.createElement('div');
    item.className = 'accordion-item';
    item.dataset.zone = zKey;
    const colId = `zacc-${zKey}`;
    item.innerHTML = `
        <h2 class="accordion-header">
            <button class="accordion-button${expanded ? '' : ' collapsed'}" type="button"
                    data-bs-toggle="collapse" data-bs-target="#${colId}">
                <span class="zone-swatch me-2" style="background:${swatchColor}"></span>
                ${label}
                <span class="zone-range">${rangeText}</span>
            </button>
        </h2>
        <div id="${colId}" class="accordion-collapse collapse${expanded ? ' show' : ''}" data-bs-parent="#zonesAccordion">
            <div class="accordion-body">${zoneControlsHTML(zKey, s)}</div>
        </div>`;
    wireZoneControls(item, zKey);
    return item;
}


function getZoneSettingsFromDOM(zKey) {
    const panel = document.querySelector(`#zonesAccordion [data-zone="${zKey}"]`);
    if (!panel) return getZoneSettings(zKey);
    return {
        minR:      Math.max(1, parseInt(panel.querySelector('.zone-minR').value, 10) || 2),
        maxR:      parseInt(panel.querySelector('.zone-maxR').value, 10) || 100,
        colorMode: panel.querySelector(`input[name="z${zKey}_cm"]:checked`)?.value || 'solid',
        solidColor:panel.querySelector('.zone-color').value || '#000000',
    };
}

// --- Step navigation ---
let currentStep = 0;

function showStep(n) {
    currentStep = n;
    if (n !== 3) highlightZone = null;
    document.querySelectorAll('.step-panel').forEach((p, i) => p.classList.toggle('d-none', i !== n));
    document.querySelectorAll('.step-btn').forEach((b, i) => b.classList.toggle('active', i === n));
    document.getElementById('previewFooter').classList.toggle('d-none', n !== 3);
    updateSourceThumb(n);
    document.getElementById('prevBtn').disabled = (n === 0);
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.style.display = n === 3 ? 'none' : '';
    if (generateBtnMobile) generateBtnMobile.style.display = n === 3 ? '' : 'none';
    if (downloadBtnMobile) downloadBtnMobile.style.display = n === 3 ? '' : 'none';
    document.getElementById('stepLabel').textContent = `Step ${n + 1} of 4`;

    if (n === 0) {
        if (imageWidth > 0) renderAdjustedPreview();
    } else if (n === 1) {
        buildPanel2();
        if (imageWidth > 0) renderZonePreview();
    } else if (n === 2) {
        buildPanel3();
        if (imageWidth > 0) renderZonePreview();
    } else if (n === 3) {
        buildPanel4();
        if (imageWidth > 0) renderZonePreview();
    }
    saveSetting('currentStep', n);
}

// --- Preview functions ---
function renderAdjustedPreview() {
    if (imageWidth === 0) return;
    showPreviewCanvas();
    previewCanvas.width = imageWidth;
    previewCanvas.height = imageHeight;
    previewCtx.putImageData(getAdjustedImageData(), 0, 0);
}

// --- Load settings ---
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        if (s.threshold !== undefined) { thresholdInput.value = s.threshold; thresholdVal.textContent = s.threshold; }
        if (s.numZones !== undefined) document.getElementById('numZones').value = s.numZones;
        if (s.bgZoneEnabled !== undefined) document.getElementById('bgZoneEnabled').checked = s.bgZoneEnabled;
        if (s.zoneMode        !== undefined) zoneMode      = s.zoneMode;
        if (Array.isArray(s.zoneHueStarts))  zoneHueStarts = s.zoneHueStarts.map(Number);
        if (s.blackZoneEnabled !== undefined) blackZoneEnabled = s.blackZoneEnabled;
        if (s.blackThreshold   !== undefined) blackThreshold   = parseInt(s.blackThreshold);
        if (s.whiteZoneEnabled !== undefined) whiteZoneEnabled = s.whiteZoneEnabled;
        if (s.whiteThreshold   !== undefined) whiteThreshold   = parseInt(s.whiteThreshold);
        [
            { id: 'brightness', label: 'brightnessVal', decimals: 0 },
            { id: 'contrast',   label: 'contrastVal',   decimals: 0 },
            { id: 'gamma',      label: 'gammaVal',       decimals: 2 },
            { id: 'blur',       label: 'blurVal',        decimals: 1 },
        ].forEach(({ id, label, decimals }) => {
            if (s[id] !== undefined) {
                document.getElementById(id).value = s[id];
                document.getElementById(label).textContent = parseFloat(s[id]).toFixed(decimals);
            }
        });
        if (s.currentStep !== undefined) currentStep = parseInt(s.currentStep) || 0;
    } catch(e) {}
    updateModeUI();
}

loadSettings();
restoreImage();

// Navigate to the saved step after image may have been restored
setTimeout(() => showStep(currentStep), 0);

// --- Mobile Generate/Download (sidebar footer, step 4 only) ---
if (generateBtnMobile) generateBtnMobile.addEventListener('click', () => generateBtn.click());
if (downloadBtnMobile) downloadBtnMobile.addEventListener('click', () => downloadBtn.click());

// --- Step nav events ---
document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => showStep(parseInt(btn.dataset.step)));
});
document.getElementById('prevBtn').addEventListener('click', () => showStep(currentStep - 1));
document.getElementById('nextBtn').addEventListener('click', () => showStep(currentStep + 1));

// --- Mode events (panel 2) ---
document.getElementById('modeBrightness').addEventListener('click', () => {
    zoneMode = 'brightness';
    saveSetting('zoneMode', zoneMode);
    updateModeUI();
    if (currentStep === 1) buildPanel2();
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});
document.getElementById('modeHue').addEventListener('click', () => {
    zoneMode = 'hue';
    saveSetting('zoneMode', zoneMode);
    updateModeUI();
    if (currentStep === 1) buildPanel2();
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});

// --- Neutral zone toggles (panel 2, hue mode) ---
document.getElementById('blackZoneToggle').addEventListener('change', e => {
    blackZoneEnabled = e.target.checked;
    saveSetting('blackZoneEnabled', blackZoneEnabled);
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});
document.getElementById('whiteZoneToggle').addEventListener('change', e => {
    whiteZoneEnabled = e.target.checked;
    saveSetting('whiteZoneEnabled', whiteZoneEnabled);
    updateModeUI();
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});

thresholdInput.addEventListener('input', () => {
    thresholdVal.textContent = thresholdInput.value;
    saveSetting('threshold', thresholdInput.value);
    schedulePreview(() => {
        if (imageWidth > 0) renderZonePreview();
        if (currentStep === 2) buildZoneSummary(parseInt(document.getElementById('numZones').value) || 1);
    });
});

// --- Zone count (panel 2) ---
document.getElementById('numZones').addEventListener('change', e => {
    const newN = parseInt(e.target.value, 10) || 1;
    if (getZoneMode() === 'hue') resizeHueStarts(newN);
    saveSetting('numZones', e.target.value);
    if (currentStep === 1) buildPanel2();
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});

// --- Background zone (panel 3 toggle) ---
document.getElementById('bgZoneEnabled').addEventListener('change', e => {
    saveSetting('bgZoneEnabled', e.target.checked);
    updateBgZoneVisibility();
});

// --- Image adjustment sliders (panel 1) ---
const ADJUSTMENTS = [
    { id: 'brightness', label: 'brightnessVal', decimals: 0, reset: 0 },
    { id: 'contrast',   label: 'contrastVal',   decimals: 0, reset: 0 },
    { id: 'gamma',      label: 'gammaVal',       decimals: 2, reset: 1.0 },
    { id: 'blur',       label: 'blurVal',        decimals: 1, reset: 0 },
];
ADJUSTMENTS.forEach(({ id, label, decimals }) => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(label);
    el.addEventListener('input', () => {
        valEl.textContent = parseFloat(el.value).toFixed(decimals);
        saveSetting(id, el.value);
        invalidateAdjustedCache();
        if (imageWidth === 0) return;
        schedulePreview(() => {
            if (currentStep === 0) renderAdjustedPreview();
            else renderZonePreview();
        });
    });
});

document.getElementById('resetAdjustmentsBtn').addEventListener('click', () => {
    ADJUSTMENTS.forEach(({ id, label, decimals, reset }) => {
        const el = document.getElementById(id);
        el.value = reset;
        document.getElementById(label).textContent = reset.toFixed(decimals);
        saveSetting(id, String(reset));
    });
    invalidateAdjustedCache();
    if (imageWidth === 0) return;
    if (currentStep === 0) renderAdjustedPreview();
    else renderZonePreview();
});

imageUpload.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            imageWidth = TARGET_WIDTH;
            imageHeight = Math.round(img.height * (TARGET_WIDTH / img.width));
            hiddenCanvas.width = imageWidth; hiddenCanvas.height = imageHeight;
            ctx.drawImage(img, 0, 0, imageWidth, imageHeight);
            invalidateAdjustedCache();
            saveImage();
            refreshSourceThumb();
            updateSourceThumb(currentStep);
            statusEl.textContent = `Image loaded: ${imageWidth}×${imageHeight}px`;
            enableDownload(false);
            renderAdjustedPreview();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset all settings and clear the image?')) return;
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(IMAGE_KEY);
    location.reload();
});

// --- Image processing ---
function getAdjustedImageData() {
    if (_adjustedCache) return _adjustedCache;
    const blur   = parseFloat(document.getElementById('blur').value) || 0;
    const bright = parseInt(document.getElementById('brightness').value, 10) || 0;
    const contr  = parseInt(document.getElementById('contrast').value, 10) || 0;
    const gamma  = parseFloat(document.getElementById('gamma').value) || 1.0;

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = imageWidth;
    tmpCanvas.height = imageHeight;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (blur > 0) tmpCtx.filter = `blur(${blur}px)`;
    tmpCtx.drawImage(hiddenCanvas, 0, 0);

    const imageData = tmpCtx.getImageData(0, 0, imageWidth, imageHeight);
    const data = imageData.data;
    const contrastFactor = (259 * (contr * 2.55 + 255)) / (255 * (259 - contr * 2.55));
    const gammaInv = 1 / gamma;

    for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            let v = data[i + c];
            v += bright;
            v = contrastFactor * (v - 128) + 128;
            v = 255 * Math.pow(Math.max(0, v) / 255, gammaInv);
            data[i + c] = Math.max(0, Math.min(255, v + 0.5)) | 0;
        }
    }
    _adjustedCache = imageData;
    return imageData;
}

function renderZonePreview() {
    showPreviewCanvas();
    const data = getAdjustedImageData().data;
    const threshold = parseInt(thresholdInput.value, 10);
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const mode = getZoneMode();
    const bgEnabled = mode !== 'hue' && document.getElementById('bgZoneEnabled').checked;
    const total = imageWidth * imageHeight;

    // Only highlight when on the Circles panel (step 3)
    const hl = currentStep === 3 ? highlightZone : null;
    // Parse highlight zone key for fast comparison in the loop
    const hlIsNum = hl !== null && !isNaN(hl);
    const hlIdx = hlIsNum ? parseInt(hl, 10) : -1;
    const hlIsBg = hl === 'bg';
    const hlIsBlack = hl === 'black';
    const hlIsWhite = hl === 'white';
    const dimAlpha = 0; // fully hide non-highlighted zones

    previewCanvas.width = imageWidth;
    previewCanvas.height = imageHeight;
    const previewData = previewCtx.createImageData(imageWidth, imageHeight);
    const out = previewData.data;

    if (mode === 'hue') {
        // Pre-compute zone colours and bounds to avoid per-pixel object allocations
        const { lo: lumLo, hi: lumHi } = getHueLumRange();
        const zoneLo = new Float64Array(n);
        const zoneHi = new Float64Array(n);
        const zoneWraps = new Uint8Array(n);
        const zoneR = new Uint8Array(n);
        const zoneG = new Uint8Array(n);
        const zoneB = new Uint8Array(n);
        for (let z = 0; z < n; z++) {
            const { lo, hi } = getZoneHueBounds(z, n);
            zoneLo[z] = lo; zoneHi[z] = hi;
            zoneWraps[z] = hi <= lo ? 1 : 0;
            const [cr, cg, cb] = hslToRgb(zoneMidHue(lo, hi), 1.0, 0.5);
            zoneR[z] = cr; zoneG[z] = cg; zoneB[z] = cb;
        }
        const useBk = blackZoneEnabled, useWh = whiteZoneEnabled;
        const bkTh = blackThreshold, whTh = whiteThreshold;

        for (let i = 0; i < total; i++) {
            const si = i * 4;
            const r = data[si], g = data[si + 1], b = data[si + 2];
            const lum = r * 0.299 + g * 0.587 + b * 0.114;
            let pr = 0, pg = 0, pb = 0, zoneTag = 'none';
            if (useBk && lum < bkTh) {
                pr = pg = pb = 20; zoneTag = 'black';
            } else if (useWh && lum >= whTh) {
                pr = pg = pb = 235; zoneTag = 'white';
            } else if (lum >= lumLo && lum < lumHi) {
                const hue = rgbToHue(r, g, b);
                let zi = 0;
                for (let z = 0; z < n; z++) {
                    const inZone = zoneWraps[z]
                        ? (hue >= zoneLo[z] || hue < zoneHi[z])
                        : (hue >= zoneLo[z] && hue < zoneHi[z]);
                    if (inZone) { zi = z; break; }
                }
                pr = zoneR[zi]; pg = zoneG[zi]; pb = zoneB[zi]; zoneTag = zi;
            }
            const active = zoneTag !== 'none' && (hl === null
                || (hlIsNum && zoneTag === hlIdx)
                || (hlIsBlack && zoneTag === 'black')
                || (hlIsWhite && zoneTag === 'white'));
            out[si] = pr; out[si + 1] = pg; out[si + 2] = pb;
            out[si + 3] = active ? 255 : dimAlpha;
        }
    } else {
        // Brightness mode — pre-compute zone grays
        const zoneGray = new Uint8Array(n);
        for (let z = 0; z < n; z++) {
            const { lo, hi } = getZoneBounds(z, n, threshold);
            zoneGray[z] = Math.round((lo + hi) / 2);
        }
        const bgGray = bgEnabled ? Math.round((threshold + 255) / 2) : 255;
        const invThreshold = n / threshold;

        for (let i = 0; i < total; i++) {
            const si = i * 4;
            const lum = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114;
            let v, zi;
            if (lum >= threshold) {
                v = bgGray; zi = -1;
            } else {
                zi = Math.min(n - 1, (lum * invThreshold) | 0);
                v = zoneGray[zi];
            }
            const active = hl === null
                || (hlIsNum && zi === hlIdx)
                || (hlIsBg && zi === -1);
            out[si] = v; out[si + 1] = v; out[si + 2] = v;
            out[si + 3] = active ? 255 : dimAlpha;
        }
    }

    previewCtx.putImageData(previewData, 0, 0);
}

generateBtn.addEventListener('click', function() {
    if (imageWidth === 0 || imageHeight === 0) {
        alert("Please upload an image first.");
        return;
    }

    // Cancel any in-flight packing
    if (_packingWorker) { _packingWorker.terminate(); _packingWorker = null; }

    setPackingBusy(true);
    enableDownload(false);
    statusEl.textContent = "Processing...";

    const W = imageWidth, H = imageHeight;
    const threshold = parseInt(thresholdInput.value, 10);
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const mode = getZoneMode();
    const bgEnabled = document.getElementById('bgZoneEnabled').checked;

    const adjustedData = getAdjustedImageData().data;
    const imgPixels = ctx.getImageData(0, 0, W, H).data;

    // Build zone descriptors for the worker
    const zones = [];
    for (let z = 0; z < n; z++) {
        const zs = getZoneSettingsFromDOM(z);
        const minR = Math.max(1, zs.minR), maxR = Math.max(minR, zs.maxR);
        if (mode === 'hue') {
            const { lo: lumLo, hi: lumHi } = getHueLumRange();
            const { lo, hi } = getZoneHueBounds(z, n);
            zones.push({ type: 'hue', lo, hi, lumLo, lumHi, minR, maxR, colorMode: zs.colorMode, solidColor: zs.solidColor, label: `Zone ${z+1}/${n}` });
        } else {
            const { lo, hi } = getZoneBounds(z, n, threshold);
            zones.push({ type: 'brightness', lo, hi, minR, maxR, colorMode: zs.colorMode, solidColor: zs.solidColor, label: `Zone ${z+1}/${n}` });
        }
    }
    if (mode === 'hue') {
        for (const key of ['black', 'white']) {
            const isBlack = key === 'black';
            if (!(isBlack ? blackZoneEnabled : whiteZoneEnabled)) continue;
            const zs = getZoneSettingsFromDOM(key);
            const minR = Math.max(1, zs.minR), maxR = Math.max(minR, zs.maxR);
            zones.push({ type: 'brightness', lo: isBlack ? 0 : whiteThreshold, hi: isBlack ? blackThreshold : 256,
                         minR, maxR, colorMode: zs.colorMode, solidColor: zs.solidColor, label: `${isBlack ? 'Black' : 'White'} zone` });
        }
    }
    if (mode !== 'hue' && bgEnabled) {
        const zs = getZoneSettingsFromDOM('bg');
        const minR = Math.max(1, zs.minR), maxR = Math.max(minR, zs.maxR);
        zones.push({ type: 'brightness', lo: threshold, hi: 256, minR, maxR, colorMode: zs.colorMode, solidColor: zs.solidColor, label: 'Background zone' });
    }

    function renderResult(circles, totalPlaced) {
        showPreviewSvg();
        const fragment = document.createDocumentFragment();
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', W); bgRect.setAttribute('height', H); bgRect.setAttribute('fill', 'white');
        fragment.appendChild(bgRect);
        for (const c of circles) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            el.setAttribute('cx', c.x); el.setAttribute('cy', c.y);
            el.setAttribute('r', c.r); el.setAttribute('fill', c.fill);
            fragment.appendChild(el);
        }
        outputSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        outputSvg.setAttribute('width', W); outputSvg.setAttribute('height', H);
        outputSvg.innerHTML = '';
        outputSvg.appendChild(fragment);
        const zoneLabel = `${n} zone${n > 1 ? 's' : ''}${bgEnabled ? ' + background' : ''}`;
        statusEl.textContent = `Done. ${totalPlaced} circles placed across ${zoneLabel}.`;
        enableDownload(true);
        setPackingBusy(false);
    }

    // Try Web Worker first; fall back to main-thread packing
    try {
        const worker = new Worker('worker.js');
        _packingWorker = worker;

        worker.onmessage = function(ev) {
            if (ev.data.type === 'progress') {
                statusEl.textContent = ev.data.message;
            } else if (ev.data.type === 'done') {
                _packingWorker = null;
                worker.terminate();
                renderResult(ev.data.circles, ev.data.totalPlaced);
            } else if (ev.data.type === 'error') {
                console.error('Worker threw:', ev.data.message, ev.data.stack);
                _packingWorker = null;
                worker.terminate();
                statusEl.textContent = `Worker error: ${ev.data.message}`;
                generateBtn.disabled = false;
            }
        };

        worker.onerror = function(err) {
            console.error('Worker error:', err.message || err, err.filename, err.lineno);
            _packingWorker = null;
            worker.terminate();
            statusEl.textContent = `Worker error: ${err.message || 'unknown'} — falling back`;
            packCirclesFallback(adjustedData, imgPixels, W, H, n, threshold, mode, bgEnabled, zones, renderResult);
        };
        worker.onmessageerror = function(err) {
            console.error('Worker messageerror:', err);
            statusEl.textContent = 'Worker message error — see console';
        };

        const adjCopy = new Uint8ClampedArray(adjustedData);
        const imgCopy = new Uint8ClampedArray(imgPixels);
        worker.postMessage({ adjustedData: adjCopy, imgPixels: imgCopy, imageWidth: W, imageHeight: H, zones },
                           [adjCopy.buffer, imgCopy.buffer]);
    } catch (e) {
        // Worker constructor threw (e.g. file:// protocol)
        packCirclesFallback(adjustedData, imgPixels, W, H, n, threshold, mode, bgEnabled, zones, renderResult);
    }
});

// --- Circle packing ---
function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2*l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c/2;
    let r=0,g=0,b=0;
    if      (h < 60)  { r=c; g=x; }
    else if (h < 120) { r=x; g=c; }
    else if (h < 180) { g=c; b=x; }
    else if (h < 240) { g=x; b=c; }
    else if (h < 300) { r=x; b=c; }
    else              { r=c; b=x; }
    return [Math.round((r+m)*255), Math.round((g+m)*255), Math.round((b+m)*255)];
}

// Main-thread fallback when Web Worker is unavailable (e.g. file:// protocol)
function packCirclesFallback(adjustedData, imgPixels, W, H, n, threshold, mode, bgEnabled, zones, callback) {
    statusEl.textContent = 'Packing (main thread)...';
    setTimeout(() => {
        const allCircles = [];
        let totalPlaced = 0;
        for (const zone of zones) {
            let binaryMap;
            if (zone.type === 'hue') {
                binaryMap = buildHueZoneBinaryMap(adjustedData, zone.lo, zone.hi, zone.lumLo, zone.lumHi);
            } else {
                binaryMap = buildZoneBinaryMap(adjustedData, zone.lo, zone.hi);
            }
            const distMap = buildDistanceMap(binaryMap);
            const placed = packZone(binaryMap, distMap, zone.minR, zone.maxR);
            totalPlaced += placed.length;
            let globalColor = null;
            if (zone.colorMode === 'global') globalColor = sampleGlobalColor(imgPixels, W, H, placed);
            for (const c of placed) {
                let fill;
                if (zone.colorMode === 'per-circle') fill = sampleCircleColor(imgPixels, W, H, c.x, c.y, c.r);
                else if (zone.colorMode === 'global') fill = globalColor;
                else fill = zone.solidColor;
                allCircles.push({ x: c.x, y: c.y, r: c.r, fill });
            }
        }
        callback(allCircles, totalPlaced);
    }, 20);
}

function buildZoneBinaryMap(adjustedData, lo, hi) {
    const total = imageWidth * imageHeight;
    const binaryMap = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const si = i * 4;
        const lum = adjustedData[si] * 0.299 + adjustedData[si + 1] * 0.587 + adjustedData[si + 2] * 0.114;
        if (lum >= lo && lum < hi) binaryMap[i] = 1;
    }
    return binaryMap;
}

function buildHueZoneBinaryMap(adjustedData, lo, hi, lumLo, lumHi) {
    const total = imageWidth * imageHeight;
    const binaryMap = new Uint8Array(total);
    const wraps = hi <= lo; // hue range wraps around 360°
    for (let i = 0; i < total; i++) {
        const si = i * 4;
        const r = adjustedData[si], g = adjustedData[si+1], b = adjustedData[si+2];
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (lum < lumLo || lum >= lumHi) continue;
        const hue = rgbToHue(r, g, b);
        const inZone = wraps ? (hue >= lo || hue < hi) : (hue >= lo && hue < hi);
        if (inZone) binaryMap[i] = 1;
    }
    return binaryMap;
}

// True Euclidean distance transform (Meijster et al.)
function buildDistanceMap(binaryMap) {
    const W = imageWidth;
    const H = imageHeight;
    const dist = new Float32Array(W * H);

    for (let y = 0; y < H; y++) {
        const row = y * W;
        let d = 0;
        for (let x = 0; x < W; x++) { d = binaryMap[row + x] ? d + 1 : 0; dist[row + x] = d; }
        d = 0;
        for (let x = W - 1; x >= 0; x--) { d = binaryMap[row + x] ? d + 1 : 0; if (d < dist[row + x]) dist[row + x] = d; }
    }

    const f = new Float32Array(H);
    const v = new Int32Array(H);
    const z = new Float32Array(H + 1);

    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) f[y] = dist[y * W + x] * dist[y * W + x];
        let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
        for (let q = 1; q < H; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
            while (k > 0 && s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k])); }
            v[++k] = q; z[k] = s; z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < H; q++) {
            while (z[k + 1] < q) k++;
            const dy = q - v[k];
            dist[q * W + x] = Math.sqrt(f[v[k]] + dy * dy);
        }
    }
    return dist;
}

class MaxHeap {
    constructor() { this.data = []; }
    push(item) { this.data.push(item); this._bubbleUp(this.data.length - 1); }
    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) { this.data[0] = last; this._sinkDown(0); }
        return top;
    }
    get size() { return this.data.length; }
    _bubbleUp(i) {
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.data[p].r >= this.data[i].r) break;
            [this.data[p], this.data[i]] = [this.data[i], this.data[p]]; i = p;
        }
    }
    _sinkDown(i) {
        const n = this.data.length;
        while (true) {
            let lg = i;
            const l = 2*i+1, r = 2*i+2;
            if (l < n && this.data[l].r > this.data[lg].r) lg = l;
            if (r < n && this.data[r].r > this.data[lg].r) lg = r;
            if (lg === i) break;
            [this.data[lg], this.data[i]] = [this.data[i], this.data[lg]]; i = lg;
        }
    }
}

function packZone(binaryMap, distMap, minR, maxR) {
    const W = imageWidth, H = imageHeight;
    const liveDist = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) liveDist[i] = binaryMap[i] ? distMap[i] : 0;

    const heap = new MaxHeap();
    for (let i = 0; i < W * H; i++) {
        if (liveDist[i] >= minR) heap.push({ idx: i, r: liveDist[i] });
    }

    const placed = [];
    while (heap.size > 0) {
        const { idx, r: heapR } = heap.pop();
        const currentR = liveDist[idx];
        if (currentR < minR) continue;
        if (currentR < heapR - 0.5) {
            if (currentR >= minR) heap.push({ idx, r: currentR });
            continue;
        }
        const r = Math.min(currentR, maxR);
        const x = idx % W;
        const y = (idx / W) | 0;
        if (x - r < 0 || x + r > W || y - r < 0 || y + r > H) continue;

        placed.push({ x, y, r });

        const reach = r + Math.max(liveDist[idx], 1) + 1;
        const x0 = Math.max(0, x - reach | 0), x1 = Math.min(W - 1, (x + reach) | 0);
        const y0 = Math.max(0, y - reach | 0), y1 = Math.min(H - 1, (y + reach) | 0);

        for (let py = y0; py <= y1; py++) {
            for (let px = x0; px <= x1; px++) {
                const pidx = py * W + px;
                if (!binaryMap[pidx]) continue;
                const dx = px - x, dy = py - y;
                const newDist = Math.sqrt(dx*dx + dy*dy) - r;
                if (newDist < liveDist[pidx]) {
                    liveDist[pidx] = newDist < 0 ? 0 : newDist;
                    if (liveDist[pidx] >= minR) heap.push({ idx: pidx, r: liveDist[pidx] });
                }
            }
        }
    }
    return placed;
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function sampleCircleColor(data, W, H, cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.ceil(cx - r)), x1 = Math.min(W - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r)), y1 = Math.min(H - 1, Math.floor(cy + r));
    let rS = 0, gS = 0, bS = 0, n = 0;
    for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
            const dx = px - cx, dy = py - cy;
            if (dx*dx + dy*dy <= r2) {
                const si = (py * W + px) * 4;
                rS += data[si]; gS += data[si+1]; bS += data[si+2]; n++;
            }
        }
    }
    return n === 0 ? '#000000' : rgbToHex(Math.round(rS/n), Math.round(gS/n), Math.round(bS/n));
}

function sampleGlobalColor(data, W, H, placed) {
    let rS = 0, gS = 0, bS = 0, n = 0;
    for (const { x, y, r } of placed) {
        const r2 = r * r;
        const x0 = Math.max(0, Math.ceil(x - r)), x1 = Math.min(W - 1, Math.floor(x + r));
        const y0 = Math.max(0, Math.ceil(y - r)), y1 = Math.min(H - 1, Math.floor(y + r));
        for (let py = y0; py <= y1; py++) {
            for (let px = x0; px <= x1; px++) {
                const dx = px - x, dy = py - y;
                if (dx*dx + dy*dy <= r2) {
                    const si = (py * W + px) * 4;
                    rS += data[si]; gS += data[si+1]; bS += data[si+2]; n++;
                }
            }
        }
    }
    return n === 0 ? '#000000' : rgbToHex(Math.round(rS/n), Math.round(gS/n), Math.round(bS/n));
}

function packCircles() {
    const W = imageWidth, H = imageHeight;
    const threshold = parseInt(thresholdInput.value, 10);
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;

    statusEl.textContent = "Adjusting image...";
    const adjustedData = getAdjustedImageData().data;
    const imgPixels = ctx.getImageData(0, 0, W, H).data;

    const fragment = document.createDocumentFragment();
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', W); bg.setAttribute('height', H); bg.setAttribute('fill', 'white');
    fragment.appendChild(bg);

    let totalPlaced = 0;
    const mode = getZoneMode();

    for (let z = 0; z < n; z++) {
        const zs = getZoneSettingsFromDOM(z);
        const minR = Math.max(1, zs.minR);
        const maxR = Math.max(minR, zs.maxR);

        statusEl.textContent = `Zone ${z+1}/${n}: binary map...`;
        let binaryMap;
        if (mode === 'hue') {
            const { lo: lumLo, hi: lumHi } = getHueLumRange();
            const { lo, hi } = getZoneHueBounds(z, n);
            binaryMap = buildHueZoneBinaryMap(adjustedData, lo, hi, lumLo, lumHi);
        } else {
            const { lo, hi } = getZoneBounds(z, n, threshold);
            binaryMap = buildZoneBinaryMap(adjustedData, lo, hi);
        }

        statusEl.textContent = `Zone ${z+1}/${n}: distance map...`;
        const distMap = buildDistanceMap(binaryMap);

        statusEl.textContent = `Zone ${z+1}/${n}: packing...`;
        const placed = packZone(binaryMap, distMap, minR, maxR);
        totalPlaced += placed.length;

        let globalColor;
        if (zs.colorMode === 'global') {
            globalColor = sampleGlobalColor(imgPixels, W, H, placed);
        }

        for (const c of placed) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', c.x);
            circle.setAttribute('cy', c.y);
            circle.setAttribute('r', c.r);
            let fill;
            if (zs.colorMode === 'per-circle') fill = sampleCircleColor(imgPixels, W, H, c.x, c.y, c.r);
            else if (zs.colorMode === 'global') fill = globalColor;
            else fill = zs.solidColor;
            circle.setAttribute('fill', fill);
            fragment.appendChild(circle);
        }
    }

    // Optional black / white zones (hue mode only)
    if (mode === 'hue') {
        for (const key of ['black', 'white']) {
            const isBlack  = key === 'black';
            const enabled  = isBlack ? blackZoneEnabled : whiteZoneEnabled;
            if (!enabled) continue;
            const zs   = getZoneSettingsFromDOM(key);
            const minR = Math.max(1, zs.minR), maxR = Math.max(minR, zs.maxR);
            const lo   = isBlack ? 0 : whiteThreshold;
            const hi   = isBlack ? blackThreshold : 256;
            statusEl.textContent = `${isBlack ? 'Black' : 'White'} zone: packing...`;
            const bm   = buildZoneBinaryMap(adjustedData, lo, hi);
            const dm   = buildDistanceMap(bm);
            const placed = packZone(bm, dm, minR, maxR);
            totalPlaced += placed.length;
            const globalColor = zs.colorMode === 'global' ? sampleGlobalColor(imgPixels, W, H, placed) : null;
            for (const c of placed) {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', c.x); circle.setAttribute('cy', c.y); circle.setAttribute('r', c.r);
                const fill = zs.colorMode === 'per-circle' ? sampleCircleColor(imgPixels, W, H, c.x, c.y, c.r)
                           : zs.colorMode === 'global'     ? globalColor : zs.solidColor;
                circle.setAttribute('fill', fill);
                fragment.appendChild(circle);
            }
        }
    }

    // Optional background zone (luminance >= threshold)
    if (document.getElementById('bgZoneEnabled').checked) {
        const zs = getZoneSettingsFromDOM('bg');
        const minR = Math.max(1, zs.minR), maxR = Math.max(minR, zs.maxR);
        statusEl.textContent = 'Background zone: binary map...';
        const binaryMap = buildZoneBinaryMap(adjustedData, threshold, 256);
        statusEl.textContent = 'Background zone: distance map...';
        const distMap = buildDistanceMap(binaryMap);
        statusEl.textContent = 'Background zone: packing...';
        const placed = packZone(binaryMap, distMap, minR, maxR);
        totalPlaced += placed.length;
        const globalColor = zs.colorMode === 'global' ? sampleGlobalColor(imgPixels, W, H, placed) : null;
        for (const c of placed) {
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', c.x); circle.setAttribute('cy', c.y); circle.setAttribute('r', c.r);
            let fill = zs.colorMode === 'per-circle' ? sampleCircleColor(imgPixels, W, H, c.x, c.y, c.r)
                     : zs.colorMode === 'global'     ? globalColor
                     : zs.solidColor;
            circle.setAttribute('fill', fill);
            fragment.appendChild(circle);
        }
    }

    outputSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    outputSvg.setAttribute('width', W);
    outputSvg.setAttribute('height', H);
    outputSvg.innerHTML = '';
    outputSvg.appendChild(fragment);

    statusEl.textContent = `Done. ${totalPlaced} circles placed across ${n} zone${n>1?'s':''}${document.getElementById('bgZoneEnabled').checked?' + background':''}.`;
    downloadBtn.disabled = false;
}

downloadBtn.addEventListener('click', function() {
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(outputSvg);
    const blob = new Blob([svgStr], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'packed-circles.svg';
    a.click();
    URL.revokeObjectURL(url);
});
