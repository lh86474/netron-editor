2026-06-11

Tags: [[onnx]] [[ambarella]]
## onnx pickle models

### Notes

### Pickle is.
- Python's native, built-in way of serializing data
- When I "pickle" a Python object: take live structure in my computer's RAM and flatten it into a raw byte stream
	- .pkl, .pt
- When I train a standard PyTorch or Sci-kit-Learn and hit "save"
	- Almost always generating a Pickle file
	- But, massive flaws
	- Locked to Python
	- Set of instructions for the Python interpreter to reconstruct an object
- Massive security risk: doesn't just store data, it can store code execution instructions
	- If I download a random .pkl file from the internet and unpickle it, it can silently execute malicious code on your computer


### References