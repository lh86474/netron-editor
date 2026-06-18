2026-06-16

Tags: [[ambarella]] [[netron]]
## bug - seeing actual input and output in extract graph

### Notes

![[Pasted image 20260616104859.png|373]]

![[Pasted image 20260616104915.png|326]]

I want actual names of input and output instead of x and y

### The problem
It's in extractSubgraph in model-editor.js, not the renderer
Netron sues two different names for graph I/O
argument.name (It's the X and Y)
argument.value[0].name This is the actual tensor identifier, the pool1_1, fire3/squeeze

```
        for (const input of graph.input) {
            const value = context.value(input.name);
            value.metadata = input.metadata || [];
            if (!value.initializer) {
                this._inputs.push(new onnx.Argument(input.name, [value]));
            }
        }
        for (const output of graph.output) {
            const value = context.value(output.name);
            value.metadata = output.metadata || [];
            if (!value.initializer) {
                this._outputs.push(new onnx.Argument(output.name, [value]));
            }
        }
```
- this is how it looks like while we are building up the graph in onnx.js

in model-editor-js, we are clearly using input.name rather than the other one

```
                if (!boundaryInputs.has(value.name)) {
                    boundaryInputs.set(value.name, {
                        name: input.name,
                        value: [cloneExtractValue(value, valueMap)]
                    });
```

The fix
```
// boundary inputs (~line 672)
boundaryInputs.set(value.name, {
    name: value.name,  // was: input.name
    value: [cloneExtractValue(value, valueMap)]
});

// boundary outputs (~line 696 and ~line 710)
boundaryOutputs.set(value.name, {
    name: value.name,  // was: output.name
    value: [cloneExtractValue(value, valueMap)]
});
```