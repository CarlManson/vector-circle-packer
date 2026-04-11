# Changelog

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
