2026-06-11

Tags: [[ambarella]] [[deep learning]] [[machine learning]] 
## how is data represented in tensors

### Notes

### Why we need tensors
- Why do we need stuff like 4d tensors? 

If I want to process a small 256x256 color image. It's color, so rgb

256 x 256 x 3 = 196,608 input values for our first layer
- Let's say our next layer only has 1,000 nodes. 
- Our 2d weight matrix has to be 1000 x 196608, 200 million individual weights for one smaller layer that should be bigger. So cooked!
Blow up memory footprint, also destroy the spatial relationship of the data. 
- Treat pixel as completely independent from the pixel right next to it

### Convolution
- Instead of wiring everything with a massive 2D matrix, we used a tiny, localized box of weights
I create a 3x3 grid of weights that looks at all 3 color channels at once. 
The single filter is a **3D tensor with the shape [3, 3, 3]**
- This **slides across the image, doing small matrix multiplication patch by patch**
Okay, we have the rgb, if we want the layer to detect 64 distinct features in a picture (that helps us determine what it is)
- We stack 64 unique 3D filters together

A stack of 3D filters is a 4D tensor
[64, 3, 3, 3]
[Number of filters, input channels, filter height, filter width]

#### How it is used on low-level
- Hardware registers don't know what 4d is
- tensor is allocated on the heap as a single, contiguous 1D array of exactly 1,728 floating-point numbers

Leap is used by pointer arithmetic
- When a system needs to fetch a specific weight: calculates the exact memory offset using the strides of each dimension

![[Pasted image 20260611163628.png]]

- Maximize spatial locality
- Microcode can blitz through massive multi-dim convolutions while just iterating through a flat 1D array in memory
