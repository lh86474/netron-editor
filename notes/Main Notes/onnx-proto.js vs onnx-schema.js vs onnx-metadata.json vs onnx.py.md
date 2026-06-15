2026-06-05

Tags: [[ambarella]] [[netron]]
## onnx-proto.js vs onnx-schema.js

### Notes
The main difference between onnx-proto.js and onnx-schema.js is that 
onnx-schema.js is the reader for ONNX Runtime's optimized and serialized format, the .ort file, but not the standard .onnx protobuf. 

onnx-metadata.json
- This is the ONNX operator documentation

onnx-proto.js is for the standard .onnx file

#### onnx.py
- It mirrors the idea of onnx.js, but in Python
	- Turns in-memory ONNX model into a JSON message the browser UI can display. It is not used when you run Netron with npm.cmd start
	- server.py detects the object type and dispatches to onnx.py
- It's for the python server, compared to onnx.js it is incomplete

### References