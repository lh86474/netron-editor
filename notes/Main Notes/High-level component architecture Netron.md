2026-06-04

Tags: [[ambarella]] [[netron]]
### Notes

![[Pasted image 20260604091432.png]]

- I won't have to worry about how Netron is built with CI/CD and what-not

But I know that there are three main user interfaces. There is definitely the web version, there is the desktop app one that is built with electron.js, and there is the python API, which I won't understand too much




### Core processing Engine
- As I've seen before, the view.View dictates much of the content that is put and how the arrows are drawn and everything. It's about drawing, labels, clicks, zoom, etc. 
- I'm not too sure what worker.js is supposed to do, Not sure if I have to touch that
- I've spent a lot of time understanding ModelFActoryservice. It's a subcomponent of view, I believe, and it's main thing is to decide which js module to use based on what file we have uploaded to Netron. 
- Then, we go into onnx.js, and the reader parse the file

### Visualization system
- I know that there is a grapher.css that dictates how the graphs looks. That's where I change things such as colors
- I'm not too sure about the SVG rendering or how view-sidebar.js works, but I guess a high-level understanding is just needed for now. 


### References
[lutzroeder/netron | DeepWiki](https://deepwiki.com/lutzroeder/netron)