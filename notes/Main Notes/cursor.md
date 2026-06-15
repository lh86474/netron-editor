2026-06-02

Tags: [[ambarella]] [[AI agents]]

## cursor

Joseph Yang
[[cursor best practices]]
[[how to reduce token usage on cursor]]


### Notes
### Plan Mode

RAG search: common practice in AI engineering
- Grab all context, search through, like table of contents, grab relevant parts
- Converting to markdown might be token intensive 

Plan mode: prompt engineering enhancer: input one or two sentences: have models align with me, exploratory research, came up with a beautiful spec doc with 5 to-dos

Validation: Like to have tests, how do we know if code is working: I want validation. 

What are spec docs: formal structured documents that define the requirements, design, and implementation plan for a product, feature, or system. 
- Product goals into technical requirements
	- scope and goals
	- functional requirements

Joseph now spend 80-90 percent of his time reading spec doc 

10-20 percent time with actually building and writing code

It used to be flipped

### Choosing models
- Pricing chosen by the model producers
- for audits, chose GPT-5.5
- Opus 4.8 to help us draft out plan: prompt enhancer. Put in one sentence, went ahead and gave a very detailed spec doc. 
- Chose GPT-5.5 for audit the plan before he starts building

#### MAX Mode
- The context window can go to 1 million
	- Usually, it's 272K
	- span of text, measured in tokens, that the model can process at one time
- It's enabling the extra mileage for the frontier models. 


Frontier models: general-purpose AI system trained at extreme computational scales: exceeding 10^25 FLOPS
- FLOP: floating point operations per second: how many arithmetic operations a computer can perform on floating-point numbers in one second

#### Multi-agent debate
- Helps us find gaps, points that we need to fix up. 

### Start building
- Save time
- Save on tokens
	- Because we have a detailed plan: know what are the exact steps to follow
	- near-frontier model will be able to do the work
- Hit the build button, trigger to composer 2.5 fast
	- Used this because plan is already pretty good

### How does cursor use cursor
- Model selection is very important
- Model-neutral platform
	- Get to have all of the best models in their fingertips
- 

### Top frontier Models
1. GPT-5.5
2. Claude 4.7 Opus
3. Composer-2, best spend efficiency, good for building

Terminal Bench score ability to autonomously perform real-world terminal tasks
error-recovery. 
Gemini 5.5 is the top model, 82.7


### References