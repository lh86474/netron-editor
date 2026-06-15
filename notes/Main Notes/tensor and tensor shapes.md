2026-06-04

Tags: [[machine learning]] [[deep learning]] [[neural networks]] [[ambarella]]
## tensor and tensor shapes

### Notes

### What even are tensors

"A rank-n tensor in m-dimensions is a mathematical object that has n indices and m^n components and obeys certain transformation rules"

There are 9 different stresses
### Matrices and tensors are not the same thing

Vectors are **tensors of rank 1**
- 1 basis
- 1 index
For component

Scalars are tensors of rank 0
- No directional indicators
- No indices, rank 0

Matrices are **a rank 2 tensor**
- we have 9 components and 9 sets of 2 basis vectors
- The components **have two indices**, like A_x, y
- We can point in 9 directions in total
	- xx, xy, xz
	- yx, yy, yz
	- zx, zy, zz
- To fully characterize all of the forces on something, we need 9 components, each with 2 indices

### Rank 3 tensor

- 27 components
	- xxx xyx xzx
	- yxx yyx yzx
- It looks like a cube
- There are 3 indices

first slab has x as middle index
middle slab has y as middle index
final slab has z as final index

### power of tensors

### References

[What is Tensor and Tensor Shapes? - GeeksforGeeks](https://www.geeksforgeeks.org/deep-learning/what-is-tensor-and-tensor-shapes/)
[Your Gift Can Help Starving Children in Gaza | Donate Now](https://www.youtube.com/watch?v=bpG3gqDM80w)