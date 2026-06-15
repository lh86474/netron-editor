2026-06-10

Tags: [[ambarella]]
## 6-10-26 + documentation of changes

### Notes
### Supported adding more properties to connections
[[6-10-26 connection properties]]
### Support inserting a node(above or bottom) with right click
[[6-10-26 Inserting Nodes]]

### Supported graph extraction and node marking as begin or end
- Created a new button for graph extraction
[[core algorithm for graph extraction]]
[[session reset for graph extraction]]
[[summary of how graph extraction was done]]

### Supported download filenaming in browser
[[filenaming feature]]

multiple start / end points for extraction

Start thinking about how to merge two .onnx files
- Make sure that the two input / output are compatible
	- How do we know this?

What Varun showed me
- Subgraphs as nodes on top of the viewer
- There is an expand function for the node: You can expand it to see the subgraph

Then, he started to talk about a function

positional argument, name argument
- Oh, that's what he meant
- For the arguments, they're just like the pairings of input and output nodes
When we pass arguments by calling a function, we have **inputs**. The output, the pairings would be the arguments parameters that are actually used in a function


In functions, there are specific ways to actually pair those arguments. There is one where it's defined by position, another by nae


It seems like for graphs, it has to be name, which he mentioned. It's really hard to determine it by position, how does that even matter?
- First, what is the logic required to be able to rename those properties?
- Well, we do something with Netron, some kind of function that gets us to rename those properties with enumeration, like output1, output2 or data[1] data[2] or whatever it happens to be. We need some kind of enumeration here

So, he mentioned something about changing the property, I guess about the name so that it would be obvious that one input node needs to match to an output node. 

lie, input1 must match with output 1, that makes a lot of sense

couple of questions to answer now. 

How do we make sure that these names are the same? 

Then, he basically told me to pretend that the graphs were like those arguments. We can pass them in

- So, we pass the inputs in. Okay, we have those, and we pass in the output from downstream graph. Okay cool, and now what???


ambarella has custom schema


