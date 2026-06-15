2026-06-10

Tags: [[onnx]] [[ambarella]]
## components of ONNX

### Notes

ONNX is an open specification that consists of the following components:

1. A definition of an extensible computation graph model.
    
2. Definitions of standard data types.
    
3. Definitions of built-in operators.

One and two make up the ONNX IR. 


"Extensible computation graph model"
- In AI and ML, NNs are not written in code, but represented a graph (a web or flowchart)
	- nodes are the mathematical ops
	- edges represent the data flowing from one operation to the next
- Extensible: **the system is designed to grow**
	- ONNX is built so developers can extend it by adding custom nodes or operators without breaking the standard

### Standard data types
- Data flows in the **form of Tensors**
- Define exactly what kind of values are allowed to exist in the Tensors

Tensors are 99% of data moving through ONNX. Sequences, Maps are also defined

