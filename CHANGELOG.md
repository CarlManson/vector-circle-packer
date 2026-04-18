# Changelog

## [2026-04-18]

### Added
- Sub-pixel centre refinement in the Web Worker — circles fit their available space more tightly
- Draggable source-image thumbnail on steps 2–4 for on-screen reference
- Reset button in the step 1 Adjustments section
- Single-open accordion on step 4 (opening a zone auto-closes the previous one)
- Warning note in hue mode when the zone count changes, since it resets angles to an even distribution
- Worker error reporting: exceptions surface in the status bar and console instead of silently hanging
- Fixed sidebar width so it no longer jumps between steps

### Changed
- Hue mode: Background zone removed entirely (only optional Black/White neutral zones remain)
- Hue mode: Threshold slider now appears when White zone is off (it owns the upper luminance bound for hue zones)
- White zone now runs up to 255 independently of the main threshold; slider max is 254
- Zone swatch colours are computed from the source image rather than the adjusted pixels, so they reflect true zone averages
- Hue mode preview no longer paints unclassified pixels as solid white — they are transparent
- Hue zones now redistribute evenly when the zone count changes, rather than splitting the largest gap
- Fallback swatches normalised to `#rrggbb` to satisfy `<input type="color">`

### Fixed
- Generate Circles hang in Hue mode caused by `getZoneSettingsFromDOM` matching the hue-wheel drag handle instead of the zone accordion item
- "Grey background" artefact caused by the white zone previously being capped by `threshold` (128) — white zone is now decoupled from `threshold`

## [2026-04-11]

### Added
- Zone highlight in preview: opening a zone accordion on the Circles step isolates that zone, hiding all others
- Preview footer bar with Generate/Download buttons and status text moved out of the sidebar
- `#previewContent` wrapper with proper flexbox layout so the canvas fits the viewport

### Changed
- Preview layout reworked: canvas and SVG now size to their content instead of stretching to 100% width
- Canvas/SVG background changed from white to transparent; added border for visibility
- Preview uses `flex: 1; min-height: 0` instead of `height: 100%` to account for the footer

## [2026-04-07]

### Added
- `main.js` — JavaScript extracted from `index.html` into a separate file
- Max Radius control to cap circle size regardless of available space
- Threshold preview: SVG shows a live black/white preview of the image before packing
- Download SVG button
- Status messages during processing

### Changed
- Image is now scaled to 500px wide on upload; all processing happens at that resolution
- Complete algorithm rewrite: greedy largest-first packing using a max-heap and Euclidean distance transform (Meijster et al.), replacing the previous stochastic approach
- SVG preview scales to fill the available display area
- Image border treated as background in the distance transform, preventing circles from being centred on the edge
- Circle placement now enforces that no circle extends outside the image bounds

### Fixed
- `colour` typo in CSS (was not applying text colour on body or button)
- Threshold slider had no effect on packing area — candidates now require `binaryMap === 1`
- Circles were not constrained to the black area boundary

## [2026-04-06] — Initial release

- Basic HTML/JS circle packer
- Image upload, hidden canvas for pixel processing
- Binary map from luminance threshold
