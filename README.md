# Vector Circle Packer

A browser-based tool that fills the dark areas of an uploaded image with tightly packed circles, outputting a clean SVG.

## How it works

1. Upload a PNG or JPEG image
2. Adjust the threshold slider to control which pixels are treated as "black" (fillable area)
3. Set a minimum and maximum circle radius
4. Click **Start Packing**

The app scales your image to 500px wide, binarises it using the threshold, then computes a Euclidean distance transform to find the largest circle that fits at every pixel. Circles are placed greedily largest-first using a max-heap, with each placed circle updating the available space for subsequent ones. The result fills the black areas as densely as possible down to the minimum radius you specify.

## Controls

| Control | Description |
|---|---|
| Upload Image | PNG or JPEG. Scaled to 500px wide internally. |
| Threshold | Pixels darker than this value become the fillable area. Preview updates live. |
| Minimum Radius | Smallest circle to place (px). Lower = denser fill, slower. |
| Maximum Radius | Largest circle allowed (px). Useful for forcing more circles into large open areas. |

## Output

The result is rendered as an SVG with black filled circles on a white background. Use the **Download SVG** button to save it.
