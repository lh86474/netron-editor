2026-06-11

Tags: [[other questions in cs]]
## exchanging DRAM buffer in neural networks 

### Notes

computations are much faster than moving stuff in and out of physical memory

To keep the NN accelerator from stalling while waiting for data: system has to get clever with how it handles DRAM

When a big model executes, its intermediate tenors and weights are **too big to fit on ultra-fast, on-chip SRAM**. They have to live in the slower, off-chip DRAM. 

#### To hide latency, we use Ping-Pong Buffering
- Instead of having one large holding area for buffer, the memory manager sets up two or more separate DRAM buffers
	- Buffer A (Compute): Neural Processing Unit is actively reading from Buffer A, crunching the math for the current layer
	- Buffer B (Load): Direct Memory Access (DMA)
		- Fetch the weights or input data for the next layer from main memory and writing into Buffer B
As soon as NPU finishes with Buffer A, the roles flip. The NPU instantly starts computing on Buffer B, while the DMA engine begins overwriting Buffer A with data for the subsequent layer

### Zero-Copy Data Passing
- CPU doesn't copy an image from its memory space into the NPU's memory space: simply passes the memory address (the pointer) of the DRAM buffer. NPU takes ownership of that buffer, reads the data, and then passes a pointer to a new output buffer back to the CPU

### Microcode orchestrates all of this
- Microcode configures [[dma descriptors]], manages [[synchronization flags]] and handles the ping-pong state machine
- If microcode doesn't execute the buffer swaps flawlessly, the NPU stalls, the pipeline backs up, and frame rates drop
### References