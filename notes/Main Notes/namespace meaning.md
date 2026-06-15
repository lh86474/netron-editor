2026-06-10

Tags: [[other questions in cs]]
## namespace meaning

### Notes
It's really just a **space for a name, a scope.**

IN ONNX, the IR specification divides all identifiers into three "distinct namespaces (or scopes)"
1. **Values:** The names of the data tensors (inputs, outputs, and weights/initializers).
    
2. **Nodes:** The names of the operators/computations.
    
3. **Graphs:** The names of the graphs and subgraphs.
    

Because they are in different namespaces, a Tensor, a Node, and a Graph can all share the exact same string name (e.g., `"Main"`) without confusing the ONNX runtime.
### References