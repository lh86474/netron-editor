2026-06-03

Tags: [[ambarella]] [[netron]] [[onnx]]
## onnx.ModelFactory open

### Notes

### Summary
open runs the reader's parser (read), loads the operator documentation, then compiles the protobuf graph into Netron's Model with modules, nodes, inputs, and outputs

`ProtoReader.read` (line 1602) → `onnx.Model` constructor (line 47) → `onnx.Graph` constructor (line 161). That covers a normal `.onnx` file end to end.

#### Where open sits on the pipeline

match(context)     →  context.value = ProtoReader (etc.)
open(context)      →  parse bytes + build onnx.Model
view.js            →  picks a graph, draws nodes/edges

```
   async open(context) {
        const target = context.value;
        await target.read();
        const metadata = await onnx.Metadata.open(context);
        return new onnx.Model(metadata, target);
    }
```

#### Step 1
const target = context.value;
- Get the reader from match
- the reader has configuration (encoding, type, offset) but usually no parsed model yet.

#### Step 2: parse the file
```
await target.read()
```
target is the reader, each reader's read **decodes bytes into ONNX protobuf objects and fills in the reader**

#### Step 3: operator docs
```
const metadata = await onnx.Metadata.open(context);
- Loads onnx-metadata.json
```

onnx-metadata.json describes operators per opset: input names (X, W, B for Conv) attribute types, defaults, etc.
- Used later when **building nodes so the UI shows meaningful names**

#### Step 4: protobuf -> Netron graph
```
return new onnx.Model(metadata, target);

extract the model-level info, then built the graph

from target.model (the protobuf)
```