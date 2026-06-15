2026-06-01

Tags: [[ambarella]] [[machine learning]][[onnx]]

## what is onnx

### Notes

If I write an essay in Microsoft Words, someone else might not be able to open if it they only have Apple Pages or Google Docs
- To solve this, I can **save the document as a PDF**
- A PDF is universal

ONNX does the same thing, but forML
- Developers have stuff like PyTorch, TensorFlow, Scikit-Learn, and ONNX is a universal translator

### How ONNX Models are built
- Instead of sentences and graphs, an ONNX file is made of mathematical operations

### Core components
1. Input and Outputs
	1. The data I feed in
	2. The final prediction it spits out
2. Nodes (Operators)
	1. If I need to do something like add 2 numbers together, I get an add node operator
	2. ONNX has a big dictionary of those operators
3. Initializers
	1. Constant, fixed rules of the model that were learned during its training
	2. Once converted to ONNX, numbers are frozen in place and don't change

### References