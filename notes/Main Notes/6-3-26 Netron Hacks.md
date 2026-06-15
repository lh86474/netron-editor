2026-06-02

Tags: 
## 6-3-26 Netron Hacks

### Notes

Good at displaying simple models, but when we come up to something more involved and have difference in durations in machine learning models: hard model to read


### Alter CSS or JavaScript logic to hardcode color changes for specific node types (e.g., rendering a layer in neon pink).

I will change the node colors into neon pink

##### New code
- Each node-item-type describes that type of node it is. There is a separate color for all of them. 
- Since I just wanted to change the Relu, I just changed the type for the activation function (since Relu) is an activation function
- This changes the color for all of the activation functions. 
- But the problem is, if I wanted to change the color just for the Relu node, I would have to 
```
.node-item-type-layer path { fill: rgb(51, 85, 136); }
.node-item-type-activation path { fill: rgb(255, 40, 148 ); }
.node-item-type-pool path { fill: rgb(51, 85, 51); }
.node-item-type-normalization path { fill: rgb(51, 85, 68); }
.node-item-type-dropout path { fill: rgb(69, 71, 112); }
.node-item-type-shape path { fill: rgb(108, 79, 71); }
.node-item-type-tensor path { fill: rgb(89, 66, 59); }
.node-item-type-transform path { fill: rgb(51, 85, 68); }
.node-item-type-data path { fill: rgb(85, 85, 85); }
.node-item-type-qtization path { fill: rgb(80, 40, 0); }
.node-item-type-attention path { fill: rgb(120, 60, 0); }
```

Modification -> can change color
- Pre-defined color is fine too
- Be able to tell the changes vs original

Netron -> editing tool
- Can look at other tools other than Netron

GUI has some dynamic behavior: enhance the behavior



![[Pasted image 20260603144849.png]]

### Intercept the parsed ONNX data to append custom strings (like "- HACKED") to node labels before they render.


- Appended custom strings to the node labels before they render
- This is done all in the view.js. 
- This is done in view.Node, view.Input, view.Output. 
- The content within the classes are the labels, and I just appended the string to it

![[Pasted image 20260603151846.png]]


- Document how I set up Netron
- Document each and every step
### References