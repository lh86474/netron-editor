2026-06-11

Tags: [[netron]]
## dangling references

### Notes
- It means that a node's input list names a tensor that nothing in the graph provides: no graph input, no initializer, and no upstream node output with that name
```
        for (const input of node.input || []) {
            const inputName = referenceName(input);
            if (inputName && !available.has(inputName)) {
                throw new OnnxExportError(`Dangling input reference '${inputName}' on node '${node.name || node.op_type}'.`);
            }
        }
```

Tracks available names
- graph.input names + initializer names
- for each node, every input must already be in available

```
If I see something like
input: ["foo"] but foo was never defined, this is a dangling reference
```
### How we use in merge
- Checks if we forgot to rename something
- some bottom node still references

Top output name doesn't exist

Prefix/rename order bug: prefix bottom tensors but forget to update a node's input string


### References