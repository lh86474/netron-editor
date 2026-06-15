2026-06-15

Tags: [[javascript]]
## sets in javascript

### Notes

It's a built-in object that lets us store a collection of **strictly unique values**
- I can put in any type of data into a Set, like primitive values or complex objects, but never duplicates. 
- If I try to add a duplicate, I will get ignored lol

new Set() new set
.add(value) add a new item
.has(value) returns true if in, false if not. Much faster than Array's .includes() method
.delete(value) removes a specific iem
.size: property that tells us how many items are in the set
### References