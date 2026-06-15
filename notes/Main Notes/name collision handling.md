2026-06-11

Tags: [[ambarella]] [[netron]]
## name collision handling

### Notes

- If both models use same name: we don't really have namespace between two graphs, just between stuff like values, name, etc. 
- renames bottom-graph names so they don't clash with the top graph before I splice the two together

We will automatically prefix bottom with bottom_

auto-fix, we don't block

Top name is authoritative, we go along with top name



### References