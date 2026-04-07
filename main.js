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

function saveSetting(key, value) {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        s[key] = value;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch(e) {}
}

function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        if (s.threshold !== undefined) { thresholdInput.value = s.threshold; thresholdVal.textContent = s.threshold; }
        if (s.minRadius !== undefined) document.getElementById('minRadius').value = s.minRadius;
        if (s.maxRadius !== undefined) document.getElementById('maxRadius').value = s.maxRadius;
        if (s.colorMode !== undefined) {
            const radio = document.querySelector(`input[name="colorMode"][value="${s.colorMode}"]`);
            if (radio) radio.checked = true;
        }
        if (s.circleColor !== undefined) document.getElementById('circleColor').value = s.circleColor;
    } catch(e) {}
    updateColorPickerVisibility();
}

function updateColorPickerVisibility() {
    const mode = document.querySelector('input[name="colorMode"]:checked')?.value;
    document.getElementById('colorPickerWrap').style.display = mode === 'solid' ? 'block' : 'none';
}

document.querySelectorAll('input[name="colorMode"]').forEach(r => {
    r.addEventListener('change', () => {
        saveSetting('colorMode', r.value);
        updateColorPickerVisibility();
    });
});
document.getElementById('circleColor').addEventListener('input', e => saveSetting('circleColor', e.target.value));
document.getElementById('minRadius').addEventListener('change', e => saveSetting('minRadius', e.target.value));
document.getElementById('maxRadius').addEventListener('change', e => saveSetting('maxRadius', e.target.value));

loadSettings();

thresholdInput.addEventListener('input', () => {
    thresholdVal.textContent = thresholdInput.value;
    saveSetting('threshold', thresholdInput.value);
    if (imageWidth > 0) renderThresholdPreview();
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

function renderThresholdPreview() {
    const imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
    const data = imageData.data;
    const threshold = parseInt(thresholdInput.value, 10);

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = imageWidth;
    previewCanvas.height = imageHeight;
    const pCtx = previewCanvas.getContext('2d');
    const previewData = pCtx.createImageData(imageWidth, imageHeight);

    for (let i = 0; i < imageWidth * imageHeight; i++) {
        const si = i * 4;
        const luminance = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114;
        const v = luminance < threshold ? 0 : 255;
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
        try {
            packCircles();
        } finally {
            generateBtn.disabled = false;
        }
    }, 20);
});

function buildBinaryMap() {
    const imageData = ctx.getImageData(0, 0, imageWidth, imageHeight);
    const data = imageData.data;
    const threshold = parseInt(thresholdInput.value, 10);
    const binaryMap = new Uint8Array(imageWidth * imageHeight);

    for (let i = 0; i < imageWidth * imageHeight; i++) {
        const si = i * 4;
        const luminance = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114;
        if (luminance < threshold) binaryMap[i] = 1;
    }
    return binaryMap;
}

// True Euclidean distance transform (Meijster et al.)
// Returns per-pixel distance to nearest background pixel. Border treated as background.
function buildDistanceMap(binaryMap) {
    const W = imageWidth;
    const H = imageHeight;
    const dist = new Float32Array(W * H);

    // Phase 1: horizontal 1D distance to nearest background, treating border as background
    for (let y = 0; y < H; y++) {
        const row = y * W;
        let d = 0;
        for (let x = 0; x < W; x++) {
            d = binaryMap[row + x] ? d + 1 : 0;
            dist[row + x] = d;
        }
        d = 0;
        for (let x = W - 1; x >= 0; x--) {
            d = binaryMap[row + x] ? d + 1 : 0;
            if (d < dist[row + x]) dist[row + x] = d;
        }
    }

    // Phase 2: vertical Euclidean DT using parabola envelope
    const f = new Float32Array(H);
    const v = new Int32Array(H);
    const z = new Float32Array(H + 1);

    for (let x = 0; x < W; x++) {
        // Read column into f (squared horizontal distances)
        for (let y = 0; y < H; y++) f[y] = dist[y * W + x] * dist[y * W + x];

        // Build lower envelope of parabolas
        let k = 0;
        v[0] = 0;
        z[0] = -Infinity;
        z[1] = Infinity;

        for (let q = 1; q < H; q++) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
            while (k > 0 && s <= z[k]) {
                k--;
                s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
            }
            k++;
            v[k] = q;
            z[k] = s;
            z[k + 1] = Infinity;
        }

        // Fill in distances
        k = 0;
        for (let q = 0; q < H; q++) {
            while (z[k + 1] < q) k++;
            const dy = q - v[k];
            dist[q * W + x] = Math.sqrt(f[v[k]] + dy * dy);
        }
    }

    return dist;
}

// Simple max-heap keyed on float value
class MaxHeap {
    constructor() { this.data = []; }

    push(item) {
        this.data.push(item);
        this._bubbleUp(this.data.length - 1);
    }

    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._sinkDown(0);
        }
        return top;
    }

    get size() { return this.data.length; }

    _bubbleUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.data[parent].r >= this.data[i].r) break;
            [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
            i = parent;
        }
    }

    _sinkDown(i) {
        const n = this.data.length;
        while (true) {
            let largest = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this.data[l].r > this.data[largest].r) largest = l;
            if (r < n && this.data[r].r > this.data[largest].r) largest = r;
            if (largest === i) break;
            [this.data[largest], this.data[i]] = [this.data[i], this.data[largest]];
            i = largest;
        }
    }
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function sampleCircleColor(data, W, H, cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.ceil(cx - r));
    const x1 = Math.min(W - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r));
    const y1 = Math.min(H - 1, Math.floor(cy + r));
    let rS = 0, gS = 0, bS = 0, n = 0;
    for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
            const dx = px - cx, dy = py - cy;
            if (dx * dx + dy * dy <= r2) {
                const si = (py * W + px) * 4;
                rS += data[si]; gS += data[si + 1]; bS += data[si + 2]; n++;
            }
        }
    }
    return n === 0 ? '#000000' : rgbToHex(Math.round(rS / n), Math.round(gS / n), Math.round(bS / n));
}

