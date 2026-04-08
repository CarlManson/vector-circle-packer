const imageUpload = document.getElementById('imageUpload');
const hiddenCanvas = document.getElementById('hiddenCanvas');
const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
const outputSvg = document.getElementById('outputSvg');
const thresholdInput = document.getElementById('threshold');
const thresholdVal = document.getElementById('thresholdVal');
const generateBtn = document.getElementById('generateBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');

let imageWidth = 0;
let imageHeight = 0;

const TARGET_WIDTH = 1000;

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
            outputSvg.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
            outputSvg.setAttribute('width', imageWidth);
            outputSvg.setAttribute('height', imageHeight);
            statusEl.textContent = `Image restored: ${imageWidth}×${imageHeight}px`;
            downloadBtn.disabled = true;
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
    if (newN < current.length) {
        zoneHueStarts = current.slice(0, newN);
    } else {
        const result = [...current];
        while (result.length < newN) {
            let maxGap = -1, maxIdx = 0;
            for (let i = 0; i < result.length; i++) {
                const lo = result[i], hi = result[(i + 1) % result.length];
                const gap = hi > lo ? hi - lo : hi + 360 - lo;
                if (gap > maxGap) { maxGap = gap; maxIdx = i; }
            }
            const lo = result[maxIdx], hi = result[(maxIdx + 1) % result.length];
            const mid = hi > lo ? (lo + hi) / 2 : (lo + hi + 360) / 2 % 360;
            result.splice(maxIdx + 1, 0, mid);
        }
        zoneHueStarts = result;
    }
    saveSetting('zoneHueStarts', zoneHueStarts);
}

function zoneMidHue(lo, hi) {
    if (hi > lo) return (lo + hi) / 2;
    return (lo + (hi + 360 - lo) / 2) % 360;
}

function hueToAngle(hue) { return (hue - 90) * Math.PI / 180; }

