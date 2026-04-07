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

// --- Zone settings ---
const ZONE_DEFAULTS = { minR: 2, maxR: 100, colorMode: 'solid', solidColor: '#000000' };

function getZoneSettings(z) {
    return {
        minR:      getSetting(`zone_${z}_minR`,      z === 0 ? 2 : 2),
        maxR:      getSetting(`zone_${z}_maxR`,      100),
        colorMode: getSetting(`zone_${z}_colorMode`, 'solid'),
        solidColor:getSetting(`zone_${z}_solidColor`, '#000000'),
    };
}

function saveZoneSetting(z, key, value) {
    saveSetting(`zone_${z}_${key}`, value);
}

function getZoneBounds(z, n, threshold) {
    const lo = Math.round(z * threshold / n);
    const hi = z === n - 1 ? threshold : Math.round((z + 1) * threshold / n);
    return { lo, hi };
}

function buildZonePanelEl(zKey, label, lo, hi, s) {
    const midGray = Math.round((lo + hi) / 2);
    const panel = document.createElement('div');
    panel.className = 'zone-panel';
    panel.dataset.zone = zKey;
    panel.innerHTML = `
        <div class="zone-header">
            <span class="zone-swatch" style="background:rgb(${midGray},${midGray},${midGray})"></span>
            ${label}
            <span class="zone-range">L: ${lo}–${hi}</span>
        </div>
        <div class="zone-body">
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
            </div>
        </div>`;

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
    return panel;
}

function renderZonePanels() {
    const n = parseInt(document.getElementById('numZones').value, 10) || 1;
    const threshold = parseInt(thresholdInput.value, 10);
    const container = document.getElementById('zonesContainer');
    container.innerHTML = '';
    for (let z = 0; z < n; z++) {
        const { lo, hi } = getZoneBounds(z, n, threshold);
        container.appendChild(buildZonePanelEl(z, `Zone ${z + 1}`, lo, hi, getZoneSettings(z)));
    }
    renderBgZonePanel();
}

function renderBgZonePanel() {
    const threshold = parseInt(thresholdInput.value, 10);
    const enabled = document.getElementById('bgZoneEnabled').checked;
    const container = document.getElementById('bgZoneContainer');
    container.innerHTML = '';
    if (!enabled) return;
    container.appendChild(buildZonePanelEl('bg', 'Background', threshold, 255, getZoneSettings('bg')));
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
    renderZonePanels();
}

loadSettings();
restoreImage();

// --- Event listeners ---
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

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = imageWidth;
    previewCanvas.height = imageHeight;
    const pCtx = previewCanvas.getContext('2d');
    const previewData = pCtx.createImageData(imageWidth, imageHeight);

    for (let i = 0; i < imageWidth * imageHeight; i++) {
        const si = i * 4;
        const lum = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114;
        let v;
        if (lum >= threshold) {
            const bgEnabled = document.getElementById('bgZoneEnabled').checked;
            v = bgEnabled ? Math.round((threshold + 255) / 2) : 255;
        } else {
            const z = Math.min(n - 1, Math.floor(lum * n / threshold));
            const { lo, hi } = getZoneBounds(z, n, threshold);
            v = Math.round((lo + hi) / 2);
        }
        previewData.data[si]     = v;
        previewData.data[si + 1] = v;
        previewData.data[si + 2] = v;
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

    for (let z = 0; z < n; z++) {
        const { lo, hi } = getZoneBounds(z, n, threshold);
        const zs = getZoneSettingsFromDOM(z);
        const minR = Math.max(1, zs.minR);
        const maxR = Math.max(minR, zs.maxR);

        statusEl.textContent = `Zone ${z+1}/${n}: binary map...`;
        const binaryMap = buildZoneBinaryMap(adjustedData, lo, hi);

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
