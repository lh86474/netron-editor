2026-06-15

Tags: [[netron]] [[ambarella]]
## documenting merge tests

### Notes
1. I'm going to extract subgraphs from an existing graph and will try to merge it together

float32[1,3,224,224]
- Input for squeezenet, I need to find something that has the same type

[[bug with exporting modified graph, is empty]]
squeeze1x1_1

![[Pasted image 20260615143103.png]]

![[Pasted image 20260615120704.png]]
- have to make sure output has tensor, or else this will not work

![[Pasted image 20260615122714.png]]
merge export works
merge upload works
### References
