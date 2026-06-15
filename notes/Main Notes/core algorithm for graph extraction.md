2026-06-10

Tags: [[ambarella]] [[netron]]
## core algorithm for graph extraction

### Notes

1. Forward from begin: following output tensors
	1. We will call this findValueConsumers
2. Backward from end: new findValueProducers (mirror of consumers)
3. Keep forward and backward (which means the begin and end)

extractSubgraph(graph, nodeSet)
- We deepclone the kept nodes (reuse readNode style logic from readModel)
- The readModel

```
 const readNode = (node) => ({
        name: node.name,
        type: readType(node.type),
        attributes: (node.attributes || []).map((attribute) => readAttribute(attribute)),
        inputs: (node.inputs || []).map((input) => readArgument(input)),
        outputs: (node.outputs || []).map((output) => readArgument(output))
    });
```

This supports deep-cloning the kept nodes. 
It looks like we have a structure of each node. 
notice that we either have some of the attributes or we don't have anything. 
- There is some other function readType that gets us the type somehow. 

```
attributes: (node.attributes || []).map((attribute) => readAttribute(attribute))

Fallback to empty array. We do this because if node.attributes is undefined, calling .map() would crash our app with TypeError

```

### We need to set new graph.inputs and graph.output

- We drop everything else. 

We have to **export Subgraph and call it from view.js**


### References