2026-06-08

- [ ] Tags: [[ambarella]] [[cursor]]
## cursor best practices

### Notes

### Agent Harness
Agent harness: operational software layer that wraps around an AI model to **manage its tools, memory state, and safety protocols**
- Governs how and where the agent operates, like a runtime environment

#### Three components
1. Instructions: system prompt and rules that guide agent behavior
2. Tools: File editing, codebase search, terminal execution
3. Model: Agent model I pick for the task

Different models **respond differently to the same prompts**
- Ex. models trained heavily on shell-oriented workflows might prefer grep over a dedicated search tool. Another might need explicit isntructions to linter tools. 

## Start with plans
- Planning before coding. 

**Do this by toggling plan mode**
- Instead of immediately writing code, the agent will

1. Research codebase to find relevant files
2. Ask clarifying questions about my requirements
3. Create a detailed implementation plan with file paths and code references
4. wait for approval before building


### Starting over
- Revert changes, refine the plan to be more specific about what I need, run it again
- Faster than fixing an in-progress agent, produces cleaner results. 

### Managing context
- My job is to give each agent the context ie **needs to complete its task**

## Let the agent find the context
- It uses semantic search, so it doesn't need to find the exact words

Keep it simple: don't get the agent to find irrelevant files. ''

### When to start a new convo
- If I'm moving to a different task or feature
- Agent seems to be confused or keeps making the same mistakes
- finished one logical unit of work

### Continue the convo if
- Iterating on same feature
- agent needs context from earlier in the discussion
- debugging something it just built

**Long conversations can cause the agent to lose focus**

## Reference past work
- Use @Past Chats to reference previous works. It can pull in only the context it needs. 

## Extending the agent

#### Rules: Static context for your project
- Create rules in markdown files in .cursor/rules/
- Keep it focused on the essentials, like what commands to run, patterns to follow, and pointers to canonical examples in codebase.
- Reference files instead of copying contents
- short = prevent from becoming stale as code changes
- Don't document every possible command
- Don't add instructions for rare edge cases

#### Skills: Dynamic capabilities and workflows
- Defined in SKILL.md files and can include
- Custom commands: Reusable workflows triggered with / in the agent input
- Hooks: scripts that run before or after agent actions
- Domain knowledge: instructions for specific tasks the agent can pull in on demand. 
- Skills are only loaded dynamically when the agent decides that they're relevant

## Using images
- Can process images directly from prompts

### Design to code
- I can give a mockup and ask the agent to implement it
- sees the agent and can match layouts, colors, and spacing
	- Can use the Figma MCP server
#### Visual debugging
- screenshot error state or unexpected UI and ask the agent to investigate
- Faster than describing the problem in words
- Agents can also control a browser to take its own screenshots

### Common workflows

#### Test-driven development
- Write code, run tests, and iterate automatically
	- Can write tests based on expect I/O pairs
	- Be explicit
	- Tell agent to run the tests and confirm if they fail: say not to write implementation cde at this stage
	- commit test when I'm satisfied
- Ask agent to write code that passes the tests. Don't modify tests: keep iterating until all tests pass
- Commit implementation

### Agents perform best when they have a clear target to iterate against. 

## Reviewing code
### Review during generation
- I watch the agent work: diff view shows changes as they happen
	- If agent messing up: click top to cancel and redirect
#### Agent review
- Click review -> finds issues to run a dedicated review pass
	- Analyzes proposed edits line-by-line and flags potential problems

![[Pasted image 20260608093623.png|285]]


#### Architecture diagrams
- For big changes, ask the agent to generate architecture diagrams
- "Create a Mermaid diagram showing the data flow for our authentication system, including OAuth providers, session management, and token refresh"
	- Useful for docs and can reveal architectural issues before review
### Agents in parallel
- Having many models attempt the same problem and picking the best result **significantly improves the final output, especially for harder tasks**

### Run multiple models at once
- select multiple models from dropdown, submit prompt, and compare results side by side: cursor will suggest which solution it believes is best

## Debug mode
- Best for bugs you can reproduce but can't figure out
- race conditions and timing issues
- performance problems and memory leaks
- regressions where something used towork

### Best practices

**They write specific prompts.** The agent's success rate improves significantly with specific instructions. Compare "add tests for auth.ts" with "Write a test case for auth.ts covering the logout edge case, using the patterns in `__tests__/` and avoiding mocks."

**They iterate on their setup.** Start simple. Add rules only when you notice the agent making the same mistake repeatedly. Add commands only after you've figured out a workflow you want to repeat. Don't over-optimize before you understand your patterns.

**They review carefully.** AI-generated code can look right while being subtly wrong. Read the diffs and carefully review. The faster the agent works, the more important your review process becomes.

**They provide verifiable goals.** Agents can't fix what they don't know about. Use typed languages, configure linters, and write tests. Give the agent clear signals for whether changes are correct.

**They treat agents as capable collaborators.** Ask for plans. Request explanations. Push back on approaches you don't like.

### References
[Best practices for coding with agents · Cursor](https://cursor.com/blog/agent-best-practices)