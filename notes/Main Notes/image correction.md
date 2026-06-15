2026-06-11

Tags: [[other questions in cs]]
## image correction

### Notes

It's a big cleanup operation the ISP performs before an image is actually usable
- When a camera sensor captures light, the raw data it produces is very ugly. It is full of noise, warped by physical lens, doesn't look like a color photograph yet. 

### Demosaicing (debayering)
- Most sensors do not capture RGB light at every single pixel
- They see a Bayer Filter
	- A checkerboard pattern where each pixel only sees only color
- Demosaicing is a mathematical guessing game(interpolation). 
	- hardware plays to calculate the missing two colors for every single pixel based on its neighbors: turn mosaic of single colors into a full RGB image

### Defect Pixel Correction
- camera sensors have microscopic manufacturing defects: "dead" always black or "hot" bright white/red pixels
- correction algo map bad pixels and dynamically replace them with average color of the surrounding healthy pixels

### Noise reduction (denoising)
- low light: electrical signals get amplified
- introduce random static or "gain" into the image
- temporal noise reduction compares multiple frames over time to figure out what is actual movement and what is just electrical noise

### White balance & Color correction
- Adjust RGB so white objects look white to the human eye

### Lens distortion & shading correction
- fisheye effect
- ISP applies mathematical grid transformation to stretch or compress the pixels back to reality and artificially brightens the corners to make the lighting uniform
### References