2026-06-11

Tags: [[machine learning]] [[deep learning]]
## source and sink

### Notes

####  Source and Sink
- Terms come from graph theory

### Source
- A node that produces data **but does not receive any input from other nodes inside the graph**
	- In an ONNX file, this is inputs and initializers (the raw weights/biases)

### Sink
- the node that consumes data but does not output to any other nodes inside the graph. 
- These are the final outputs of the model
	- The final classification logits or bounding box coordinates

### Why top doesn't matter too much
Netron UI has top-down rendering: looks like it has to be stacked on top of each other
- Under the hood in onnx.proto, visual position is quit irrelevant
- execution doesn't care which node is listed first, it cares about the edges that connect them
- edges are defined **entirely by matching the string names in a node's output array to the string names in another node's input array**
### Merging Logic
- I need routing logic
- Tell the framework how to wire models together
	- Which is sink
	- which is the source?

How do I rewrite protobuf strings **so the sink of one slows seamlessly into the source of the other**
### References