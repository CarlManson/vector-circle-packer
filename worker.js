// Circle packing Web Worker — runs heavy computation off the main thread

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

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function buildZoneBinaryMap(data, lo, hi, W, H) {
    const total = W * H;
    const binaryMap = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
        const si = i * 4;
        const lum = data[si] * 0.299 + data[si + 1] * 0.587 + data[si + 2] * 0.114;
        if (lum >= lo && lum < hi) binaryMap[i] = 1;
    }
    return binaryMap;
}

function buildHueZoneBinaryMap(data, lo, hi, lumLo, lumHi, W, H) {
    const total = W * H;
    const binaryMap = new Uint8Array(total);
    const wraps = hi <= lo;
    for (let i = 0; i < total; i++) {
        const si = i * 4;
        const r = data[si], g = data[si + 1], b = data[si + 2];
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (lum < lumLo || lum >= lumHi) continue;
        const hue = rgbToHue(r, g, b);
        const inZone = wraps ? (hue >= lo || hue < hi) : (hue >= lo && hue < hi);
        if (inZone) binaryMap[i] = 1;
    }
    return binaryMap;
}

function buildDistanceMap(binaryMap, W, H) {
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
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this.data[l].r > this.data[lg].r) lg = l;
            if (r < n && this.data[r].r > this.data[lg].r) lg = r;
            if (lg === i) break;
            [this.data[lg], this.data[i]] = [this.data[i], this.data[lg]]; i = lg;
        }
    }
}

function packZone(binaryMap, distMap, minR, maxR, W, H) {
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
                const newDist = Math.sqrt(dx * dx + dy * dy) - r;
                if (newDist < liveDist[pidx]) {
                    liveDist[pidx] = newDist < 0 ? 0 : newDist;
                    if (liveDist[pidx] >= minR) heap.push({ idx: pidx, r: liveDist[pidx] });
                }
            }
        }
    }
    return placed;
}

function sampleCircleColor(data, W, H, cx, cy, r) {
    const r2 = r * r;
    const x0 = Math.max(0, Math.ceil(cx - r)), x1 = Math.min(W - 1, Math.floor(cx + r));
    const y0 = Math.max(0, Math.ceil(cy - r)), y1 = Math.min(H - 1, Math.floor(cy + r));
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
        const x0 = Math.max(0, Math.ceil(x - r)), x1 = Math.min(W - 1, Math.floor(x + r));
        const y0 = Math.max(0, Math.ceil(y - r)), y1 = Math.min(H - 1, Math.floor(y + r));
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

self.onmessage = function(e) {
    const { adjustedData, imgPixels, imageWidth: W, imageHeight: H, zones } = e.data;
    const allCircles = [];
    let totalPlaced = 0;

    for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];

        self.postMessage({ type: 'progress', message: `${zone.label}: binary map...` });
        let binaryMap;
        if (zone.type === 'hue') {
            binaryMap = buildHueZoneBinaryMap(adjustedData, zone.lo, zone.hi, zone.lumLo, zone.lumHi, W, H);
        } else {
            binaryMap = buildZoneBinaryMap(adjustedData, zone.lo, zone.hi, W, H);
        }

        self.postMessage({ type: 'progress', message: `${zone.label}: distance map...` });
        const distMap = buildDistanceMap(binaryMap, W, H);

        self.postMessage({ type: 'progress', message: `${zone.label}: packing...` });
        const placed = packZone(binaryMap, distMap, zone.minR, zone.maxR, W, H);
        totalPlaced += placed.length;

        let globalColor = null;
        if (zone.colorMode === 'global') {
            globalColor = sampleGlobalColor(imgPixels, W, H, placed);
        }

        for (const c of placed) {
            let fill;
            if (zone.colorMode === 'per-circle') fill = sampleCircleColor(imgPixels, W, H, c.x, c.y, c.r);
            else if (zone.colorMode === 'global') fill = globalColor;
            else fill = zone.solidColor;
            allCircles.push({ x: c.x, y: c.y, r: c.r, fill });
        }
    }

    self.postMessage({ type: 'done', circles: allCircles, totalPlaced });
};
