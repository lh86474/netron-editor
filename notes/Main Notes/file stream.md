2026-06-11

Tags: [[other questions in cs]]
## file stream

### Notes

A way to read or write a file piece-by-piece (in chunks) rather than loading the entire file into the computer memory RAM all at once
- AS I watch a video, I stream the video, I don't wait to download it before hitting play

In Netron
fetch() method, the application checks the size of file before opening it
- If small, reads it normally using fs.readFile
### References