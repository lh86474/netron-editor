2026-06-10

Tags: [[ambarella]] [[netron]]
## 6-10-26 Inserting Nodes

### Notes

At its core, this feature allows a user to right-click a node, pick a new operation from a searchable list, and automatically splice it into the graph either right before or right after the selected node.

### **1. The Core Logic: Graph Rewiring**

When a new node is inserted, the connections (tensors) must be automatically re-routed.

- **Insert Above (Upstream):** The new node intercepts the data. It steals the reference node's inputs. The reference node is then rewired to consume the new node's outputs.
    
- **Insert Below (Downstream):** The new node processes the output. It consumes the reference node's outputs. All downstream nodes that _used_ to point to the reference node are rewired to point to the new node instead.
    

### **2. Change Tracking (Undo/Redo)**

Because the graph stores nodes in an array, inserting a new node shifts everything after it down by one index position.

- **The Fix:** Update the `delta-tracker` so that when a splice happens, any saved history states that reference an index _after_ the insertion point get their IDs bumped by +1. This prevents the undo/redo stack from corrupting.
	- 
### **3. Saving the File (ONNX Export)**

Visual changes in the editor must be translated back into the raw ONNX file format upon saving.

- **Sync Connections:** Scan the graph for newly added nodes. Update the text-based `input` and `output` arrays of existing nodes to match the new wiring.
	- Similar to new properties, we try to find the newly added nodes
    
- **Inject Nodes:** Create the underlying data structure (`NodeProto`) for the new node and insert it into the correct position in the file's node list.
	- I'm not sure how this works
    

### **4. User Interface (UI)**

The user needs a way to trigger the action and select the node type.

- **The Context Menu:** Add a lightweight, floating right-click menu to nodes with two options: "Insert Above…" and "Insert Below…".
	- This would be in view.js
    
- **The Operator Picker:** After clicking an option, open a searchable, scrolling popup list of available ONNX operations (filtered to match the model's current version).
	- Probably in view.js as well
    
- **Guardrails:** Disable this feature if the graph is read-only, if the clicked item is a terminal input/output rather than a real node, or if the file isn't an ONNX model.
	- Probably some kind of if-then block
    

### **5. Implementation Order**

Always build from the data layer up to the visual layer.

1. **Data Engine:** Write the `insertNode` function to handle the math and logic of rewiring inputs and outputs.
    
2. **History:** Write the index-shifting logic so undo/redo survives the insertion.
    
3. **Export:** Ensure the rewired graph can be saved as a valid ONNX file.
    
4. **Tests:** Write unit tests for the data, history, and export steps.
    
5. **UI:** Finally, build the right-click menu, the search popup, and the CSS styling.

### Some bugs
1. I had to disable cache in grapher.js, which prevented the browser menu suppression

### Bug
1. After the second insertion, the graph disappeared. This is a bug
We need a **lock/queue on refresh()** so the rebuild can run on the same SBG origin at once.
- That race can leave the modified pane empty: especially if one refresh clears old nodes and the other fails or finishes in a bad order



```
if (status === '') {
	for (const child of oldChildren) {
		if (child.parentNode === origin) {
			origin.removeChild(child);
		}
	}
}
```
##### Why the second insert breaks

On the first insert, `applyPatch` does:

1. Splice the node into the model
2. `remapNodeIndices(...)` — usually nothing to remap → no emit
3. `record(change)` → one delta emit → one refresh → OK

On the second insert (when the first inserted node is still in the delta):

1. Splice the new node
2. `remapNodeIndices(...)` — remaps the first insert’s entity id → `_emit()` → refresh #1 starts
3. `record(second insert)` → `_emit()` again → refresh #2 starts while #1 may still be running
