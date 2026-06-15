2026-06-09

Tags: [[javascript]]
## shift operators in JavaScript

### Notes

```
(value >>> 0)

Convert any value into 32-bit unsigned integer
Unsigned Right Shift

When we do any bitwise operator, the engine does a hidden step: it converts the value into a 32-bit integer

We shift by 0 positions, so we effectively to make the internal conversion process

Decimals are truncated, negative numbers wrap around, falsy or invalid math turns to 0
```
### References