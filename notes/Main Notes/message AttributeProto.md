2026-06-02

Tags: [[ambarella]] [[onnx]] [[analyzing onnx.proto3]]
## message AttributeProto

### Notes

Defines the exact structure for a node's **settings and configurations**

Every node (math operation) **in a graph deals with two completely different types of information: inputs and attributes**

#### Attribute vs input
Inputs (ValueInfoProto) is like the fruit, ice, and milk I pour into a blender. It's dynamic data that changes every time I use the machine

Attributes (AttributeProto) buttons on the blender: dictate how the machine behaves

```
  // Note: this enum is structurally identical to the OpSchema::AttrType
  // enum defined in schema.h.  If you rev one, you likely need to rev the other.
  enum AttributeType {
    UNDEFINED = 0;
    FLOAT = 1;
    INT = 2;
    STRING = 3;
    TENSOR = 4;
    GRAPH = 5;
    SPARSE_TENSOR = 11;
    TYPE_PROTO = 13;

    FLOATS = 6;
    INTS = 7;
    STRINGS = 8;
    TENSORS = 9;
    GRAPHS = 10;
    SPARSE_TENSORS = 12;
    TYPE_PROTOS = 14;
  }
  // The name field MUST be present for this version of the IR.
  string name = 1;           // namespace Attribute

  // if ref_attr_name is not empty, ref_attr_name is the attribute name in parent function.
  // In this case, this AttributeProto does not contain data, and it's a reference of attribute
  // in parent scope.
  // NOTE: This should ONLY be used in function (sub-graph). It's invalid to be used in main graph.
  string ref_attr_name = 21;

  // A human-readable documentation for this attribute. Markdown is allowed.
  string doc_string = 13;

  // The type field MUST be present for this version of the IR.
  // For 0.0.1 versions of the IR, this field was not defined, and
  // implementations needed to use has_field heuristics to determine
  // which value field was in use.  For IR_VERSION 0.0.2 or later, this
  // field MUST be set and match the f|i|s|t|... field in use.  This
  // change was made to accommodate proto3 implementations.
  AttributeType type = 20;   // discriminator that indicates which field below is in use
```

- ONNX forces the AttributeProto to declare what it is holding
- Attribute type = 20;
	- Compiler: read type field first
		- type is 7
		- check the AttributeType enum: Okay, 7 means INTS
	- 
### References