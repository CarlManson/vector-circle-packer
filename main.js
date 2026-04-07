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
            renderThresholdPreview();
        };
        img.src = dataUrl;
    } catch(e) {}
}

// --- Zone mode helpers (in-memory, localStorage is persistence only) ---
let zoneMode       = getSetting('zoneMode', 'brightness');
let hueStart       = parseFloat(getSetting('hueStart', 0));
let blackZoneEnabled = getSetting('blackZoneEnabled', false);
let blackThreshold   = parseInt(getSetting('blackThreshold', 20));
let whiteZoneEnabled = getSetting('whiteZoneEnabled', false);
let whiteThreshold   = parseInt(getSetting('whiteThreshold', 235));
function getZoneMode()  { return zoneMode; }
function getHueStart()  { return hueStart; }
// Effective luminance range for hue zones (shrinks when black/white zones active)
function getHueLumRange() {
    const threshold = parseInt(thresholdInput.value, 10);
    return {
        lo: blackZoneEnabled ? blackThreshold : 0,
        hi: whiteZoneEnabled ? whiteThreshold : threshold,
    };
}

function getZoneBounds(z, n, threshold) {
    const lo = Math.round(z * threshold / n);
    const hi = z === n - 1 ? threshold : Math.round((z + 1) * threshold / n);
    return { lo, hi };
}

function getZoneHueBounds(z, n, offset) {
    const size = 360 / n;
    const lo = (offset + z * size) % 360;
    const hi = (offset + (z + 1) * size) % 360;
    return { lo, hi };
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
    document.getElementById('modeBrightness').classList.toggle('active', mode === 'brightness');
    document.getElementById('modeHue').classList.toggle('active', mode === 'hue');
    document.getElementById('hueStartRow').style.display      = mode === 'hue' ? 'block' : 'none';
    document.getElementById('blackZoneContainer').style.display = mode === 'hue' ? 'block' : 'none';
    document.getElementById('whiteZoneContainer').style.display = mode === 'hue' ? 'block' : 'none';
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
        <div class="zone-row">
            <span>Min R</span>
            <input type="number" class="zone-minR" value="${s.minR}" min="1" max="500">
        </div>
        <div class="zone-row">
            <span>Max R</span>
            <input type="number" class="zone-maxR" value="${s.maxR}" min="1" max="500">
        </div>
        <div class="radio-group" style="margin-top:8px;">
            <label><input type="radio" name="z${zKey}_cm" value="solid"      ${s.colorMode==='solid'?'checked':''}> Solid colour</label>
            <label><input type="radio" name="z${zKey}_cm" value="per-circle" ${s.colorMode==='per-circle'?'checked':''}> Average per circle</label>
            <label><input type="radio" name="z${zKey}_cm" value="global"     ${s.colorMode==='global'?'checked':''}> Global average</label>
        </div>
        <div class="zone-color-wrap" style="margin-top:6px;${s.colorMode!=='solid'?'display:none':''}">
            <input type="color" class="zone-color" value="${s.solidColor}">
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
    panel.className = 'zone-panel';
    panel.dataset.zone = zKey;
    panel.innerHTML = `
        <div class="zone-header">
            <span class="zone-swatch" style="background:${swatchColor}"></span>
            ${label}
            <span class="zone-range">${rangeText}</span>
        </div>
        <div class="zone-body">${zoneControlsHTML(zKey, s)}</div>`;
    wireZoneControls(panel, zKey);
    return panel;
}

