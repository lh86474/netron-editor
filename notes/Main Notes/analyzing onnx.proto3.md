2026-06-02

Tags: [[ambarella]] [[onnx]] [[protobuf]]
## analyzing onnx.proto3

### Notes

### .onnx file is built using protocol buffers (proto3) which is google's data serialization language
- proto3 is the grammar, onnx is the dictionary
- onnx uses a .proto file to define exactly what a node, graph, and tensor should look like

What does the IR mean?
- It means Intermediate Representation: middleman language
- Pytorch goes to ONNX IR -> Ambarella reads ONNX IR and translate it into proprietary hardware microcode
[[how onnx parser works in netron]]



### References
onnx.proto3 file from onnx github
https://www.bing.com/search?pglt=2083&q=onnx&cvid=5d3b3a9fd338431b9436f1d5ffccd7bb&gs_lcrp=EgRlZGdlKgYIABBFGDsyBggAEEUYOzIGCAEQRRg7MgYIAhBFGDsyBggDEEUYPDIGCAQQRRg8MgYIBRBFGDwyBggGEEUYPDIGCAcQRRg8MggICBDpBxj8VdIBBzc2N2owajeoAgCwAgA&FORM=ANNAB1&PC=U531&source=chrome.ob


