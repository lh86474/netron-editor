2026-06-10

Tags: [[other questions in cs]]
## what does it mean to sort topologically

### Notes

**Organize a list of tasks or items based on their strict dependencies**

- Task A must be completed before B. 

A topological sort guarantees that A will always appear before B in the final ordering

### Technical def in a DAG (directed acyclic graph)
- Find the nodes with no arrows, add it to the end of our sorted list
- delete those nodes
- look for next node that now has no incoming arrows, repeat process until graph is empty

Many correct answers in top sort

### Package managers
- When we install something via npm or pip
	- System uses topological sorting to figure out exactly which background libraries it needs to download first before it can install my requested program
- Task scheduling
	- CI/CD, assembly lines, PM software
- Spreadsheet formulas
	- Change value: software does a top sort of all of the formulas to figure out which cells need to be updated first so that no cell uses outdated match

### References