2026-06-11

Tags: [[ambarella]] [[machine learning]] [[deep learning]]
## what is convolution

### Notes

A CNN looks at small, overlapping sections to find patterns like edges, textures, or shapes
- Convolution nodes are fundamentally executing loops of matrix multiplications across a spatial grid


#### Example
1. Input (image)
2. kernel (filter) smaller matrix of weights. Specific feature the network is looking for: vertical line or color gradient
3. feature map (output): new matrix produced by the convolution op, which highlights where the kernel's pattern was found in the input

### Process
It's a sliding window algorithm
1. Overlay: Kernel is put in top-left corner of the input matrix
2. Multiply & Sum: perform element-wise multiplication
	1. hadamard product: multiplying corresponding elements of two matrices or vectors of the same dimensions: result in a new matrix or vector of same size
	2. Sum all products together into a single number
3. Record: single number is placed in the corresponding first cell of the output feature map
4. slide (stride): Kernel shifts over by a set number of pixels and repeat process until it has scanned the entire input matrix

### Achieve translation invariance
- if object is in the top-left of an image or the bottom-right, the same kernel will still detect its edges: drastically reduces the number of parameters the network needs to learn compared to a standard dense layer