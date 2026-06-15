2026-06-11

Tags: [[netron]] [[ambarella]]
## plan to merge two onnx files
#### Plan to merge two .onnx files

3. Input and output are compatible
	1. First, we could do it based on position: positional argument
	2. Second, we could do it by name: we would have to change the property of the input / output node so names follow a universal naming rule and be enumerated in some way
		1. Name argument
4. Eventually, there is some kind of subgraph
	1. Expand function for the node. Expand it to see the graph
	2. The subgraphs are isolated components on the top, just there: existing. 
	3. Not too sure about that, why?
5. I would have to define a function that takes in inputs (the upstream graph) 
	1. When I call a function, I pass in the inputs

### Ok cool, there is a way to name the graph, but what about determining how to determine the name?

#### How to determine compatability
- In ONNX's underlying structure **everything is linked by name**, hence, I will have to use the name argument thing. 
- Take all nodes from the output and input and append them to each other, renaming the input and output so that they are identical to each other

1. By Data type
	1. Must be same datatype
	2. ONNX runtime will crash if datatype isn't
	3. Inspect TensorProto.DataType
		1. of the top's output valueinfoproto
2. Shape and Dimension Matching
	1. Tensors have to be the same size, or comaptible
	2. Rank: same dimensions
		1. We need that: think about lin alg: matrix inner dimensions must align
	3. Dimension sizes: top outputs and bottom input must expect same
		1. if top outputs [1, 256, 12, 12], bottom input msut expect [1, 256, 12, 12]
	4. Dynamic Axes
		1. batch_size
### Explicit mapping
- I should make some kind of map
- key is the top graph's output, value is the input that it's going to

### My plan
1. Extract the graph output from the top model and input from bottom model
2. Check for data type, shape, and dimension (based on tensorProto)
3. If compatible: rename the bottom input to match the top output
4. Merging: create a new onnx.graphProto
	1. Combine node from top and bottom
	2. combine initializer weights from top and bottom
	3. new graph intput will be top model's input
	4. output will be bottom model's outputs
	5. To merge, I edit the input list of the bottom code: change input list of the bottom node to they share the same string name
5. If unable, throw some errors based on incompatibility 

### How by name

In NodeProto: every op is represented by a NodeProto
Operation:
input:
output:t