function updateBgZoneVisibility() {
    const section = document.getElementById('bgZoneSection');
    if (section) section.style.display = (zoneMode === 'hue' && whiteZoneEnabled) ? 'none' : 'block';
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

function buildNeutralZonePanel(key, swatchColor) {
    const isBlack   = key === 'black';
    const enabled   = isBlack ? blackZoneEnabled : whiteZoneEnabled;
    const thresh    = isBlack ? blackThreshold : whiteThreshold;
    const threshold = parseInt(thresholdInput.value, 10);
    const rangeText = isBlack ? `L: 0–${thresh}` : `L: ${thresh}–${threshold}`;
    const swatchBg  = swatchColor || (isBlack ? '#111' : '#eee');
    const label     = isBlack ? 'Black zone' : 'White zone';
    const sliderMin = isBlack ? 1   : 128;
    const sliderMax = isBlack ? 128 : 254;
    const s         = getZoneSettings(key);

    const panel = document.createElement('div');
    panel.className = 'card zone-card';
    panel.dataset.zone = key;
    panel.innerHTML = `
        <div class="card-header" style="cursor:pointer;">
            <div class="form-check form-check-inline m-0 me-1">
                <input class="form-check-input" type="checkbox" ${enabled ? 'checked' : ''}>
            </div>
            <span class="zone-swatch" style="background:${swatchBg};border-color:#999;"></span>
            ${label}
            <span class="zone-range neutral-range">${rangeText}</span>
        </div>
        <div class="card-body" ${enabled ? '' : 'style="display:none"'}>
            <div class="neutral-thresh-row">
                <label>${isBlack ? 'Max L' : 'Min L'}</label>
                <input type="range" class="form-range neutral-thresh" min="${sliderMin}" max="${sliderMax}" value="${thresh}">
                <span class="val neutral-thresh-val">${thresh}</span>
            </div>
            ${zoneControlsHTML(key, s)}
        </div>`;

    const checkbox  = panel.querySelector('input[type="checkbox"]');
    const body      = panel.querySelector('.card-body');
    const rangeEl   = panel.querySelector('.neutral-range');
    checkbox.addEventListener('change', () => {
        if (isBlack) { blackZoneEnabled = checkbox.checked; saveSetting('blackZoneEnabled', blackZoneEnabled); }
        else         { whiteZoneEnabled = checkbox.checked; saveSetting('whiteZoneEnabled', whiteZoneEnabled); }
        body.style.display = checkbox.checked ? 'block' : 'none';
        if (!isBlack) updateBgZoneVisibility();
        if (imageWidth > 0) renderZonePreview();
    });

    const threshEl    = panel.querySelector('.neutral-thresh');
    const threshValEl = panel.querySelector('.neutral-thresh-val');
    threshEl.addEventListener('input', () => {
        const v = parseInt(threshEl.value, 10);
        if (isBlack) { blackThreshold = v; saveSetting('blackThreshold', v); rangeEl.textContent = `L: 0–${v}`; }
        else         { whiteThreshold = v; saveSetting('whiteThreshold', v); rangeEl.textContent = `L: ${v}–${threshold}`; }
        threshValEl.textContent = v;
        if (imageWidth > 0) renderZonePreview();
    });

    wireZoneControls(panel, key);
    return panel;
}

function drawHueWheel(canvas, n) {
    const cw = canvas.width;
    const cx = cw / 2, cy = cw / 2;
    const R  = cw * 0.40;
    const r  = cw * 0.26;
    const c  = canvas.getContext('2d');
    c.clearRect(0, 0, cw, cw);
    const starts = ensureHueStarts(n);

    // Zone sectors
    for (let z = 0; z < n; z++) {
        const { lo, hi } = getZoneHueBounds(z, n);
        const a1 = hueToAngle(lo);
        const a2 = hueToAngle(hi > lo ? hi : hi + 360);
        c.beginPath();
        c.moveTo(cx, cy);
        c.arc(cx, cy, r - 2, a1, a2);
        c.closePath();
        c.fillStyle = `hsl(${zoneMidHue(lo, hi).toFixed(0)},70%,65%)`;
        c.fill();
    }

    // Hue ring
    for (let i = 0; i < 360; i++) {
        const a1 = hueToAngle(i), a2 = hueToAngle(i + 1);
        c.beginPath();
        c.arc(cx, cy, R, a1, a2);
        c.arc(cx, cy, r, a2, a1, true);
        c.closePath();
        c.fillStyle = `hsl(${i},100%,50%)`;
        c.fill();
    }

    // Boundary lines
    for (let z = 0; z < n; z++) {
        const a = hueToAngle(starts[z]);
        c.beginPath();
        c.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        c.lineTo(cx + (R + 3) * Math.cos(a), cy + (R + 3) * Math.sin(a));
        c.strokeStyle = 'white';
        c.lineWidth = 2;
        c.stroke();
    }

    // Drag handles
    const NH = cw * 0.055;
    for (let z = 0; z < n; z++) {
        const a = hueToAngle(starts[z]);
        const hx = cx + R * Math.cos(a), hy = cy + R * Math.sin(a);
        c.beginPath();
        c.arc(hx, hy, NH, 0, Math.PI * 2);
        c.fillStyle = 'white';
        c.fill();
        c.strokeStyle = '#333';
        c.lineWidth = 1.5;
        c.stroke();
        c.fillStyle = '#333';
        c.font = `bold ${Math.round(cw * 0.07)}px system-ui`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(z + 1, hx, hy);
    }
}

function setupHueWheelDrag(canvas, n, onUpdate) {
    const cw = canvas.width;
    const cx = cw / 2, cy = cw / 2;
    const R  = cw * 0.40;
    const NH = cw * 0.055 + 5;
    let drag = -1;

    function evPos(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = cw / rect.width, sy = cw / rect.height;
        const t = e.touches ? e.touches[0] : e;
        return { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy };
    }
    function angleToHue(x, y) {
        let d = Math.atan2(y - cy, x - cx) * 180 / Math.PI + 90;
        if (d < 0) d += 360;
        if (d >= 360) d -= 360;
        return d;
    }
    function hitTest(x, y) {
        const starts = ensureHueStarts(n);
        for (let z = 0; z < n; z++) {
            const a = hueToAngle(starts[z]);
            const hx = cx + R * Math.cos(a), hy = cy + R * Math.sin(a);
            if ((x-hx)**2 + (y-hy)**2 <= NH*NH) return z;
        }
        return -1;
    }

    canvas.addEventListener('pointerdown', e => {
        const p = evPos(e); drag = hitTest(p.x, p.y);
        if (drag >= 0) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; }
    });
    canvas.addEventListener('pointermove', e => {
        if (drag < 0) return;
        const p = evPos(e);
        zoneHueStarts[drag] = angleToHue(p.x, p.y);
        saveSetting('zoneHueStarts', zoneHueStarts);
        drawHueWheel(canvas, n);
        onUpdate();
    });
    canvas.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; canvas.style.cursor = 'grab'; } });
    canvas.addEventListener('pointercancel', () => { drag = -1; });
}

