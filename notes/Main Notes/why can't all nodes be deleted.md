2026-06-16

Tags: [[netron]] [[ambarella]]
## why can't all nodes be deleted

### Notes

![[Pasted image 20260616094940.png]]

It looks like one arrow in, one arrow out. 
But, conv has multiple input arguments
1. Is has the weight filter, bias, activation tensor

We have the activation tensor (the actual connection)
weight filter (It's the W<16x64x1x1) thing
B is the bias

![[Pasted image 20260616095020.png]]

![[Pasted image 20260616095211.png]]

- Relu has two consumers. Delete is allowed, but the deletion looks awkward

