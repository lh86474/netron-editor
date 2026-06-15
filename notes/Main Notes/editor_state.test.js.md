2026-06-08

Tags: [[ambarella]] [[netron]] [[6-8-26 + documentation of changes]]
## editor_state.test.js

### Notes

This code appears to be a suite of unit tests written in JavaScript using Node.js's built-in testing framework (node:test). The tests are designed to verify the functionality of a ModelEditor class, which seems to be responsible for manipulating and tracking changes to a model, likely related to machine learning models given the context of ONNX and attributes like kernelshape and strides.

Here's a breakdown of what each describe block and its it tests are doing:

describe('EditorState', () => { ... });

This block focuses on testing the ModelEditor class's ability to manage the state of a model, including cloning, applying changes (patches), and tracking those changes in a delta.

   it('clone produces independent ModelModified', () => { ... });: Tests that cloning a model creates a completely separate, modified version. Changes to the cloned version do not affect the original.
   
   it('clone preserves graph topology and shared value identity', () => { ... });: Verifies that when a model is cloned, the structure of its graph (nodes and their connections) and any shared value references are maintained correctly.
   
   it('atomic patch adds attribute and records delta', () => { ... });: Tests the applyPatch method for adding a new attribute to a node. It checks if the attribute is added to the modified model and if this change is recorded in the delta object.
   
   it('delta object identifies added property', () => { ... });: Specifically checks the structure and content of a delta record when a new property (attribute) is added.
   
   it('getState and getAggregateState reflect child changes', () => { ... });: Tests how the delta object tracks the state of individual entities (like attributes) and aggregates the state for parent entities (like nodes).
   
   it('revert to original clears delta', () => { ... });: Simulates modifying an attribute and then "reverting" it by applying the original value again. It asserts that this should clear the recorded delta for that change.
   it('modify existing attribute records correct oldValue', () => { ... });: Tests the modification of an existing attribute. It ensures that the delta correctly records both the oldValue and the newValue.
   it('delete attribute records delta and removes from model', () => { ... });: Tests the deletion of an attribute. It checks if the attribute is removed from the model and if the deletion is recorded in the delta.
   it('delete added attribute clears delta', () => { ... });: Tests the scenario where an attribute is first added and then immediately deleted. It asserts that this should result in no net change and an empty delta.
   it('modify value name records delta', () => { ... });: Tests modifying the name property of a "value" entity within the model, ensuring the change and its old/new values are recorded in the delta.
   it('structural IDs survive display-name edits', () => { ... });: Verifies that changing a node's display name does not affect its underlying structural identifier, and that this change is correctly logged.

describe('ModelAdapter', () => { ... });

This block tests the ModelAdapter component, which likely handles the conversion or adaptation of different model formats (like ONNX) into an editable internal representation.

   it('clones onnx-shaped graph with preserved topology', () => { ... });: Tests cloning an ONNX-shaped model, ensuring the graph structure is maintained.
   it('normalizes array-valued arguments for view-layer contract', () => { ... });: Checks if array-valued arguments are normalized into a consistent format suitable for the view layer.
   it('preserves shared value identity across array-valued arguments', () => { ... });: Verifies that when array-valued arguments share a common underlying value, this identity is preserved after cloning.
   it('reads getter-based fields into plain editable properties', () => { ... });: Tests that properties defined as getters in the original model structure are correctly read and exposed as plain, editable properties in the adapter's representation.
   it('preserves attribute visibility when cloning', () => { ... });: Ensures that the visible property of attributes is correctly cloned, even if it's false.
   it('normalizes BigInt attribute values for editing', () => { ... });: Tests how the adapter handles BigInt values for attributes, ensuring they are normalized to regular numbers for editing and that applying the same value again doesn't create a delta.
   it('preserves operator attribute schema on clone', () => { ... });: Checks that the schema information for operator attributes (like type and default values) is preserved when the model is cloned.
   it('handles optional empty argument values', () => { ... });: Tests the adapter's ability to correctly handle nodes with optional empty input or output arguments.

describe('BrowserSafety', () => { ... });

This block tests the browser compatibility of the editor modules.

   it('editor modules are browser-safe to import', async () => { ... });: Reads the source code of specific editor modules and asserts that they do not contain any node: imports, indicating they are safe to use in a browser environment.