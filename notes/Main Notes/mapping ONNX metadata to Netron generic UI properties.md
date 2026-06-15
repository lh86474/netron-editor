2026-06-03

Tags: [[ambarella]] [[netron]] 
## mapping ONNX metadata to Netron generic UI properties

### Notes
#### onnx.Model's job is to fill in some fields that the Model Properties wants from ONNX data

| Field         | What users see                                         |
| ------------- | ------------------------------------------------------ |
| `format`      | e.g. "ONNX v8"                                         |
| `producer`    | Who created it, e.g. "pytorch 2.1"                     |
| `version`     | Model version number                                   |
| `description` | Free-text description                                  |
| `domain`      | ONNX domain                                            |
| `imports`     | Which operator sets the model uses, e.g. "ai.onnx v13" |
| `source`      | Original framework, e.g. "pytorch"                     |
| `metadata`    | Extra key/value pairs (author, license, custom tags)   |
| `modules`     | The graph(s) to draw                                   |
| `functions`   | Custom ONNX functions (optional subgraphs)             |

- Netron supports many formats, and each format has its own loader, but they all produce the same kind of object. 

```
onnx.Model is ONNX's version of the object
```

### How onnx.Model is built
1. It receives target
	1. The reader after the file is parsed
		1. Contains the raw ONNX structure (ModelProto)
		2. Contains things like "ONNX v8", for the format label
2. metadata
	1. operator documentation (from onnx-metadata.json)
		1. used to label nodes correctly
		2. not the same as the model's metadata in the sidebar

### Summary
1. onnx.Model is an adapter, not the visualizer
2. It translates ONNX's native structure into Netron's generic model shape
3. The UI is format-agnostic: always reads format, producer, metadata, modules, etc. 
4. ONNX-specific logic stays in onnx.js, the rest of Netron doesn't need to know about protobuf or ONNX field names

5. File opened     →  Reader parses bytes into ONNX ModelProto
6. onnx.Model built →  Header fields mapped to Netron property names
7. Graph built      →  modules + functions filled for visualization
8. UI reads model   →  Model Properties sidebar + graph view

 
### References