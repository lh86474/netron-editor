2026-06-11

Tags: [[other questions in cs]]
## why is JSON so important in the web

### Notes

- Undisputed standard web data transfer for a few very practical reasons
	- A lightweight, universal translator between the client (browser) and the server
JSON is derived rom JavaScript: native lanaguge of web browsers
- We don't need a custom parser. 
- A highly optimized command JSON.parse() converts the text stream into a Javascript object in memory

before, web relied on XML
- JSON no formatting overhead, simple syntax. 
- Smaller payload sizes
- Faster loading times over HTTP

Every major backend programming language has standard optimized libs to read and write JSON
### References