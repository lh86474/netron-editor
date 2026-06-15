2026-06-08

Tags: [[ambarella]] [[netron]] [[6-8-26 + documentation of changes]]
## what is delta

### Notes

Delta means **change or difference**. Think about the greek delta symbol
- It's the exact difference between the original, locked blueprint and my new, editable copy

### Delta State: Notepad that keeps track of my current session

### Delta Record: single, specific line in the delta state

- delta record is the smallest atomic unit of change. 
- Edit UI: system generates a strict, highly organized package of data to describe what just happened

## How netron uses delta records (delta-tracker.js)
- Every delta record explicitly the oldValue (original state) and the new state, so making an undo button later on is easy. 

#### Scalar equal
-  it's a special function to check if something like two numbers are equal to each other

#### Deep equal
- We need these because Netron models have deeply nested arrays like arrays of numbers, strings, objects, and JavaScript BigInts, which can cause crashes 
	- DeepEqual dives all the way into those arrays

### The core delta tracker in Netron

export class DeltraTracker
```
constructor(originalSnapshot)
```
- Takes a snapshot of the original, untouched model. 
	- Sets up a blank Map to hold my ongoing edits

```
this._original: snapshot of untouched model
this._changes: blank map to hold ongoing edits
this._listeners: list of Ui elements waiting to hear about updates
```

```
_snapshotKey(change)
- A node might have base properties like name or type
  prevent a name edit from overwriting the entire node's identity in the snapshot. Create a unique sub-key
```

### record(change)
- When an edit comes in from the sidebar, it runs through a strict logic tree
	- ghost check: delete something that didn't exist: tracker just erases the record entirely. It never happened
	- Brand new check: if added something that wasn't in original, it tags it safely as add
	- revert check: uses deepEqual to check new value against snapshot
	- standard edit: **saves the newValue**, but also saves oldValue so I can refer back to it
```
this._emit() "ehy, something changed"
```

getAggregateState(parentId)
- makes Visual rendering possible
- If edit a tiny, hidden attribute inside a node, getState for the node itself would say "unchanged" 
- Looks at node, then look at children
- If any child was modified or deleted, function bubbles that status up and declares the whole parent node as 'modified'


### References
