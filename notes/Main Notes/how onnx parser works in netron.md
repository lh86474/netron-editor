2026-06-02

Tags: [[ambarella]] [[onnx]] 
## how onnx parser works in netron

### Notes
## The bridge, in three pieces

|Piece|File|Job|
|---|---|---|
|Bytes → cursor|`protobuf.js`|Read wire format (varints, strings, nested lengths). No ONNX knowledge.|
|Cursor → schema objects|`onnx-proto.js`|Map field numbers to `ModelProto`, `GraphProto`, `NodeProto`, etc.|
|Glue|`onnx.js` `ProtoReader.read()`|Get the cursor, call `.decode()`, store `this.model`.|

### References