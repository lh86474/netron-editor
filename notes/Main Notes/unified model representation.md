2026-06-04

Tags: [[ambarella]] [[netron]]
## unified model representation

### Notes

![[Pasted image 20260604101718.png]]

```
 async open(context) {
        const target = context.value;
        await target.read();
        const metadata = await onnx.Metadata.open(context);
        return new onnx.Model(metadata, target);
    }
```

target is something like ProtoReader
await target.read(): target.model is the raw parsed protobuf
- read() can also load external weights from the file

metadata is from **onnx-metadata.json**


### Every modelFactory.open() returns a plain JavaScript object that view.js knows to raed
Okay, there is a unified model representation that view.js understands
- This is just a breakdown of everything. 
- So, we have some metadata that describe the format, producer, version. There is a megengine-metadata.json that gives us the meatadata. 
- then, we have the modules[], most notably the graph object that contains the all of the inputs, outputs, name, description, and our nodes. 
- Each node will have a lot of data as well, like its type, inputs, outupts, what attributes it has and stuff. 
- And we have the argument object, value, value object, name, type, and initializer