function buildNeutralZonePanel(key) {
    // key = 'black' | 'white'
    const isBlack    = key === 'black';
    const enabled    = isBlack ? blackZoneEnabled : whiteZoneEnabled;
    const thresh     = isBlack ? blackThreshold : whiteThreshold;
    const threshold  = parseInt(thresholdInput.value, 10);
    const rangeText  = isBlack ? `L: 0–${thresh}` : `L: ${thresh}–${threshold}`;
    const swatchBg   = isBlack ? '#111' : '#eee';
    const label      = isBlack ? 'Black zone' : 'White zone';
    const sliderMin  = isBlack ? 1   : 128;
    const sliderMax  = isBlack ? 128 : 254;
    const s          = getZoneSettings(key);

    const panel = document.createElement('div');
    panel.className = 'zone-panel';
    panel.dataset.zone = key;
    panel.innerHTML = `
        <div class="zone-header" style="cursor:pointer;gap:6px;">
            <input type="checkbox" style="margin:0;cursor:pointer;" ${enabled ? 'checked' : ''}>
            <span class="zone-swatch" style="background:${swatchBg};border-color:#aaa;"></span>
            ${label}
            <span class="zone-range neutral-range">${rangeText}</span>
        </div>
        <div class="zone-body" ${enabled ? '' : 'style="display:none"'}>
            <div class="adj-row" style="margin-top:4px;">
                <span>${isBlack ? 'Max L' : 'Min L'}</span>
                <input type="range" class="neutral-thresh" min="${sliderMin}" max="${sliderMax}" value="${thresh}">
                <span class="adj-val neutral-thresh-val">${thresh}</span>
            </div>
            ${zoneControlsHTML(key, s)}
        </div>`;

    // Toggle enabled
    const checkbox  = panel.querySelector('input[type="checkbox"]');
    const body      = panel.querySelector('.zone-body');
    const rangeEl   = panel.querySelector('.neutral-range');
    checkbox.addEventListener('change', () => {
        if (isBlack) { blackZoneEnabled = checkbox.checked; saveSetting('blackZoneEnabled', blackZoneEnabled); }
        else         { whiteZoneEnabled = checkbox.checked; saveSetting('whiteZoneEnabled', whiteZoneEnabled); }
        body.style.display = checkbox.checked ? 'block' : 'none';
        if (imageWidth > 0) renderThresholdPreview();
    });

    // Threshold slider
    const threshEl    = panel.querySelector('.neutral-thresh');
    const threshValEl = panel.querySelector('.neutral-thresh-val');
    threshEl.addEventListener('input', () => {
        const v = parseInt(threshEl.value, 10);
        if (isBlack) { blackThreshold = v; saveSetting('blackThreshold', v); rangeEl.textContent = `L: 0–${v}`; }
        else         { whiteThreshold = v; saveSetting('whiteThreshold', v); rangeEl.textContent = `L: ${v}–${threshold}`; }
        threshValEl.textContent = v;
        if (imageWidth > 0) renderThresholdPreview();
    });

    wireZoneControls(panel, key);
    return panel;
}

function renderZonePanels() {
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const threshold = parseInt(thresholdInput.value, 10);
    const mode = getZoneMode();
    const offset = getHueStart();
    const container = document.getElementById('zonesContainer');
    container.innerHTML = '';
    for (let z = 0; z < n; z++) {
        let swatchColor, rangeText;
        if (mode === 'hue') {
            const { lo, hi } = getZoneHueBounds(z, n, offset);
            const midHue = (offset + (z + 0.5) * 360 / n) % 360;
            swatchColor = `hsl(${midHue.toFixed(0)},80%,50%)`;
            rangeText = `${Math.round(lo)}°–${Math.round(hi === 0 ? 360 : hi)}°`;
        } else {
            const { lo, hi } = getZoneBounds(z, n, threshold);
            const midGray = Math.round((lo + hi) / 2);
            swatchColor = `rgb(${midGray},${midGray},${midGray})`;
            rangeText = `L: ${lo}–${hi}`;
        }
        container.appendChild(buildZonePanelEl(z, `Zone ${z + 1}`, swatchColor, rangeText, getZoneSettings(z)));
    }

    // Neutral zones (hue mode only)
    const blackContainer = document.getElementById('blackZoneContainer');
    const whiteContainer = document.getElementById('whiteZoneContainer');
    blackContainer.innerHTML = '';
    whiteContainer.innerHTML = '';
    if (mode === 'hue') {
        blackContainer.appendChild(buildNeutralZonePanel('black'));
        whiteContainer.appendChild(buildNeutralZonePanel('white'));
    }

    renderBgZonePanel();
}

function renderBgZonePanel() {
    const threshold = parseInt(thresholdInput.value, 10);
    const enabled = document.getElementById('bgZoneEnabled').checked;
    const container = document.getElementById('bgZoneContainer');
    container.innerHTML = '';
    if (!enabled) return;
    const midGray = Math.round((threshold + 255) / 2);
    container.appendChild(buildZonePanelEl('bg', 'Background',
        `rgb(${midGray},${midGray},${midGray})`, `L: ${threshold}–255`, getZoneSettings('bg')));
}

