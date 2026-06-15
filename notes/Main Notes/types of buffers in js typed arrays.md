2026-06-11

Tags: [[JavaScript typed arrays]] [[javascript]]
## types of buffers in js typed arrays

### Notes

### Array Buffer
Always owned by a single execution context
[[single execution context]]
So, only one thread can work on it. If I want to transfer it to some worker.js, the main thread will lose the data and must transfer it to that thread
- Good for safety, prevent race conditions. 
### SharedArrayBuffer

Both have "array", but they don't do too much with arrays. WE cannot read or write to them directly. They are **buffers**. They just hold some data. 
- Shared across multiple execution contexts
- main thread and web workers can all look at and draw on same data
- Good for efficiency / speed, but data can be corrupted if overwritten
	- Extreme performance for 3D rendering
### Actions
They just hold some data. 


### Actions
1. Allocate: a new buffer is created, a new memory span is allocated and initialized to 0
2. Copy: Using slice(): can copy a portion of the memory without creating views to copy each byte
3. transfer() and transferToFixedLength(): transfer ownership of the memory span to a new buffer object
4. resize(): resize memory span
### References