function sampleGlobalColor(data, W, H, placed) {
    let rS = 0, gS = 0, bS = 0, n = 0;
    for (const { x, y, r } of placed) {
        const r2 = r * r;
        const x0 = Math.max(0, Math.ceil(x - r));
        const x1 = Math.min(W - 1, Math.floor(x + r));
        const y0 = Math.max(0, Math.ceil(y - r));
        const y1 = Math.min(H - 1, Math.floor(y + r));
        for (let py = y0; py <= y1; py++) {
            for (let px = x0; px <= x1; px++) {
                const dx = px - x, dy = py - y;
                if (dx * dx + dy * dy <= r2) {
                    const si = (py * W + px) * 4;
                    rS += data[si]; gS += data[si + 1]; bS += data[si + 2]; n++;
                }
            }
        }
    }
    return n === 0 ? '#000000' : rgbToHex(Math.round(rS / n), Math.round(gS / n), Math.round(bS / n));
}

function packCircles() {
    const minR = Math.max(1, parseInt(document.getElementById('minRadius').value, 10));
    const maxR = Math.max(minR, parseInt(document.getElementById('maxRadius').value, 10));

    const W = imageWidth;
    const H = imageHeight;

    statusEl.textContent = "Building binary map...";
    const binaryMap = buildBinaryMap();

    statusEl.textContent = "Computing distance map...";
    const distMap = buildDistanceMap(binaryMap);

    // liveDist tracks the current maximum inscribable circle at each pixel,
    // constrained by both the shape boundary AND all previously placed circles.
    // Initialise from the distance map — but only for foreground pixels.
    const liveDist = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
        liveDist[i] = binaryMap[i] ? distMap[i] : 0;
    }

    // Seed the heap with all foreground pixels whose initial radius >= minR
    const heap = new MaxHeap();
    for (let i = 0; i < W * H; i++) {
        if (liveDist[i] >= minR) {
            heap.push({ idx: i, r: liveDist[i] });
        }
    }

    const placed = [];

    statusEl.textContent = "Packing circles...";

    while (heap.size > 0) {
        const { idx, r: heapR } = heap.pop();

        // The heap may contain stale entries — skip if liveDist has since decreased
        const currentR = liveDist[idx];
        if (currentR < minR) continue;
        if (currentR < heapR - 0.5) {
            // Stale — re-insert with updated value if still viable
            if (currentR >= minR) heap.push({ idx, r: currentR });
            continue;
        }

        const r = Math.min(currentR, maxR);
        const x = idx % W;
        const y = (idx / W) | 0;

        // Skip if circle would extend outside the image canvas
        if (x - r < 0 || x + r > W || y - r < 0 || y + r > H) continue;

        placed.push({ x, y, r });

        // Update liveDist for all pixels within reach of this circle.
        // For any pixel P, the distance to the nearest point on this circle's
        // edge = |dist(P, center) - r|. The new max inscribable circle at P
        // (ignoring the shape boundary) = dist(P, center) - r.
        // We take min(liveDist[P], max(0, dist(P,center) - r)).
        const reach = r + Math.max(liveDist[idx], 1) + 1; // furthest pixel that could be affected
        const x0 = Math.max(0, x - reach | 0);
        const x1 = Math.min(W - 1, (x + reach) | 0);
        const y0 = Math.max(0, y - reach | 0);
        const y1 = Math.min(H - 1, (y + reach) | 0);

        for (let py = y0; py <= y1; py++) {
            for (let px = x0; px <= x1; px++) {
                const pidx = py * W + px;
                if (!binaryMap[pidx]) continue;
                const dx = px - x, dy = py - y;
                const distToCenter = Math.sqrt(dx * dx + dy * dy);
                const newDist = distToCenter - r;
                if (newDist < liveDist[pidx]) {
                    liveDist[pidx] = newDist < 0 ? 0 : newDist;
                    if (liveDist[pidx] >= minR) {
                        heap.push({ idx: pidx, r: liveDist[pidx] });
                    }
                }
            }
        }
    }

    // Determine colours
    const colorMode = document.querySelector('input[name="colorMode"]:checked')?.value || 'solid';
    const imageData = ctx.getImageData(0, 0, W, H);
    const imgPixels = imageData.data;

    let globalColor;
    if (colorMode === 'global') {
        statusEl.textContent = "Computing global colour...";
        globalColor = sampleGlobalColor(imgPixels, W, H, placed);
    }

    // Render SVG
    outputSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    outputSvg.setAttribute('width', W);
    outputSvg.setAttribute('height', H);

    const fragment = document.createDocumentFragment();

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', W);
    bg.setAttribute('height', H);
    bg.setAttribute('fill', 'white');
    fragment.appendChild(bg);

    const solidColor = document.getElementById('circleColor').value;

    for (const c of placed) {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', c.x);
        circle.setAttribute('cy', c.y);
        circle.setAttribute('r', c.r);
        let fill;
        if (colorMode === 'per-circle') fill = sampleCircleColor(imgPixels, W, H, c.x, c.y, c.r);
        else if (colorMode === 'global') fill = globalColor;
        else fill = solidColor;
        circle.setAttribute('fill', fill);
        fragment.appendChild(circle);
    }

    outputSvg.innerHTML = '';
    outputSvg.appendChild(fragment);

    statusEl.textContent = `Done. ${placed.length} circles placed.`;
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
