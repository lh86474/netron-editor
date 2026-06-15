2026-06-02

Tags: [[ambarella]] [[netron]]
## about netron

### Notes

1. Written in JavaScript
2. Frontend UI is just HTML and CSS
	1. Uses custom DOM manipulation rather than relying on big frameworks like React or Angular
3. To render graphs, it uses a custom adaptation of dagre to calculate the coordinates and draw the nodes and edges of the neural network on an HTML5 canvas element or SVG
4. Electron is used to allow the web app to be packaged as a standalone desktop for macOS, Windows, and Linux
5. Uses web server protocols so that it can run purely on the browser
6. A lightweight python wrapper is provided on PyPI 
	1. pip install netron
7. spins up a local web server to host static HTML/JS files and opens our default browser

### Parts of Netron
#### 1. Core Application Layer
1. index.html / app.js entry point for the web app
	1. Handles loading the UI, manage the file drop events, set up th elayout
2. view.js
	1. Massive core of the visualizer
	2. Takes the parsed graph data and handles the logic for rendering **the boxes (nodes)**, connecting the lines, zooming, panning, and displaying the sidebar properties
3. sidebar.js: slide-out panel that displays node properties
Note: 
#### 2. Framework Parsers (The "Readers")
1. The bulk of the logic lives here. For every supported framework, there is a dedicated JavaScript file responsible for translating that specific file format into Netron's universal **internal graph object**
2. onnx.js: contain the logic to read an .onnx file
3. pytorch.js: contain the logic to parse pytorch format
4. tf.js / tfltie.js: handle standard tensorflow and tensorflow lite models

#### 3. Protobuf Definitions *-proto.js
- Many ML models are serialized using Protocol Buffers, Netron must include schemas to understand the binary data
	- onnx-proto.js **is the javascript translation of the onnx.proto3** schema that I've been studying
	- caffe-proto.js / tf-proto.js are similar schema definitions
	- protobuf.js: core library used to parse the raw byte streams into objects **using the schemas mentioned above**

#### 4. Tools and Scripts
- tools/ directory: utility scripts used by mainters to **fetch the latest .proto files from official repositores and compile them into -proto.js files*


### References