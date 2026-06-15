2026-06-10

Tags: [[onnx]] [[ambarella]]
## NodeProto

### Notes

1. We have the input and output, yes
2. I guess there is a name as well lol
3. We definitely need the op_type = 4
4. I wonder what string domain = 7 does
	1. domain is a unique namespace identifier
	2. reverse-dns naming convention: www.microsoft.com -> com.microsoft
	3. The default domain for standard ONNX models is ai.onnx
	4. Solves custom extensions
		1. If companies invent their own custom, experimental math operations, sure they can do it
		2. com.appleSuperFastConv
			1. The software knows which version to use
5. Why string overload = 8
	1. Refers to function overload, that type of overload. Use #8 to specify which function we want
6. what are the named metadata values
	1. repeated StringStringEntryProto metadata_props = 9
		1. catch-all custom tagging system
		2. StringStringEntryProto: holds a string key and a string value
		3. A map and Dictionary
		4. perfect way to embed arbitrary, custom metadata that the strict ONNS standard doesn't officially track. 
		5. Devs can inject whatever they want into the mdoel before shipping it. 

```
message NodeProto {
  repeated string input = 1;    // namespace Value
  repeated string output = 2;   // namespace Value

  // An optional identifier for this node in a graph.
  // This field MAY be absent in this version of the IR.
  string name = 3;     // namespace Node

  // The symbolic identifier of the Operator to execute.
  string op_type = 4;  // namespace Operator
  // The domain of the OperatorSet that specifies the operator named by op_type.
  string domain = 7;   // namespace Domain
  // Overload identifier, used only to map this to a model-local function.
  string overload = 8;

  // Additional named attributes.
  repeated AttributeProto attribute = 5;

  // A human-readable documentation for this node. Markdown is allowed.
  string doc_string = 6;

  // Named metadata values; keys should be distinct.
  repeated StringStringEntryProto metadata_props = 9;

  // Configuration of multi-device annotations.
  repeated NodeDeviceConfigurationProto device_configurations = 10;
}
```
### References