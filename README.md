# Vector Circle Packer

A browser-based tool that fills the dark areas of an uploaded image with tightly packed circles, outputting a clean SVG.

## How it works

1. **Image** — Upload a PNG or JPEG and adjust brightness, contrast, gamma and blur
2. **Mode** — Choose brightness or hue-based zone detection and set the number of zones
3. **Zones** — Review zone boundaries and colour mappings
4. **Circles** — Configure per-zone circle sizes, colours and fill mode, then generate

The app binarises pixels into zones, computes a Euclidean distance transform per zone, then packs circles greedily largest-first using a max-heap. Circle packing runs in a Web Worker for responsiveness.

## Preview

The preview panel shows a live zone map that updates as you adjust settings. On the Circles step, opening a zone accordion isolates that zone in the preview — all other zones are hidden so you can see exactly which areas are affected.

## Output

The result is rendered as an SVG. Use the **Download SVG** button to save it.
