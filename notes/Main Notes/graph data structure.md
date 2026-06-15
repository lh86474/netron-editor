2026-06-05

Tags: [[ambarella]] [[netron]]
## graph data structure

### Notes

- Graph represented by a custom data structure in the grapher.Graph class. 
- Maintain collections of nodes and edges and supports compound graphs where nodes can contain other nodes. 
- nodes with associated labels / attributes
- edges connecting nodes
- parent-child relationships for hierarchical graphs
- focus and interaction states
- event handling for interactive elements


### Layout
- use custom Dagre algorithm to position nodes and edges in a way that effectively visualizes the networks structure.
	- Dagre is JavaScript implementation of a dAG layout algorithm that produces hierarchical layouts
	
![[Pasted image 20260605144128.png]]

1. Removes cycles in the graph (temporarily reverses some edges)
2. Assigns ranks (vertical positions) to nodes using network simplex algorithm
3. Handles compound graphs (clusters) with nesting
4. Removes empty ranks and normalizes the graph
5. Positions nodes within their ranks
6. Routes edges with proper paths and coordinates
7. Restores the original edge directions

### Rendering system
- Convert laid-out graph into SVG elements for display. 

![[Pasted image 20260605144313.png]]

Node and edge elements
- Render nodes with headers, borders, and argument lists
- renders edges with proper arrow markers and paths
- adds hitboxes for user interaction (edge-paths-hit-test)
- set up event handlers for interactive elements
- applies CSS styles for different node types and states

### Larger graphs, go to worker.js
- web worker on another thread: prevent UI freezes

