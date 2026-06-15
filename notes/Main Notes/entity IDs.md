2026-06-10

Tags: [[ambarella]] [[netron]]
## entity IDs

### Notes

They are stable, path-like string identifiers that the model editor uses to point at a specific editable thing in a loaded graph. 
- Keys in DeltaTracker, the handles in editor patches, and what export/UI code uses to find the right node

Not ONNX names, protobuf field IDs

index-based paths into the in-memory graph structure

### Nodes
- Live in index graph.nodes
```
        const nodeIndex = nodes.indexOf(node);
        obj._entityId = nodeIndex >= 0 ? `graph:${this.graphIndex}/node:${nodeIndex}` : null;
```
### Values
- Tensors on edges: assigned by enumerateGraphValues()
```
export const enumerateGraphValues = (graph, graphIndex) => {
    const map = new Map();
    let index = 0;
    const track = (value) => {
        if (!value || map.has(value)) {
            return;
        }
        map.set(value, `graph:${graphIndex}/value:${index++}`);
    };
    // ... walks inputs, outputs, node I/O
    return map;
};
```

### Entity Ids
1. Change tracking — `DeltaTracker` stores edits keyed by `entityId` and exposes states like `unchanged`, `modified`, `added`, `deleted`.
    
2. Editor patches — UI commits like `{ entityId, entityType, changeType, property, newValue }` through `EditorState.applyPatch()`.
    
3. Original snapshot — `buildOriginalSnapshot()` seeds baseline values keyed by entity ID (value name/type/description use keys like `graph:0/value:1:name`).
    
4. Visual feedback — graph nodes/values carry `_entityId` so `applyDeltaStyle()` can highlight edited elements.
    
5. Export — `onnx-export.js` parses `entityId` from each change and applies it back to the modified model.

#### editor's coordinate system for which graph / node / value/ attribute was edited

### References