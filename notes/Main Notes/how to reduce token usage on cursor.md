2026-06-09

Tags: [[cursor]]
## how to reduce token usage on cursor

### Notes

### Token cost Ranking
1. Ask Mode (Cheapest, Best Default)
	1. Minimal context
	2. Single-turn responses
	3. no project-wide scaning
	4. Good for understanding code, "why" questions, getting suggestions without auto-editing
2. Inline Edits
	1. Good for writing functions, refactoring small blocks, fixing obvious issues
	2. Only current file is sent
	3. no global project understanding **most cost effective way to write code inc ursor**
3. Debug mode (balanced)
	1. Good for error message, rntime bugs, logic issues
	2. **Slightly more context**, some reasoning steps
4. **Plan Mode (Use Sparingly)**
	1. Designing solutions, architectural decisions, breaking down tasks
	2. Longer responses, broader context, multi-step reasoning
5. **gent mode (Most Expensive)**
	1. Good for large refactors, multi-step automation
	2. "Do everything for me" tasks
	3. Multiple model calls
	4. repeated context injection
	5. file scanning and retries
		1. One agent run can cost more than 20 ask questions combined
### Scope everything
"Review this project and optimize it" bad!

Good
"Only analyze src/utils/date.ts.
do not scan other files
suggest improvements in under 50 lines"

- Less context = fewer tokens. 

### Workflow

Ask -> Ask -> Inlnie -> Debug
- Costs 0.3 - 0.8 dollars

Ex.
1. Ask: "What's wrong with this logic?"
2. Ask: "What's the cleanest fix?"
3. Inline: Apply the change
4. Debug: verify edge cases

### Default to Auto model
- Avoid agent unless it saves real time
- Keep only 1-3 files open
- Never ask for entire project analysis
- Check usage once per day
### References