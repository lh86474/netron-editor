2026-06-11

Tags: [[ambarella]] [[netron]]
## plan to merge two onnx files draft two
 
[[exchanging DRAM buffer in neural networks]]
[[source and sink, merging feature]]
- Start with now logic will look like, then go to represent in GUI
- logic is the approach in [[plan to merge two onnx files draft one]]
### Changes
1. Possibly have three-way split, GUI connect, right in the visualizer. So, we can upload new graphs and open a new view real-time
2. The graph being on the top or bottom does not matter that much, source and sink matters more
3. It's more about identifying the correct nodes to connect to, the nodes could even be inner nodes
4. We have some kind of call to a graph, instead of calling, I want that graph merged
	1. It just has to be cleaned

Task: what will new method will look like, how to represent in GUI, what is best approach, best way
- Upload two files straight from the start: could possibly work
	- We make sure it is possible to connect cleanly. 
- but then this doesn't work the best since Varun should this expand graph thingy. So, it would be helpful to have the expanded graph on a separate view and the original graph on another pane, and then we could have the merged graph on a pane on the right
- edges are defined **entirely by matching the string names in a node's output array to the string names in another node's input array**

