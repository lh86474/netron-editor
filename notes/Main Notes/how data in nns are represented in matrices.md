2026-06-11

Tags: [[machine learning]] [[deep learning]] 
## how data in nns are represented in matrices and tensors

### Notes

A single piece of data is a list of numbers. 
A layer in a network that takes in 3 input values. 
This is called input vector X

![[Pasted image 20260611160246.png]]

### The weights (Matrices)
- Every arrow represents a weight: the strength of the connection between a node in one layer and a node in the next.
- Let's say our current layer has 3 input nodes and the next layer has 2 output
- We have 6 total connections
- We put these weights into a matrix, usually denoted as W

![[Pasted image 20260611160403.png]]

### Matrix multiplication
- When data passes through the network, the inputs are multiplied by their respective weights and summed up. 
- Matrix multiplication handles this operation for every node simultaneously. 

![[Pasted image 20260611160534.png]]

### In model schemas
- The matrices are not floating grids: it's a contiguous block of binary data

A parser reading that schema doesn't see a 2D grid: it reads a flattened array of floats and metadata defining the shape as [2, 3]

- During execution, low-level lin alg libraries or microcode on the hardware take those flattened arrays and pushes them through optimized registers to perform the multiplication incredibly fast. 