2026-06-10

Tags: [[ambarella]]

## session reset for graph extraction

### Notes

We can't keep the existing delta: entity IDs

We will **reset the edit baseline** so the base becomes a new "clean" state with an empty delta

We can 
### add EditorState.replaceGraph(graphIndex, newGraph)
```
// Pseudocode — lives in model-editor.js
replaceGraph(graphIndex, newGraph) {
    this.modified.model.modules[graphIndex] = newGraph;
    this._snapshot = buildOriginalSnapshot(this.modified.model);
    this.delta = new DeltaTracker(this._snapshot);
}
```

- Looks like the graph has another property with it. We first have a new modified.model.modules
	- The model.modules looks like the graph itself
### References