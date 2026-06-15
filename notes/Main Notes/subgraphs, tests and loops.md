2026-06-02

Tags: [[ambarella]] [[onnx]] [[machine learning]]
## subgraphs, tests and loops

### Notes
![[Pasted image 20260602102453.png]]
- What's going on here?
Two input boxes
- ReduceSum: add up all numbers inside each tensor to get a single total sum for x2
- greater node: take two sums and compares them
- Boolean Output %0: Output a simple true or false based on comparison

If_If
- Is special **because contains entirely separate minigraphs, subgraphs in it**

```
if sum(x2) > sum(x1):
	y = x2 + x1
else:
	y = x2 - x1
return y
```
### References