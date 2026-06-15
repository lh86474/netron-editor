2026-06-12

Tags: [[ambarella]]
## plan to merge two onnx files draft three

1. Possibly have three-way split, GUI connect, right in the visualizer. So, we can upload new graphs and open a new view real-time
	1. Solution: I will have an option for this instead of making default. In regular editor, I will have button that allows the user to see the upstream and downstream graph on the left two panes, and on the far right the merged graph
2. The graph being on the top or bottom does not matter that much, source and sink matters more
	1. Yes, logic still doesn't change
3. It's more about identifying the correct nodes to connect to, the nodes could even be inner nodes
	1. What if number of input / output nodes are not equal to each other
4. We have some kind of call to a graph, instead of calling, I want that graph merged
	1. It just has to be cleaned
### Current method
- Button in welcome screen
	- Other entry points:
	- Button on sidebar that allows user to upload another file for merging
- I can choose two graphs: I don't choose if they are upstream or downstream
- Then, some logic will decide if it is possible to merge 
	- Data type, rank, size, dimension
	- Match input and output to each other
- If possible to merge, I will rename 