function getZoneSettingsFromDOM(zKey) {
    const panel = document.querySelector(`.zone-panel[data-zone="${zKey}"]`);
    if (!panel) return getZoneSettings(zKey);
    return {
        minR:      Math.max(1, parseInt(panel.querySelector('.zone-minR').value, 10) || 2),
        maxR:      parseInt(panel.querySelector('.zone-maxR').value, 10) || 100,
        colorMode: panel.querySelector(`input[name="z${zKey}_cm"]:checked`)?.value || 'solid',
        solidColor:panel.querySelector('.zone-color').value || '#000000',
    };
}

// --- Load settings ---
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        if (s.threshold !== undefined) { thresholdInput.value = s.threshold; thresholdVal.textContent = s.threshold; }
        if (s.numZones !== undefined) document.getElementById('numZones').value = s.numZones;
        if (s.bgZoneEnabled !== undefined) document.getElementById('bgZoneEnabled').checked = s.bgZoneEnabled;
        if (s.zoneMode      !== undefined) zoneMode      = s.zoneMode;
        if (s.hueStart      !== undefined) { hueStart = parseFloat(s.hueStart); document.getElementById('hueStart').value = s.hueStart; document.getElementById('hueStartVal').textContent = Math.round(s.hueStart) + '°'; }
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
    } catch(e) {}
    updateModeUI();
    renderZonePanels();
}

loadSettings();
restoreImage();

// --- Event listeners ---
document.getElementById('modeBrightness').addEventListener('click', () => {
    zoneMode = 'brightness';
    saveSetting('zoneMode', zoneMode);
    updateModeUI();
    renderZonePanels();
    if (imageWidth > 0) renderThresholdPreview();
});
document.getElementById('modeHue').addEventListener('click', () => {
    zoneMode = 'hue';
    saveSetting('zoneMode', zoneMode);
    updateModeUI();
    renderZonePanels();
    if (imageWidth > 0) renderThresholdPreview();
});
document.getElementById('hueStart').addEventListener('input', e => {
    hueStart = parseFloat(e.target.value);
    document.getElementById('hueStartVal').textContent = Math.round(hueStart) + '°';
    saveSetting('hueStart', hueStart);
    renderZonePanels();
    if (imageWidth > 0) renderThresholdPreview();
});

thresholdInput.addEventListener('input', () => {
    thresholdVal.textContent = thresholdInput.value;
    saveSetting('threshold', thresholdInput.value);
    renderZonePanels();
    if (imageWidth > 0) renderThresholdPreview();
});

document.getElementById('numZones').addEventListener('change', e => {
    saveSetting('numZones', e.target.value);
    renderZonePanels();
    if (imageWidth > 0) renderThresholdPreview();
});

document.getElementById('bgZoneEnabled').addEventListener('change', e => {
    saveSetting('bgZoneEnabled', e.target.checked);
    renderBgZonePanel();
    if (imageWidth > 0) renderThresholdPreview();
});

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
        if (imageWidth > 0) renderThresholdPreview();
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
            hiddenCanvas.width = imageWidth;
            hiddenCanvas.height = imageHeight;
            ctx.drawImage(img, 0, 0, imageWidth, imageHeight);
            saveImage();
            outputSvg.setAttribute('viewBox', `0 0 ${imageWidth} ${imageHeight}`);
            outputSvg.setAttribute('width', imageWidth);
            outputSvg.setAttribute('height', imageHeight);
            statusEl.textContent = `Image loaded: ${imageWidth}×${imageHeight}px`;
            downloadBtn.disabled = true;
            renderThresholdPreview();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
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

function renderThresholdPreview() {
    const imageData = getAdjustedImageData();
    const data = imageData.data;
    const threshold = parseInt(thresholdInput.value, 10);
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const mode = getZoneMode();
    const offset = getHueStart();
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
                    const { lo, hi } = getZoneHueBounds(z, n, offset);
                    const wraps = hi <= lo;
                    if (wraps ? (hue >= lo || hue < hi) : (hue >= lo && hue < hi)) { zoneIdx = z; break; }
                }
                const midHue = (offset + (zoneIdx + 0.5) * 360 / n) % 360;
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
    const offset = getHueStart();

    for (let z = 0; z < n; z++) {
        const zs = getZoneSettingsFromDOM(z);
        const minR = Math.max(1, zs.minR);
        const maxR = Math.max(minR, zs.maxR);

        statusEl.textContent = `Zone ${z+1}/${n}: binary map...`;
        let binaryMap;
        if (mode === 'hue') {
            const { lo: lumLo, hi: lumHi } = getHueLumRange();
            const { lo, hi } = getZoneHueBounds(z, n, offset);
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
