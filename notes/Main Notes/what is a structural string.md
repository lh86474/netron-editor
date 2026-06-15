2026-06-11

Tags: [[other questions in cs]]
## what is a structural string

### Notes

- Plain text that is written according to strict, predictable set of grammatical rules
- Uses stuff like brackets, colons, quotes

Computers can interpret it, humans can read it

.pbtxt or .textproto is a structural string. Written in plain text using Google's Protocol Buffer syntax
```
node {
  input: "image_data"
  op_type: "Conv"
  name: "convolution_layer_1"
  attribute {
    name: "kernel_shape"
    ints: [3, 3]
  }
}
```

Slow for computers
- It has to runa  Lexer and Parser
	- Read character by character
	- Matching
	- Type conversion, convert from char to actual data type

JSON, HTML, XML, YAML are structural strings
- easy to debug, but too bulky and slow for heavy, high-performance math tasks
### References