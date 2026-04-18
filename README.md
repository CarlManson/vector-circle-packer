# Vector Circle Packer

A browser-based tool that fills the dark areas of an uploaded image with tightly packed circles, outputting a clean SVG.

## Running locally

The site is plain HTML/JS/CSS — no build step is required to run it, but SCSS sources need to be compiled to `styles.css`.

Serve the directory with any static server, for example:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000` in a browser. (Opening `index.html` directly via `file://` will not work because the Web Worker requires an HTTP origin.)

To edit styles, watch the SCSS so it recompiles on save:

```sh
npx sass --watch _uncompiled/styles.scss:styles.css
```

## How it works

1. **Image** — Upload a PNG or JPEG and adjust brightness, contrast, gamma and blur (Reset restores defaults)
2. **Mode** — Choose brightness or hue-based zone detection and set the number of zones; hue mode offers optional black and white neutral zones
3. **Zones** — Fine-tune zone boundaries; in brightness mode you can also enable a background zone
4. **Circles** — Configure per-zone circle sizes, colours and fill mode, then generate

The app binarises pixels into zones, computes a Euclidean distance transform per zone, then packs circles greedily largest-first using a max-heap with sub-pixel centre refinement. Circle packing runs in a Web Worker for responsiveness.

## Preview

The preview panel shows a live zone map that updates as you adjust settings. On steps 2–4 a small draggable thumbnail of the source image appears in the top-left corner as a reference — grab it and move it anywhere inside the preview if it's in the way. On the Circles step, opening a zone accordion isolates that zone in the preview; only one zone panel is open at a time.

## Output

The result is rendered as an SVG. Use the **Download SVG** button to save it.
