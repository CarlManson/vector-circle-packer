# Changelog

## [Unreleased]

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

## [0.1.0] — Initial release

- Basic HTML/JS circle packer
- Image upload, hidden canvas for pixel processing
- Binary map from luminance threshold
