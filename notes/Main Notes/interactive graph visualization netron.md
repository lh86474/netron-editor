2026-06-04

Tags: [[ambarella]] [[netron]]
## interactive graph visualization

### Notes

![[Pasted image 20260604095535.png]]

I've never heard of view.View controller, I'll have to look into that
### view.View controller

But, it looks like view.View controller branches into three different things that define the visualization features 

1. Boots the UI from start()
	1. It wire buttons, gets it working, addEventlistener, this.zoomIn, zoomOut
	2. Has the shortcuts and everything, platforms
2. view is really what controls the screen. 
	1. Draw / refresh graph: navigate graphs
3. User settings in toggle
4. Render? 
	1. Is this the SVG generation
	2. It doesn't draw SVG element itself, it orchestrates the pipeline
	3. The actual SVG DOM is built in build() / update() in view.Graph and grapher.js

### Grapher.js is the engine that we're talking about
- Netron's low-level graph drawing engine
	- Turns nodes + edges with sizes into SVG and runs layout
	- Doesn't read ONNX or whatnot

### view.js decides what to show from parsed model: grapher.js decides how to draw and position boxes and wires on the canvas

### References