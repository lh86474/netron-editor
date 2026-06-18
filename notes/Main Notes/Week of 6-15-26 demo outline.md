2026-06-15

Tags: [[ambarella]]
## Week of 6-15-26 demo outline

### Notes
Slides is probably best for organization
### Part 1: High-level overview of Netron
- Netron is a neural network visualizer, and for the past two weeks, I've been developing features to make Netron an editor rather than just a visualizer
- Netron supports over 20 formats, so most of the javascript modules are really just a bunch of compiled schemas, readers, and parsers for those different filetypes. There's a handful of important files, and everything is organized in modules, so it's easy to know what files do what
- I'll first be playing around with the original version of Netron (netron.app), which will make it easier to compare between the original codebase and my version of Netron
	- So, I'll be opening up a small graph on the web version of Netron
	- And as you can see, it's really just a visualizer. You can click on a node or connection to see what properties it has, the attributes, the inputs, etc. 
	- There's different functions like exporting as an icon or png, you can see more information about each graph, and you can zoom, so really, as you can see, it's a visualizer for people to analyze the graph rather than to edit it

**Slide for text description of our differences**
1. Two panes instead 1 pane
2. Can export graphs as onnx files rather than SVG or PNG
3. You can add nodes (possibly add remove as well)
4. You can extract a subgraph 
5. And you can merge two graphs
### Part 2 Demo Itself
- I'll be opening up the same graph. I'll be playing around with the editing features first, and then I'll go into the merging
- So first of all, there's two panes instead of one. The left side of the original graph that we can reference to, and the right pane is the actual editing pane where we will make our edits
- To make it easier for the user to continuously reference the original pane, there is also a new synchronized scroll feature between the two panes
- So, if I wanted to change the attributes, I could click on a node, and I can start changing the attributes
- I can delete attributes, and I can add attributes, so let's delete an attribute on this convolution node and add a test attribute
- We can do the same for connections

- You can also add and remove nodes. They will automatically be red. So anything that we've edited, it will be red
- You add node by using the right-click, and you hover over any node you can click insert above or insert below. Netron will display a list of operators supported by the onnx intermediate representation 
- To add your properties, you can start adding it manually. To see your attributes, you will have to refresh
- Now, after we have edited everything, let's extract 
- We also use right click to mark our begin node and our end node. We can mark multiple ones
	- It beginning will be marked as green, the end nodes will be marked as blue. 
- Let's extract the subgraph, and then let's export the graph
	- The file name will automatically have a suffix of underscore subgraph, so it helps know what files they're downloading. Let's download it and see if we can still our changes
- And by the way, there's a sidebar here where we can open new graphs

That's basically all of the editing features that we have, is there any questions?

Now, let's move on to merging. So, I have two graphs that are compatible and are ready to be merged, so I'll demonstrate a successful merge first. 
- So I can upload two files, and the logic is that Netron will check the data type, rank, dimensions, of the input and output nodes of the graphs
- The user can't choose which graph will be the upstream and which graph is the downstream
	- What upstream means is that the upstream graph, which is graph in which the output of the graph is being used, and vice versa for the downstream. To make that more clear, I can also show the source graphs so people can see where exactly the graph is being merged. I'll definitely have to work on making thismore user friendly since this doesn't look too good, and it's hard for people to actually see the differences
- So, these two graphs can only be merged in this way, with this graph as upstream, and this one as downstream. If we try to swap roles, it doesn't worknsince the input and outputs don't work. 
- We will display some errors that have to be fixed, and Netron will find the outputs that can possibly be used, but it doesn't work. 
- Ok, let's try to export the merged graphs. Exporting should work for anything as long there is a graph because our code takes all of the information from the universal model object that Netron uses to build the entire graph and uses a lot of parsers to rebuild the onnx binary data.
- And when we download the graph and try to visualize it again, you see that our data is still there

So yeah, that's basically all of the features I have worked on. I've written a lot of markdown files that detail how exactly all of these features work, but this is just the high-level overview now. I'd love to hear some feedback from you guys. 
### To-dos
**Fix problem that added attributes doesn't show up immediately on added nodes**
**I need to support a feature to delete nodes**
**Fix bug where we see two input boxes instead of one in added nodes**
**Fix when we actually extract the graph, I want to be able to see the actual input and output because right now it just says x and y**

- We need a feature where if we mark an added node as the beginning, we will highlight it not as red, but as two colors, with the green border around the red border

![[Pasted image 20260615174222.png]]
