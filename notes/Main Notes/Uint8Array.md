2026-06-09

Tags: [[javascript]]
## Uint8Array

### Notes
#### Why UInt8Array
- The secret to why formats like ONNX and Protocol Buffers are so fast
	- Special type of data structure in js known as a TypedARray
	- a standard js array is super flexible: I can put a number, string, and an object into the same array
	- But, it adds a lot of hidden memory overhead

Uint8Array: only hold integers of 8 bits. 
- Js engine knows exactly what type of data is in it, allocate a single, contiguous block of raw memory: zero bloat. 1,000 items in Uint8Array take up exactly 1,000 bytes

Computer processor can read and write to it incredibly fast. 
- standard js arrays are too slow
- typeArrays were created to handle performance needs of WebGL (browser graphics)

Universal Compatibility with Network and File APIs
- Browser: fetch API, WebSockets, FileSystem API all natively speak 
- Node.js: standard Buffer class (for reading files and networking) is a direct subclass of Uint8ARray

### binary-packed
- use 3 bits to store a piece of info and 5 bits to store another: packed into a single byte. 

#