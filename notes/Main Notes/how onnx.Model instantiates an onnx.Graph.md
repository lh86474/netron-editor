2026-06-03

Tags: [[ambarella]] [[netron]]
## how onnx.Model instantiates an onnx.Graph

### Notes

onnx.Model does not call new onnx.Graph() directly. It goes through a builder called Context.Model, which creates the graph

```
        const context = new onnx.Context.Model(metadata, target.locations, imports, model.graph, model.functions);
        const graph = context.graph(null);
        if (graph) {
            this._modules.push(graph);
        }
```

- Create Context.Model with the raw ONNX graph (model.graph)
- Calls context.graph(null) to get the finished onnx.Graph
- Push it into **this.modules**. This is what the UI draws

#### Here, model.graph is still protobuf
### References