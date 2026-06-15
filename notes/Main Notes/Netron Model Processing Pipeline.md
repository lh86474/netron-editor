2026-06-04

Tags: [[ambarella]] [[netron]]
## Netron Model Processing Pipeline
### Notes
![[Pasted image 20260604092822.png|405]]

Okay, we've gone through loading the model file, I don't know how that works, but it does that
- We have to open the file from view, which I haven't seen to be honest

Then, there appears to be a loop between modelfactoryservice and each modelfactory of each format, and once we find the highest confidence score to a modelfactory, we go straight to that modelfactory
- So, there are readers in that format-specific file, and then we go to worker.js

1. Before any match runs, 
	1. ```
	   _filter(context) builds a short list from the big register() table
	   filename ends with a registered extension, or start of file matches a content regex
	   
	
	   ```
1. match() is yes/no: it picks the best match, doesn't have a score or ranking
2. It tries all matches and compares
	1. The first match where it is truthy and open succeeds wins
3. Order matters since earlier register() entries are tried first
### Worker.js
This figures out the positioning of the boxes and wires. 
- It really just relies on one thing: dagre.layout
- Relies on **dagre.js** Directed graph layout for JavaScript
	- 
- It runs in the background, in a sidelane, so it makes sure that the main thread doesn't have to worry about worker.js, but rather just focuses on handling the cliks ont he screens, updating the screen, and running view.js, openign files, building svg
### View
- renders the graph, and displays the visualization to user

### References