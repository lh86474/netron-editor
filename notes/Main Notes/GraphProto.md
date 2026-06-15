2026-06-10

Tags: [[onnx]] [[ambarella]]
## GraphProto

### Notes

Defines a graph or set of nodes called from a loop or a test. 
- Defines the **actual computational logic of a model**
- Has a parameterized list of nodes that form a directed acyclic graph based on their inputs and outputs. Equivalent of the network or graph in many deep learning frameworks

Below contains everything that I need to know about GraphProto. This is the blueprint
1. List of nodes, sorted topologically
	1. Makes sense as parent nodes are the dependencies, hence requiring topological sort
2. string name = 2; // namespace Graph
	1. "namespace meaning"
	2. ONNX divides identifiers into three distinct namespaces (it means scope)
3. repeated TensorProto initializer = 5
	1. initializer means like constant
	2. specify the constant inputs of the graph
4. repeated valueinfoproto input = 11
	1. repeated in case there are more than one input
5. repeated valueinfoproto output - 12
	1. outputs
	2. Why valueinfoproto? 
		1. ValueInfoProto is the **data structure that defines the exact shape and data type of a specific tensor**
		2. Holds Name: Unique identifier for the value (in Values namespace)
		3. Type: data type, the shape
			1. The shape is the stuff I see like [1, 2, 224, 224]
			2. Four dimensional tensor
6.  repeated TensorAnnotation quantization_annotation = 14;
[[what does it mean to sort topologically]]

```
message GraphProto {
  // The nodes in the graph, sorted topologically.
  repeated NodeProto node = 1;

  // The name of the graph.
  string name = 2;   // namespace Graph

  // A list of named tensor values, used to specify constant inputs of the graph.
  // Each initializer (both TensorProto as well SparseTensorProto) MUST have a name.
  // The name MUST be unique across both initializer and sparse_initializer,
  // but the name MAY also appear in the input list.
  repeated TensorProto initializer = 5;

  // Initializers (see above) stored in sparse format.
  repeated SparseTensorProto sparse_initializer = 15;

  // A human-readable documentation for this graph. Markdown is allowed.
  string doc_string = 10;

  // The inputs and outputs of the graph.
  repeated ValueInfoProto input = 11;
  repeated ValueInfoProto output = 12;

  // Information for the values in the graph. The ValueInfoProto.name's
  // must be distinct. It is optional for a value to appear in value_info list.
  repeated ValueInfoProto value_info = 13;

  // This field carries information to indicate the mapping among a tensor and its
  // quantization parameter tensors. For example:
  // For tensor 'a', it may have {'SCALE_TENSOR', 'a_scale'} and {'ZERO_POINT_TENSOR', 'a_zero_point'} annotated,
  // which means, tensor 'a_scale' and tensor 'a_zero_point' are scale and zero point of tensor 'a' in the model.
  repeated TensorAnnotation quantization_annotation = 14;

  // Named metadata values; keys should be distinct.
  repeated StringStringEntryProto metadata_props = 16;

  reserved 3, 4, 6 to 9;
  reserved "ir_version", "producer_version", "producer_tag", "domain";
}
```
### References