function computeAllSwatches(n) {
    if (imageWidth === 0) return null;
    const mode = getZoneMode();
    const threshold = parseInt(thresholdInput.value, 10);
    const data = getAdjustedImageData().data;
    const total = imageWidth * imageHeight;
    const zS = Array.from({length: n}, () => [0,0,0,0]);
    let bkS = [0,0,0,0], wS = [0,0,0,0], bgS = [0,0,0,0];
    const { lo: lumLo, hi: lumHi } = mode === 'hue' ? getHueLumRange() : { lo: 0, hi: threshold };

    for (let i = 0; i < total; i++) {
        const si = i * 4;
        const r = data[si], g = data[si+1], b = data[si+2];
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (lum >= threshold) { bgS[0]+=r; bgS[1]+=g; bgS[2]+=b; bgS[3]++; continue; }
        if (mode === 'hue') {
            if (blackZoneEnabled && lum < blackThreshold) { bkS[0]+=r; bkS[1]+=g; bkS[2]+=b; bkS[3]++; }
            else if (whiteZoneEnabled && lum >= whiteThreshold) { wS[0]+=r; wS[1]+=g; wS[2]+=b; wS[3]++; }
            else if (lum >= lumLo && lum < lumHi) {
                const hue = rgbToHue(r, g, b);
                for (let z = 0; z < n; z++) {
                    const { lo, hi } = getZoneHueBounds(z, n);
                    const wraps = hi <= lo;
                    if (wraps ? (hue >= lo || hue < hi) : (hue >= lo && hue < hi)) {
                        zS[z][0]+=r; zS[z][1]+=g; zS[z][2]+=b; zS[z][3]++; break;
                    }
                }
            }
        } else {
            const z = Math.min(n-1, Math.floor(lum * n / threshold));
            zS[z][0]+=r; zS[z][1]+=g; zS[z][2]+=b; zS[z][3]++;
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
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 240;
    canvas.style.cssText = 'width:100%;aspect-ratio:1;display:block;cursor:grab;margin-bottom:.5rem;border-radius:4px;';
    wheelContainer.appendChild(canvas);
    drawHueWheel(canvas, n);
    setupHueWheelDrag(canvas, n, () => {
        // Live update: just refresh zone preview (swatch recompute skipped for speed)
        updateAccordionRanges(n);
        if (imageWidth > 0) renderZonePreview();
    });
}

function updateAccordionRanges(n) {
    for (let z = 0; z < n; z++) {
        const item = document.querySelector(`#zonesAccordion [data-zone="${z}"]`);
        if (!item) continue;
        const { lo, hi } = getZoneHueBounds(z, n);
        const sw = item.querySelector('.zone-swatch');
        if (sw) sw.style.background = `hsl(${zoneMidHue(lo, hi).toFixed(0)},80%,50%)`;
        const rng = item.querySelector('.zone-range');
        if (rng) rng.textContent = `${Math.round(lo)}°–${Math.round(hi === 0 ? 360 : hi)}°`;
    }
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
        bc.appendChild(buildNeutralZonePanel('black', null));
        wc.appendChild(buildNeutralZonePanel('white', null));
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

    for (let z = 0; z < n; z++) {
        let swatchColor, rangeText;
        if (mode === 'hue') {
            const { lo, hi } = getZoneHueBounds(z, n);
            swatchColor = sw?.zones[z] || `hsl(${zoneMidHue(lo, hi).toFixed(0)},80%,50%)`;
            rangeText = `${Math.round(lo)}°–${Math.round(hi === 0 ? 360 : hi)}°`;
        } else {
            const { lo, hi } = getZoneBounds(z, n, threshold);
            const mid = Math.round((lo + hi) / 2);
            swatchColor = sw?.zones[z] || `rgb(${mid},${mid},${mid})`;
            rangeText = `L: ${lo}–${hi}`;
        }
        accordion.appendChild(buildZoneAccordionItem(z, `Zone ${z + 1}`, swatchColor, rangeText, getZoneSettings(z), z === 0));
    }

    // Neutral zones (hue mode)
    if (mode === 'hue') {
        for (const key of ['black', 'white']) {
            const isBlack = key === 'black';
            const enabled = isBlack ? blackZoneEnabled : whiteZoneEnabled;
            if (!enabled) continue;
            const lo = isBlack ? 0 : whiteThreshold;
            const hi = isBlack ? blackThreshold : threshold;
            const label = isBlack ? 'Black zone' : 'White zone';
            const swatch = sw?.[key] || (isBlack ? '#111' : '#eee');
            accordion.appendChild(buildZoneAccordionItem(key, label, swatch, `L: ${lo}–${hi}`, getZoneSettings(key), false));
        }
    }

    renderBgZonePanel(sw?.bg);
    updateBgZoneVisibility();
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
        <div id="${colId}" class="accordion-collapse collapse${expanded ? ' show' : ''}">
            <div class="accordion-body">${zoneControlsHTML(zKey, s)}</div>
        </div>`;
    wireZoneControls(item, zKey);
    return item;
}

function renderBgZonePanel(swatchColor) {
    const threshold = parseInt(thresholdInput.value, 10);
    const enabled = document.getElementById('bgZoneEnabled').checked;
    const container = document.getElementById('bgZoneContainer');
    container.innerHTML = '';
    if (!enabled) return;
    const midGray = Math.round((threshold + 255) / 2);
    const swatch = swatchColor || `rgb(${midGray},${midGray},${midGray})`;
    container.appendChild(buildZonePanelEl('bg', 'Background', swatch, `L: ${threshold}–255`, getZoneSettings('bg')));
}

function getZoneSettingsFromDOM(zKey) {
    const panel = document.querySelector(`[data-zone="${zKey}"]`);
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
    document.querySelectorAll('.step-panel').forEach((p, i) => p.classList.toggle('d-none', i !== n));
    document.querySelectorAll('.step-btn').forEach((b, i) => b.classList.toggle('active', i === n));
    document.getElementById('prevBtn').disabled = (n === 0);
    const nextBtn = document.getElementById('nextBtn');
    nextBtn.style.display = n === 3 ? 'none' : '';
    document.getElementById('stepLabel').textContent = `Step ${n + 1} of 4`;

    if (n === 0) {
        if (imageWidth > 0) renderAdjustedPreview();
    } else if (n === 1) {
        if (imageWidth > 0) renderZonePreview();
    } else if (n === 2) {
        buildPanel3();
        if (imageWidth > 0) renderZonePreview();
    } else if (n === 3) {
        buildPanel4();
        // keep current preview
    }
    saveSetting('currentStep', n);
}

// --- Preview functions ---
function renderAdjustedPreview() {
    if (imageWidth === 0) return;
    const imageData = getAdjustedImageData();
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = imageWidth; tmpCanvas.height = imageHeight;
    tmpCanvas.getContext('2d').putImageData(imageData, 0, 0);
    outputSvg.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
    outputSvg.setAttribute('width', imageWidth);
    outputSvg.setAttribute('height', imageHeight);
    outputSvg.innerHTML = '';
    const imgEl = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    imgEl.setAttribute('width', imageWidth); imgEl.setAttribute('height', imageHeight);
    imgEl.setAttribute('href', tmpCanvas.toDataURL());
    outputSvg.appendChild(imgEl);
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
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});
document.getElementById('modeHue').addEventListener('click', () => {
    zoneMode = 'hue';
    saveSetting('zoneMode', zoneMode);
    updateModeUI();
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});

thresholdInput.addEventListener('input', () => {
    thresholdVal.textContent = thresholdInput.value;
    saveSetting('threshold', thresholdInput.value);
    if (imageWidth > 0) renderZonePreview();
    if (currentStep === 2) buildZoneSummary(parseInt(document.getElementById('numZones').value) || 1);
});

// --- Zone count (panel 3) ---
document.getElementById('numZones').addEventListener('change', e => {
    const newN = parseInt(e.target.value, 10) || 1;
    if (getZoneMode() === 'hue') resizeHueStarts(newN);
    saveSetting('numZones', e.target.value);
    if (currentStep === 2) buildPanel3();
    if (currentStep === 3) buildPanel4();
    if (imageWidth > 0) renderZonePreview();
});

// --- Background zone (panel 4) ---
document.getElementById('bgZoneEnabled').addEventListener('change', e => {
    saveSetting('bgZoneEnabled', e.target.checked);
    renderBgZonePanel();
    updateBgZoneVisibility();
});

// --- Image adjustment sliders (panel 1) ---
[
    { id: 'brightness', label: 'brightnessVal', decimals: 0 },
    { id: 'contrast',   label: 'contrastVal',   decimals: 0 },
    { id: 'gamma',      label: 'gammaVal',       decimals: 2 },
    { id: 'blur',       label: 'blurVal',        decimals: 1 },
].forEach(({ id, label, decimals }) => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(label);
    el.addEventListener('input', () => {
        valEl.textContent = parseFloat(el.value).toFixed(decimals);
        saveSetting(id, el.value);
        if (imageWidth === 0) return;
        if (currentStep === 0) renderAdjustedPreview();
        else renderZonePreview();
    });
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
            saveImage();
            outputSvg.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
            outputSvg.setAttribute('width', imageWidth);
            outputSvg.setAttribute('height', imageHeight);
            statusEl.textContent = `Image loaded: ${imageWidth}×${imageHeight}px`;
            downloadBtn.disabled = true;
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
    return imageData;
}

function renderZonePreview() {
    const imageData = getAdjustedImageData();
    const data = imageData.data;
    const threshold = parseInt(thresholdInput.value, 10);
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const mode = getZoneMode();
    const bgEnabled = document.getElementById('bgZoneEnabled').checked;

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = imageWidth;
    previewCanvas.height = imageHeight;
    const pCtx = previewCanvas.getContext('2d');
    const previewData = pCtx.createImageData(imageWidth, imageHeight);

    for (let i = 0; i < imageWidth * imageHeight; i++) {
        const si = i * 4;
        const r = data[si], g = data[si+1], b = data[si+2];
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        let pr, pg, pb;

        if (lum >= threshold) {
            if (bgEnabled) {
                const midGray = Math.round((threshold + 255) / 2);
                pr = pg = pb = midGray;
            } else {
                pr = pg = pb = 255;
            }
        } else if (mode === 'hue') {
            const { lo: lumLo, hi: lumHi } = getHueLumRange();
            if (blackZoneEnabled && lum < blackThreshold) {
                pr = pg = pb = 20; // dark swatch for black zone
            } else if (whiteZoneEnabled && lum >= whiteThreshold) {
                pr = pg = pb = 235; // light swatch for white zone
            } else if (lum >= lumLo && lum < lumHi) {
                const hue = rgbToHue(r, g, b);
                let zoneIdx = 0;
                for (let z = 0; z < n; z++) {
                    const { lo, hi } = getZoneHueBounds(z, n);
                    const wraps = hi <= lo;
                    if (wraps ? (hue >= lo || hue < hi) : (hue >= lo && hue < hi)) { zoneIdx = z; break; }
                }
                const { lo: zlo, hi: zhi } = getZoneHueBounds(zoneIdx, n);
                const midHue = zoneMidHue(zlo, zhi);
                const [hr, hg, hb] = hslToRgb(midHue, 0.8, 0.5);
                pr = hr; pg = hg; pb = hb;
            } else {
                pr = pg = pb = 255; // gap pixels → white
            }
        } else {
            const z = Math.min(n - 1, Math.floor(lum * n / threshold));
            const { lo, hi } = getZoneBounds(z, n, threshold);
            pr = pg = pb = Math.round((lo + hi) / 2);
        }

        previewData.data[si]     = pr;
        previewData.data[si + 1] = pg;
        previewData.data[si + 2] = pb;
        previewData.data[si + 3] = 255;
    }
    pCtx.putImageData(previewData, 0, 0);

    outputSvg.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
    outputSvg.setAttribute('width', imageWidth);
    outputSvg.setAttribute('height', imageHeight);
    outputSvg.innerHTML = '';
    const imgEl = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    imgEl.setAttribute('width', imageWidth);
    imgEl.setAttribute('height', imageHeight);
    imgEl.setAttribute('href', previewCanvas.toDataURL());
    outputSvg.appendChild(imgEl);
}

generateBtn.addEventListener('click', function() {
    if (imageWidth === 0 || imageHeight === 0) {
        alert("Please upload an image first.");
        return;
    }
    generateBtn.disabled = true;
    downloadBtn.disabled = true;
    statusEl.textContent = "Processing...";
    setTimeout(() => {
        try { packCircles(); } finally { generateBtn.disabled = false; }
    }, 20);
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
            const hi   = isBlack ? blackThreshold : threshold;
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
