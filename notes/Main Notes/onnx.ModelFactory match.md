2026-06-03

Tags: [[ambarella]] [[onnx]] [[netron]] 
### When we upload onnx, how do we know to use onnx.js and how do we know to use modelfactory

Upload always goes through `ModelFactoryService`; it picks plugin modules from the file extension and header, loads `onnx.js` when ONNX is a candidate, instantiates its exported `ModelFactory`, and uses `match()` then `open()` to confirm and parse the file.
## onnx.ModelFactory match

**What is a ModelFactory?**
- It's the entry point for one model format
### Notes
##### match()
- match is a chain of format detectors
- Really just here to tell us which parser to use

filename OK for ONNX?
  → Ort? → Proto? → Text? → Json? → Pickle? → Data sidecar? → Meta sidecar?
  → first yes: store reader on context
  → all no: return null (not ONNX, try another factory)

**Storing reader on context means that after match picks a format, it saves the chosen reader on the same object so open can run it later**
  
const identifier = context.identifier
- context is a view.Context wrapper around the file stream. 
- **identifier is just the filename**, like weights.onnx, model.onnx, not the full path

###### Caffe Exclusion gate

if filename ends with one of the Caffe2 names, the whole reader loop is skipped and match returns null
```
const extensions = [
    'saved_model.pb', 'predict_net.pb', 'init_net.pb',
    'predict_net.pbtxt', 'init_net.pbtxt', 'predict_net.prototxt', 'init_net.prototxt'
];
if (!extensions.some((extension) => identifier.endsWith(extension))) {
    // try readers...
}
return null;

- Those files are protobuf too, but they belong to Caffe2, not ONNX
  ONNX factory steps aside so caffe2.js can claim them. 
```

##### Try readers in priority order

Readers are tried one at a time (sequential await). The first match gets it since we're awaiting for entry.open(context);

```
  const entries = [
                onnx.OrtReader,
                onnx.ProtoReader,
                onnx.TextReader,
                onnx.JsonReader,
                onnx.PickleReader,
                onnx.DataReader,
                onnx.MetaReader
            ];
            for (const entry of entries) {
                // eslint-disable-next-line no-await-in-loop
                const reader = await entry.open(context);
                if (reader) {
                    return context.set(reader.name, reader);
                }
            }
```

Some important readers
- OrtReader goes first so ONNX runtime .ort files are not misidentified as standard ONNX protobuf
- ProtoReader is the workhorse for .onnx: peeks bytes and inspects protobuf field tags without decoding the whole file
- Looks for ModelProto tag patterns like field 7 graph

### ON success - stash reader on context
```
return context.set(reader.name, reader);
```
- context.set is defined in view.js

```
    set(type, value) {
        this.type = type;
        this.value = value;
        return type;
    }
```

The context.type = reader name string like onnx.proto, onnx.ort

context.value = the reader instance
- ProtoReader with encoding: 'binary', type:'model'

1. Match is cheap, read() is expensive
2. Reader order matters
	1. Ort before Proto avoids misclassification
	2. data/meta readers rely heavily on filename suffixes, so they come late
	3. PickleReader can "match" but fail later
###### Example, opening resnet50.onnx
1. `ModelFactoryService` loads `./onnx` (extension `.onnx` matches).
2. `match` runs — not a Caffe2 filename.
3. `OrtReader.open` → no `ORTM` → `null`.
4. `ProtoReader.open` → sees ModelProto protobuf signature → returns `new ProtoReader(context, 'binary', 'model')`.
5. `context.set('onnx.proto', reader)` → returns `'onnx.proto'`.
6. `open` runs → `reader.read()` decodes `ModelProto` → `new onnx.Model(...)`.
