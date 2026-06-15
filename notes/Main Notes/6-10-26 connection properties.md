2026-06-10

Tags: [[ambarella]] [[netron]]
### Notes

### **1. Core Data Model (`model-editor.js`)**

**Goal:** Make the existing "Attribute" system work for both Nodes and Values (Connections).

- **Unified ID Parsing:** Instead of a function that only understands Node IDs, create `parseAttributeEntityId` to understand both Node IDs (`node:M/attr:K`) and Value IDs (`value:M/attr:K`).
    
- **Snapshot & Clone:** When copying a Value, also copy its attributes. Convert ONNX's `metadata` format into standard string attributes. Fix a bug where editing a description couldn't be undone.
    
- **Validation:** Extend the validation logic so it can check if a name is valid on a Value (preventing users from naming a custom property `name`, `type`, or `description`, which are reserved).
    
- **Applying Patches (Edits):** Update the central patch-applier to look at the parent's ID. If the parent is a Node, edit `node.attributes`. If the parent is a Value, edit `value.attributes`.
    

### **2. History & Undo (`delta-tracker.js`)**

**Goal:** Ensure changes to Value attributes can be tracked and undone.

- **No Structural Changes Needed!** Because Values will use the exact same ID structure (`/attr:`) as Nodes, the existing history tracker will handle them automatically. Just ensure the `description` field is properly tracked.
    

### **3. User Interface (`view.js`)**

**Goal:** Add a "+ Add Property" button to the Connection sidebar, reusing the "+ Add Attribute" logic from the Node sidebar.

- **Shared UI Component:** Extract the "Add Row" button logic from the Node sidebar into a shared `addAttributeControls` helper function.
    
- **Editable Connection Sidebar:**
    
    - Always show the `description` field so it can be edited.
        
    - Right below the description, render any existing attributes.
        
    - Add the shared `addAttributeControls` button, but label it **"+ Add Property"**.
        
- **Read-Only Connection Sidebar:** Display any custom properties right after the description.
    
- **Refreshing the UI:** No changes needed. The system already knows that editing an attribute doesn't require redrawing the entire graph layout.
    

### **4. Loading Models (`onnx.js`)**

**Goal:** Ensure custom metadata is loaded when an ONNX file is opened.

- When reading the file, ensure `metadata_props` on intermediate tensors (connections) are loaded into `tensor.metadata`, exactly like graph inputs and outputs currently do.
    
- The `model-editor.js` will handle converting this raw metadata into editable `attributes`.
    

### **5. Saving Models (`onnx-export.js`)**

**Goal:** Ensure custom properties are saved back into the ONNX file as `metadata_props`.

- **Modify `applyAttributeChanges()`:** Instead of writing a new function to save Value properties, upgrade the existing attribute-saving function.
    
- It should parse the ID to determine if the edit belongs to a Node or a Value.
    
    - **If Node:** Save it as a `NodeAttribute` (existing logic).
        
    - **If Value:** Find the corresponding tensor in the graph, find its `ValueInfoProto`, and save the property as a string in `metadata_props`.
        
    - **Deletions:** Look up the original property by index to delete it properly.

