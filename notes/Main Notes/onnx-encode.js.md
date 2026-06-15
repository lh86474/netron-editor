2026-06-09

Tags: [[ambarella]] [[netron]]
## onnx-encode.js

### Notes


ONNX files are serialized using protocol buffers. The encoder needs to know exactly what it's packing. We need a specific JavaScript helper for every single data type
### Why do we need so many?

A model is a complex ecosystem, not just data. 
- Blueprint of a computational graph: exporter has to encode entirely different categories of information
- ONNX has to account for everything since every framework does things differently
### TensorAnnotation
- when compiling a model for edge devices, we have to attach hardware-specific instructions
- Annotations might tell the chip like "Hey, treat this specific tensor as 8-bit quantized math instead of 32-bit float math"
### Explanation of the functions
**Helper Encoding Functions:**

* **`encodeSubmessage(writer, field, message, encode)`:** Encodes a nested message. It writes the field tag, then the length-delimited encoded submessage.

* **`encodeStringField(writer, field, message, key)`:** Encodes a string field if it exists and is not an empty string.

* **`encodeInt33Field(writer, field, message, key)`:** Encodes a 32-bit signed integer field if it exists and is not zero.

* **`encodeInt64Field(writer, field, message, key)`:** Encodes a 64-bit signed integer field if it exists and is not zero.

* **`encodeFloatField(writer, field, message, key)`:** Encodes a single-precision float field if it exists and is not zero.

* **`encodeRepeatedString(writer, field, values)`:** Encodes an array of strings.

* **`encodeRepeatedSubmessage(writer, field, values, encode)`:** Encodes an array of nested messages.

* **`encodePackedInt64(writer, field, values)`:** Encodes a packed array of 64-bit signed integers. Packed encoding is more efficient for repeated primitive types.

* **`encodePackedInt32(writer, field, values)`:** Encodes a packed array of 32-bit signed integers.

* **`encodePackedFloat(writer, field, values)`:** Encodes a packed array of single-precision floats.

* **`encodePackedDouble(writer, field, values)`:** Encodes a packed array of double-precision floats.

* **`encodeBytesField(writer, field, message, key)`:** Encodes a byte array field if it exists and has a length greater than zero.

* **`encodeRepeatedBytes(writer, field, values)`:** Encodes an array of byte arrays.

**ONNX Protobuf Message Encoding Functions:**

The code then proceeds to define `encode` methods for various ONNX protobuf message types. Each `encode` function uses the helper functions to serialize the fields of its respective message according to the ONNX protobuf schema. Some notable examples include:

* **`onnx.StringStringEntryProto.encode`:** Encodes key-value string pairs.

* **`onnx.OperatorSetIdProto.encode`:** Encodes operator set identifiers (domain and version).

* **`onnx.TensorShapeProto.Dimension.encode`:** Encodes a single dimension of a tensor shape.

* **`onnx.TensorShapeProto.encode`:** Encodes the shape of a tensor, which is a repeated list of `Dimension`s.

* **`onnx.TypeProto.Tensor.encode`:** Encodes the type information for a tensor, including its element type and shape.

* **`onnx.TypeProto.Sequence.encode`:** Encodes type information for sequences.

* **`onnx.TypeProto.Map.encode`:** Encodes type information for maps.

* **`onnx.TypeProto.Optional.encode`:** Encodes type information for optional types.

* **`onnx.TypeProto.SparseTensor.encode`:** Encodes type information for sparse tensors.

* **`onnx.TypeProto.Opaque.encode`:** Encodes type information for opaque types.

* **`onnx.TypeProto.encode`:** A general encoder for `TypeProto` that dispatches to specific type encoders (tensor, sequence, map, etc.).

* **`onnx.ValueInfoProto.encode`:** Encodes information about a value, typically an input, output, or intermediate value in a graph, including its name and type.

* **`onnx.TensorProto.Segment.encode`:** Encodes segment information for tensors.

* **`onnx.TensorProto.encode`:** Encodes a tensor, including its dimensions, data type, and the actual data (which can be in various formats like float, int32, int64, string, bytes, etc.).

* **`onnx.SparseTensorProto.encode`:** Encodes a sparse tensor, which consists of values and their corresponding indices.

* **`onnx.AttributeProto.encode`:** Encodes an attribute of a node, which can hold various types of data (float, int, string, tensor, graph, etc.).

* **`onnx.IntIntListEntryProto.encode`:** Encodes an entry for an integer-to-integer list mapping.

* **`onnx.SimpleShardedDimProto.encode`:** Encodes information about simple sharding for a dimension.

* **`onnx.ShardedDimProto.encode`:** Encodes sharding information for a dimension.

* **`onnx.ShardingSpecProto.encode`:** Encodes the overall sharding specification for a tensor.

* **`onnx.NodeDeviceConfigurationProto.encode`:** Encodes device-specific configurations for a node.

* **`onnx.NodeProto.encode`:** Encodes a computational node in the ONNX graph, including its inputs, outputs, operation type, attributes, and device configurations.

* **`onnx.TensorAnnotation.encode`:** Encodes annotations for tensors, such as quantization parameters.

* **`onnx.TrainingInfoProto.encode`:** Encodes training-specific information for a model.

* **`onnx.GraphProto.encode`:** Encodes an ONNX graph, which is a collection of nodes, initializers, inputs, outputs, and value information.

* **`onnx.DeviceConfigurationProto.encode`:** Encodes general device configuration information.

* **`onnx.FunctionProto.encode`:** Encodes a reusable ONNX function.

* **`onnx.ModelProto.encode`:** Encodes the entire ONNX model, including metadata, opset imports, the graph, training information, and functions.

**`onnx.ModelProto.encodeBytes(message)`:**

This is a convenience function that creates a new `BinaryWriter`, calls `onnx.ModelProto.encode` to serialize the given `message`, and then returns the resulting byte array using `writer.finish()`.

**`export { onnx };`:**

This line exports the `onnx` object, making the defined encoding functions and the `onnx` namespace available for use in other modules.

In essence, this code provides the serialization logic required to convert JavaScript object representations of ONNX protobuf messages into their binary wire format.