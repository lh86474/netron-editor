2026-06-09

Tags: [[javascript]]
## why agents code javascript easier

### Notes

AI agents are powered by LLMs (large language models)

JavaScript **is the most widely used programming language in the world and powers the entire web, a lot of JavaScript has to be in the training data of these models**
- Agents has seen millions of examples of how JS is structured

Ai agents are really good at reading, generating, and manipulating JSON data. If it wants to builda feature: working with internal js objects is much easier for the agent than trying to parse raw binary files

### Javascript is an interpreted language
- C++ and Rust require code to be compiled before it can e run
- If an agent makes a mistake: it has to read compiler errors, fix them, recompile, and try again
- An agent can write a piece of JS to add a feature to Netron and execute it immediately in Node.js or a web browser. 

Compiled langauge: translate into machine code before execution

Interpreted language rely on an interpreter that reads and executes code line-by-line at runtime
There are many hybrid approaches, like JavaScript V8, Java, CPython
### References