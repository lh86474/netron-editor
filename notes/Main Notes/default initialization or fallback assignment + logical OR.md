2026-06-09

Tags: [[javascript]]
## default initialization or fallback assignment

### Notes

                graph.value_info = graph.value_info || [];

- This line is confusing lol
- Set graph.value_info to whatever it currently is. But if it doesn't exist yet, set it to an empty array

### The logical OR operator
- Doesn't just return true or false: returns actual value of one of its sides based on if the left side is "truthy" or "falsy"
- 

### References