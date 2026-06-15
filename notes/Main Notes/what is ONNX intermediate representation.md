2026-06-10

Tags: [[ambarella]] [[onnx]]
## what is ONNX intermediate representation

### Notes

In the AI world, there are two distinct phases
1. Training: researchers build and teach the model using frameworks like Pytorch, TF, JAX
2. Deployment: finished model is actually run on something like Nvidia gpu, intel processor, iphone neural engine, etc. 

Issue: there are too many frameworks and hardware chips
- If we have 10 frameworks and 10 chips, we need 100 translators so everything could communicate to everything else

### Solution: The Intermediate Representation
- Neutral, middle-ground format. 
- Standardized to write down the AI's graph so that it is not tied to the software that created it

Everyone agrees on ONNX IR. 

Pytorch translates to ONNX IR
Apple reads the ONNX IR and translate it to a chip

If we have 10 frameworks and 10 chips, we only need 20 translators, one for everything


### ONNX is  like the PDF of AI
### References