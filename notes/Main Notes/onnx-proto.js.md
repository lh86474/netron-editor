2026-06-02

Tags: [[ambarella]] [[netron]] [[onnx]]
## onnx-proto.js

### Notes

onnx-proto.js was **created using Protobuf Compiler**
- The developers run a script that feeds onnx.proto3 into protoc
- Translates onnx.proto3 into executable Javascript code

### You could use protobuf.js
- There are libraries, like reflection API that allow an app to load a raw .proto text file, parse its syntax, and build the classes dynamically while the app is running
- We choose the pre-compiled route for performance
	- parsing a massive text file takes time / cpu cycles
	- by parsing into javascript, **the browser just runs native code immediately**
	- bundle size: if netron had to parse the raw .proto file at runtime, would have to bundle a massive Protobuf text-parser library into its web app just to read the file
	- Keep it lightweight

### References