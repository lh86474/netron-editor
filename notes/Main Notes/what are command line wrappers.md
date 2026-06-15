2026-06-10

Tags: [[other questions in cs]]
## what are command line wrappers

### Notes

### What is a wrapper
- It's a piece of code that is written to **surround or wrap another underlying program or library**
- We translate or simplify the way a user (or another program) interacts with that underlying system
command-line wrapper: script or program that allows you to interact with a complex piece of software by typing **commands into a terminal**

A [tool](https://github.com/onnx/onnx/blob/main/onnx/checker.py) is available to perform general validation of models against this specification. It is implemented in C++ with a Python command-line wrapper.
- The engine (C++) is the **actual logic** for validating the ONNX models. 
- Python controls the interface

for example, we could do

```
python validate_onnx.py my_model.onnx
```


### References