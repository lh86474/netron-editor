026-06-02

Tags: [[netron]] [[onnx]] [[ambarella]]
## onnx.js

### Notes
This is where the magic happens: take raw ONNX Protobuf objects and translate them into Netron's generic UI objects

#### Overview of what onnx.js has

| Lines     | Section                     | Purpose                                                        |
| --------- | --------------------------- | -------------------------------------------------------------- |
| 6–45      | `ModelFactory`              | Netron entry point: `match` + `open`                           |
| 47–158    | `Model`                     | Top-level model (format, producer, modules list)               |
| 161–242   | `Graph`                     | One computation graph (inputs, outputs, nodes)                 |
| 244–368   | `Argument`, `Value`, `Node` | Properties, tensors, operators                                 |
| 370–438   | `Group`                     | Hierarchical node grouping (mostly unused today)               |
| 440–640   | `Tensor`                    | Weight/value data for the sidebar                              |
| 642–762   | Type classes                | Tensor/map/sequence types for shapes                           |
| 764–802   | `Function`                  | ONNX custom function as a subgraph                             |
| 804–969   | `Context`                   | Shared helpers (attributes, types, decode)                     |
| 971–1146  | `Context.Model`             | Model-wide graph building                                      |
| 1148–1327 | `Context.Graph`             | Per-graph building (nodes, initializers)                       |
| 1329–1378 | `Metadata`                  | Operator docs from `onnx-metadata.json`                        |
| 1380–1409 | `Inference`                 | Light shape/type propagation                                   |
| 1411–1462 | Enums                       | `DataLocation`, `DataType`, `AttributeType`                    |
| 1464–1764 | `ProtoReader`               | Standard `.onnx` protobuf files                                |
| 1766–1923 | `OrtReader`                 | ONNX Runtime `.ort` files                                      |
| 1925–2035 | `JsonReader`                | ONNX Saved as .json                                            |
| 2037–2769 | `TextReader`                | Text ONNX syntax. Custom text ONNX format: includes own parser |
| 2771–2793 | `PickleReader`              | Detects pickle-in-`.onnx` (unsupported)                        |
| 2795–2822 | `DataReader`                | `.onnx.data` sidecar files                                     |
| 2824–2855 | `MetaReader`                | `.onnx.meta` sidecar files                                     |
| 2857–2886 | `Location`                  | Reads bytes from external weight files                         |
| 2888–2897 | `Error` + export            | Error type, export `ModelFactory`, ONNX load errors            |
|           |                             |                                                                |

### Quick lookup
| Question                       | Go to                                              |
| ------------------------------ | -------------------------------------------------- |
| File opened / format detected? | `ModelFactory` (6), readers (1464+)                |
| Bytes → protobuf?              | `ProtoReader.read` (1602) + `onnx-proto.js`        |
| Protobuf → graph UI model?     | `Model` (47), `Context.Model` (971), `Graph` (161) |
| One op in the graph?           | `Node` (289)                                       |
| Weight tensor details?         | `Tensor` (440)                                     |
| Op input names like `X`, `W`?  | `Metadata` (1329)                                  |
| External `.data` weights?      | `Location` (2857), `DataReader` (2795              |
### onnx.ModelFactory
[[onnx.ModelFactory match]]
[[onnx.ModelFactory open]]

### onnx.Model
##### How maps ONNX metadata to Netron's generic UI properties
[[mapping ONNX metadata to Netron generic UI properties]]

##### How it instantiates an onnx.Graph
[[how onnx.Model instantiates an onnx.Graph]]

### onnx.Graph
- The heaviest part
##### The constructor
- Takes  GraphProto and loops through all the NodeProto
	- Handles the wiring: figuring out how the output of Node A connects to the input of Node B based on string names

### onnx.Node

##### How it processes an individual operation

##### How it parses the inputs, outputs, and specifically the AttributeProto to figure out the parameters of the layer
### References