2026-06-10

Tags: [[javascript]]
## object literal in JavaScript

### Notes

This is an example
```
 const readNode = (node) => ({
        name: node.name,
        type: readType(node.type),
        attributes: (node.attributes || []).map((attribute) => readAttribute(attribute)),
        inputs: (node.inputs || []).map((input) => readArgument(input)),
        outputs: (node.outputs || []).map((output) => readArgument(output))
    });
```

- We are creating a new JavaScript object, this particular a new node object

JavaScript allows us to create objects out of thin air!
We don't have to create the shape of our data ahead of time

Js's object **is dynamic**
- Objects are like hash maps (or called dicts in python)
- No strict typing
### The object is wrapped around in parentheses, making sure that this isn't a function
### References