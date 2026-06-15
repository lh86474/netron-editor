2026-06-10

Tags: [[ambarella]] [[onnx]]
## ModelProto

### Notes

### The top-level ONNX construct is 'Model'. 

In protocol buffers, it is represented as type onnx.ModelProto
- It holds **both the metadata and the executable graph together**

It's like the shipping box for ONNX
1. Metadata (producer_name, training_info, functions, configuration)
2. Then, we have the **graph itself**
	1. So, everything else except for the graph is metadata


| Name             | Type                       | Description                                                                                                                                        |
| ---------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ir_version       | int64                      | The ONNX version assumed by the model.                                                                                                             |
| opset_import     | OperatorSetId              | A collection of operator set identifiers made available to the model. An implementation must support all operators in the set or reject the model. |
| producer_name    | string                     | The name of the tool used to generate the model.                                                                                                   |
| producer_version | string                     | The version of the generating tool.                                                                                                                |
| domain           | string                     | A reverse-DNS name to indicate the model namespace or domain, for example, 'org.onnx'                                                              |
| model_version    | int64                      | The version of the model itself, encoded in an integer.                                                                                            |
| doc_string       | string                     | Human-readable documentation for this model. Markdown is allowed.                                                                                  |
| graph            | Graph                      | The parameterized graph that is evaluated to execute the model.                                                                                    |
| metadata_props   | map<string,string>         | Named metadata values; keys should be distinct.                                                                                                    |
| training_info    | TrainingInfoProto[]        | An optional extension that contains information for training.                                                                                      |
| functions        | FunctionProto[]            | An optional list of functions local to the model.                                                                                                  |
| configuration    | DeviceConfigurationProto[] | (IR version >= 11) An optional list of multi-device configurations for distributed execution.                                                      |
### References