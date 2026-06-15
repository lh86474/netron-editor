2026-06-02

Tags: [[ambarella]] [[onnx]]
## input, output, nodes, initializer, attributes
[ONNX Concepts - ONNX 1.22.0 documentation](https://onnx.ai/onnx/intro/concepts.html)
### Notes

### What are ONNX Operators
[ONNX Operators - ONNX 1.22.0 documentation](https://onnx.ai/onnx/operators/index.html#l-onnx-operators)


#### What we mean by building an ONNX graph is 
- Implementing a function with the ONNX language, or more precisely with ONNX operators


### For example
```
Input: float[M,K] x, float[K,N] a, float[N] c
Output: float[M, N] y

r = onnx.MatMul(x, a)
y = onnx.Add(r, c)

The float[M, K] and float[K, N] describe the data type and the shape (dimensions) of the input tensors(matrices) x and a

float means that the numbers inside the matrix are floating-point numbers

[Rows, Columns]
The letters denote the dimensions of a 2-dimensionsl matrix. ONNX graphs are often built to handle variable sizes, so they use variables like M, K, and N

M typically represents the batch size (number of data samples or rows I'm processing)

K represent number of input features (number of variables each sample has)

float [M, K] this is data input matrix

float [K, N] This is y weight matrix

N represent the number of output features (number of predictions the model is making per sample)
```

```
Input: float[M,K] x, float[K,N] a, float[N] c
Output: float[M, N] y

r = onnx.MatMul(x, a)
y = onnx.Add(r, c)
```

Here, x, a, c are the inputs
y is the output
r is the immediate result
*MatMul and Add are the nodes*

### Initializer
- When an input never changes, like coefficients of linear regression, we should turn it into a constant stored in the graph
- The initializer: constant tensor where actual values are saved directly inside the model file

```
Input: float[M,K] x
Initializer: float[K,N] a, float[N] c
Output: float[M, N] xac

xa = onnx.MatMul(x, a)
xac = onnx.Add(xa, c)
```
Here, a and c are the model's internal, fixed parameters
- ONNX runtime knows to load these matrices straight from the saved .onnx file. 

#### Visual representation

![[Pasted image 20260602100204.png]]

The X **is the global input node of the entire model**
The Y is the **global output node of the entire model**

The ? x ? means the dimension is dynamic or unknown at the time of the viewing. 

```
What's with the B<1>

It tell s us aboutthe initializers attached to those operations. 
In ONNX, mathematical operators usually have standard names for their inputs
Add operator takes two inputs: A and B
```

The node properties on the right side of my screenshot show that input A is named multiplied: dynamic data from our MatMul node

Input B is named intercept
- It's flagged as an initializer
The
```
<1> is a shorthand visual indicator of the shape. Input B is attached here and it is a 1-dimensional tensor with 1 element. 

The -0.00001239776611328125 is the exact stored value
```
### Connecting visualization to code
```
Input: float[M, K] x
- The topmost oval labeled X represents this
  entry point of data. The ? x ? perfectly matches float[M, K}. Question marks indicate that the exact integer values for M and K are dynamic]
  
  The B<1> tag (in second node) represents our c. confirms that a pre-saved constant parameter is being injected
  
  What is B<1>  in matmul then
  - 
```