/* This file contains extensive testing for the ModelEditor class, essentially just the editing features
 * This file is divided into six sections
 * EditorState: making sure delta is tracking changes, our changes are being applied, and that we have a deep copy of the model
 * Node insertion: insert above and below using patches. changeType is 'add' property: 'insert'
 * Node deletion: delete and rewiring the graph. We also find danglingnodes and warn the user about unsafe deletions
 * Value properties: custom attributes on tensor values. 
 * ModelAdapter: BigInt normalization, getter fields, schema preservation
 * BrowserSafety: read source files and regex-checks for node: imports. 
 * Author: Luray He
 */
// node tester module
import { describe, it } from 'node:test';
// assertions for equalities
import assert from 'node:assert/strict';
// for reading files and async and await
import * as fs from 'node:fs/promises';
// mocked graphs and files
import { mockModel, mockChainModel, identityNodeSpec } from './fixtures/mock-graph.js';
import { onnxShapedModel } from './fixtures/onnx-shaped-mock.js';
import { ModelEditor, AttributeSchemaResolver, locateValueEntity, buildNodeFromMetadata, analyzeDeleteNode, canDeleteNode, deleteNode, findDanglingNodes, NodeDeleteError } from '../source/model-editor.js';
import { canonicalizeTensorTypeString, tensorTypeShapeDimensions, TensorTypeError } from '../source/tensor-type.js';

// makes sure that when we have the second split-view pane, we have a different model object
// the modified model is not equal to the original model, despite being structurally the same
// WE check that the attributes length are the same, but since the objects are referenced in different ways, they aren't equal
describe('EditorState', () => {
    it('clone produces independent Model_Modified', () => {
        const editor = ModelEditor.createSession(mockModel);
        const modified = editor.modified;
        modified.getGraph().nodes[0].attributes.push({ name: 'test', value: 1 });
        assert.notEqual(modified, mockModel);
        assert.equal(mockModel.modules[0].nodes[0].attributes.length, 1);
    });

    // Here, we check that the inputs and outputs are the same
    // hidden isn't a special keyword: it's just a tensor name in the test fixtures. 
    // in mock-graph.js and onnx-shaped-mock.js, it's the intermediate tensor between conv and relu
    it('clone preserves graph topology and shared value identity', () => {
        const editor = ModelEditor.createSession(mockModel);
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes.length, 2);
        assert.equal(graph.nodes[0].outputs[0].value[0].name, 'hidden');
        assert.equal(graph.nodes[1].inputs[0].value[0].name, 'hidden');
        assert.equal(graph.nodes[0].outputs[0].value[0], graph.nodes[1].inputs[0].value[0]);
    });
    // We make a mock change, where we add some node 
    // We make sure editor.delta actually tracks the change
    // This is some empty graph with one node and one attribute
    it('atomic patch adds attribute and records delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const nodeId = 'graph:0/node:1';
        const change = editor.applyPatch({
            parentId: nodeId,
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.pads',
            newValue: [1, 1, 1, 1]
        });
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes[1].attributes.length, 1);
        assert.equal(change.entityId, 'graph:0/node:1/attr:0');
        assert.equal(editor.delta.getChanges().length, 1);
    });

    // WE make sure delta object tracks the change correctly. We don't want the change 
    // to be incorrect, which would make features like undo/redo or export not work at all
    it('delta object identifies added property', () => {
        const editor = ModelEditor.createSession(mockModel);
        editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.pads',
            newValue: [1, 1, 1, 1]
        });
        const change = editor.delta.getChanges()[0];
        assert.equal(change.entityId, 'graph:0/node:1/attr:0');
        assert.equal(change.changeType, 'add');
        assert.deepEqual(change.newValue, [1, 1, 1, 1]);
    });
    // Make sure that delta tracker knows that the graph is modified
    // We also have to make sure that the graph knows that it has been added to
    it('getState and getAggregateState reflect child changes', () => {
        const editor = ModelEditor.createSession(mockModel);
        const change = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.pads',
            newValue: [1, 1, 1, 1]
        });
        assert.equal(editor.delta.getState(change.entityId), 'added');
        assert.equal(editor.delta.getAggregateState('graph:0/node:1'), 'modified');
    });

    // We fist apply some kind of change, and then we revert to the original
    // This makes sure that when we delete an attribute or modify it so it goes back to the original, 
    // the delta must be cleared
    it('revert to original clears delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const entityId = 'graph:0/node:0/attr:0';
        editor.applyPatch({
            entityId,
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.kernel_shape',
            newValue: [5, 5]
        });
        // revert
        editor.applyPatch({
            entityId,
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.kernel_shape',
            newValue: [3, 3]
        });
        assert.equal(editor.delta.getChanges().length, 0);
        assert.equal(editor.delta.getState(entityId), 'unchanged');
    });

    // The mocked graph's value is [3, 3], chck test/fixtures/mock-graph.js for more details
    // We change an attribute so it has value [5, 5]. Make sure delta object tracks the change correctly
    it('modify existing attribute records correct oldValue', () => {
        const editor = ModelEditor.createSession(mockModel);
        editor.applyPatch({
            entityId: 'graph:0/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.kernel_shape',
            newValue: [5, 5]
        });
        const change = editor.delta.getChanges()[0];
        assert.equal(change.changeType, 'modify');
        assert.deepEqual(change.oldValue, [3, 3]);
        assert.deepEqual(change.newValue, [5, 5]);
    });

    // Tests delete attribute functionality
    it('delete attribute records delta and removes from model', () => {
        const editor = ModelEditor.createSession(mockModel);
        editor.applyPatch({
            entityId: 'graph:0/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'delete',
            property: 'attributes.kernel_shape'
        });
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes[0].attributes.length, 0);
        assert.equal(editor.delta.getState('graph:0/node:0/attr:0'), 'deleted');
        assert.equal(editor.delta.getAggregateState('graph:0/node:0'), 'deleted');
    });

    // I had to fix a bug here. When I add an attribute and delete it again, the delta was not cleared
    // WE make sure that changes[] is empty and that the graph data is still the original mock graph
    it('delete added attribute clears delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const change = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.pads',
            newValue: [1, 1, 1, 1]
        });
        editor.applyPatch({
            entityId: change.entityId,
            entityType: 'attribute',
            changeType: 'delete',
            property: 'attributes.pads'
        });
        assert.equal(editor.modified.getGraph().nodes[1].attributes.length, 0);
        assert.equal(editor.delta.getChanges().length, 0);
    });
    
    // To help track changes, netron uses a lot of entity IDs. 
    // Hence, we have to locate a value entity. 
    // we modify the value name, and we have to make sure that the value.name has been changed correctly
    it('modify value name records delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        const entity = locateValueEntity(editor.modified.model, value);
        assert.ok(entity);
        editor.applyPatch({
            entityId: entity.valueId,
            entityType: 'value',
            changeType: 'modify',
            property: 'name',
            newValue: 'renamed_hidden'
        });
        assert.equal(value.name, 'renamed_hidden');
        const change = editor.delta.getChanges()[0];
        assert.equal(change.changeType, 'modify');
        assert.equal(change.oldValue, 'hidden');
        assert.equal(change.newValue, 'renamed_hidden');
    });

    it('modify value type records canonical delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        value.type = 'float32[1]';
        const entity = locateValueEntity(editor.modified.model, value);
        assert.ok(entity);
        editor.applyPatch({
            entityId: entity.valueId,
            entityType: 'value',
            changeType: 'modify',
            property: 'type',
            newValue: 'float32[1,2]'
        });
        assert.equal(value.type, 'float32[1,2]');
        const change = editor.delta.getChanges()[0];
        assert.equal(change.property, 'type');
        assert.equal(change.newValue, 'float32[1,2]');
    });

    it('rejects invalid value type on patch', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        value.type = 'float32[1]';
        const entity = locateValueEntity(editor.modified.model, value);
        assert.throws(() => editor.applyPatch({
            entityId: entity.valueId,
            entityType: 'value',
            changeType: 'modify',
            property: 'type',
            newValue: 'not_a_type'
        }), TensorTypeError);
        assert.equal(value.type, 'float32[1]');
    });

    it('structural IDs survive display-name edits', () => {
        const editor = ModelEditor.createSession(mockModel);
        const nodeId = 'graph:0/node:0';
        editor.applyPatch({
            entityId: nodeId,
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'RenamedConv'
        });
        assert.equal(editor.delta.getChanges()[0].entityId, nodeId);
        assert.equal(editor.modified.getGraph().nodes[0].name, 'RenamedConv');
    });
});
// tests for node insertions
describe('Node insertion', () => {
    // one case is inserting below the middle node
    it('insert below middle node rewires downstream consumer', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        const nodeSpec = identityNodeSpec('InsertedBelow');
        const change = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: nodeSpec
        });
        // make sure that we have the correct number of nodes. Mock graph has 3 nodes
        assert.equal(graph.nodes.length, 4);
        assert.equal(change.entityId, 'graph:0/node:2');
        assert.equal(change.changeType, 'add');
        const inserted = graph.nodes[2];
        assert.equal(inserted.name, 'InsertedBelow');
        assert.equal(inserted.inputs[0].value[0].name, 'hidden2');
        const softmax = graph.nodes[3];
        assert.notEqual(softmax.inputs[0].value[0].name, 'hidden2');
        assert.equal(softmax.inputs[0].value[0].name, inserted.outputs[0].value[0].name);
    });

    // we insert above some node
    it('insert above middle node rewires reference inputs', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        const nodeSpec = identityNodeSpec('InsertedAbove');
        editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'above',
            newValue: nodeSpec
        });
        assert.equal(graph.nodes.length, 4);
        const inserted = graph.nodes[1];
        const relu = graph.nodes[2];
        assert.equal(inserted.name, 'InsertedAbove');
        assert.equal(inserted.inputs[0].value[0].name, 'hidden1');
        assert.equal(relu.inputs[0].value[0].name, inserted.outputs[0].value[0].name);
        assert.notEqual(relu.inputs[0].value[0].name, 'hidden1');
    });
    // Make sure that when we add a node, delta correctly registers it as added
    it('inserted node is marked added in delta', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const change = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: identityNodeSpec('InsertedBelow')
        });
        assert.equal(editor.delta.getState(change.entityId), 'added');
    });

    // emit is a function that is used to track the changes. emitCount changes how many times emit is called
    // Here, we make sure the delta records both nodes when we insert two nodes
    it('second insert remaps first insert delta and records both nodes', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        let emitCount = 0;
        editor.delta.subscribe(() => {
            emitCount++;
        });
        const first = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: identityNodeSpec('InsertedFirst')
        });
        const emitsAfterFirst = emitCount;
        const second = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: identityNodeSpec('InsertedSecond')
        });
        assert.equal(graph.nodes.length, 5);
        assert.equal(first.entityId, 'graph:0/node:2');
        assert.equal(second.entityId, 'graph:0/node:2');
        assert.equal(editor.delta.getState('graph:0/node:3'), 'added');
        assert.equal(editor.delta.getState('graph:0/node:2'), 'added');
        assert.equal(emitsAfterFirst, 1);
        assert.equal(emitCount, 2);
    });
    // Tests add above and makes sure we have three nodes here
    it('remaps attribute delta when inserting above shifted node', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.applyPatch({
            parentId: 'graph:0/node:2',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.axis',
            newValue: 1
        });
        editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'above',
            newValue: identityNodeSpec('InsertedAbove')
        });
        const changes = editor.delta.getChanges();
        const attributeChange = changes.find((entry) => entry.property === 'attributes.axis');
        assert.ok(attributeChange);
        assert.equal(attributeChange.entityId, 'graph:0/node:3/attr:0');
    });

    // We make sure that when we start building up a node, such as from cloning, we can build it fine through metadata
    it('buildNodeFromMetadata creates node with schema IO names', () => {
        const editor = ModelEditor.createSession(mockModel);
        const graph = editor.modified.getGraph();
        const node = buildNodeFromMetadata({
            name: 'Relu',
            module: 'ai.onnx',
            version: 6,
            inputs: [{ name: 'X' }],
            outputs: [{ name: 'Y' }],
            min_input: 1,
            min_output: 1,
            attributes: []
        }, 'InsertedRelu', graph);
        assert.equal(node.name, 'InsertedRelu');
        assert.equal(node.type.name, 'Relu');
        assert.equal(node.inputs[0].name, 'X');
        assert.equal(node.outputs[0].name, 'Y');
    });
});

// Tests for node deletions
describe('Node deletion', () => {
    // The node below the middle node should be the outputs from the middle node's input
    // mock chainmodel is in test/fixtures/mock-graph.js
    // the softmax input becomes conv output tensor name
    it('delete middle node rewires downstream consumer', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        const change = editor.applyPatch({
            entityId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'delete',
            property: 'remove'
        });
        assert.equal(graph.nodes.length, 2);
        assert.equal(change.changeType, 'delete');
        assert.equal(change.entityId, 'graph:0/node:1');
        const softmax = graph.nodes[1];
        assert.equal(softmax.name, 'Softmax1');
        // the softmax input becomes conv output tensor name
        assert.equal(softmax.inputs[0].value[0].name, 'hidden1');
        assert.notEqual(softmax.inputs[0].value[0].name, 'hidden2');
    });
    // We make sure we track the state is deleted
    it('deleted original node is marked deleted in delta', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.applyPatch({
            entityId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'delete',
            property: 'remove'
        });
        assert.equal(editor.delta.getState('graph:0/node:1'), 'deleted');
    });

    // We have an inserted node. We have to make sure that Topology is restored and delta entry is cleared
    it('delete inserted node clears delta entry', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        const graph = editor.modified.getGraph();
        const insertChange = editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: identityNodeSpec('InsertedBelow')
        });
        assert.equal(editor.delta.getState(insertChange.entityId), 'added');
        editor.applyPatch({
            entityId: insertChange.entityId,
            entityType: 'node',
            changeType: 'delete',
            property: 'remove'
        });
        assert.equal(graph.nodes.length, 3);
        assert.equal(editor.delta.getState(insertChange.entityId), 'unchanged');
        assert.equal(editor.delta.getChanges().some((entry) => entry.entityId === insertChange.entityId), false);
    });

    // We add an attribute to the third node, and then we remove the second node. When we rewire, the added attributes should still be there
    it('delete remaps attribute delta on shifted nodes', () => {
        const editor = ModelEditor.createSession(mockChainModel);
        editor.applyPatch({
            parentId: 'graph:0/node:2',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.axis',
            newValue: 1
        });
        editor.applyPatch({
            entityId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'delete',
            property: 'remove'
        });
        const attributeChange = editor.delta.getChanges().find((entry) => entry.property === 'attributes.axis');
        assert.ok(attributeChange);
        assert.equal(attributeChange.entityId, 'graph:0/node:1/attr:0');
    });

    // If there is a node with zero data inputs, we need to reject it
    it('canDeleteNode rejects node without data inputs', () => {
        const graph = {
            nodes: [{
                name: 'Source',
                inputs: [],
                outputs: [{ name: 'Y', value: [{ name: 'out' }] }]
            }]
        };
        const check = canDeleteNode(graph, graph.nodes[0]);
        assert.equal(check.ok, false);
        assert.match(check.reason, /data inputs/i);
    });

    // we allow nodes with weight and bias inputs to be deleted, which is an issue since those 
    // nodes structurally have 3 inputs, so the rewiring of the inputs and outputs is ambiguous since most of the time, these
    // nodes will have just one output, so the weight and bias will be gone. 
    // We make sure that this is allowed to happen if the user allows it, and we through a warning to the user in the confirmation dialog
    it('analyzeDeleteNode allows conv with weight inputs', () => {
        const activation = { name: 'act', attributes: [] };
        const weight = { name: 'W', initializer: true, attributes: [] };
        const graph = {
            nodes: [{
                name: 'Conv1',
                inputs: [
                    { name: 'X', value: [activation] },
                    { name: 'W', value: [weight] }
                ],
                outputs: [{ name: 'Y', value: [{ name: 'conv_out', attributes: [] }] }]
            }, {
                name: 'Relu1',
                inputs: [{ name: 'X', value: [{ name: 'conv_out', attributes: [] }] }],
                outputs: [{ name: 'Y', value: [{ name: 'relu_out', attributes: [] }] }]
            }]
        };
        graph.nodes[1].inputs[0].value[0] = graph.nodes[0].outputs[0].value[0];
        const analysis = analyzeDeleteNode(graph, graph.nodes[0]);
        assert.equal(analysis.ok, true);
        assert.ok(analysis.warnings.some((entry) => entry.code === 'WEIGHTS_IGNORED'));
        deleteNode(graph, 0);
        assert.equal(graph.nodes.length, 1);
        assert.equal(graph.nodes[0].inputs[0].value[0].name, 'act');
    });
    //  deleting a merge-style or merge-like node is a node where we have two node inputs and one output. 
    // That is allowed, but it's not a good idea, so we warn it since one of the inputs will not be used downstream
    // we just verify that a warning is thrown and we the user is allowed to perform this questionable action
    it('deleteNode allows merge-style bypass with warning', () => {
        const graph = {
            nodes: [{
                name: 'Bad',
                inputs: [
                    { name: 'A', value: [{ name: 'a', attributes: [] }] },
                    { name: 'B', value: [{ name: 'b', attributes: [] }] }
                ],
                outputs: [{ name: 'Y', value: [{ name: 'out', attributes: [] }] }]
            }]
        };
        const analysis = analyzeDeleteNode(graph, graph.nodes[0]);
        assert.equal(analysis.ok, true);
        assert.ok(analysis.warnings.some((entry) => entry.code === 'MERGE_NODE'));
        deleteNode(graph, 0);
        assert.equal(graph.nodes.length, 0);
    });
    // dangling nodes happen when we delete a node and it has an output that is not used downstream
    // We make sure that these are found and tracked, and they are assigned a special css styling where the node is highlighted
    it('findDanglingNodes detects unused branch output', () => {
        const shared = { name: 'kept', attributes: [] };
        const orphan = { name: 'orphan', attributes: [] };
        const graph = {
            outputs: [{ name: 'output', value: [shared] }],
            nodes: [
                {
                    name: 'Left',
                    inputs: [{ name: 'X', value: [{ name: 'in', attributes: [] }] }],
                    outputs: [{ name: 'Y', value: [shared] }]
                },
                {
                    name: 'Right',
                    inputs: [{ name: 'X', value: [{ name: 'in2', attributes: [] }] }],
                    outputs: [{ name: 'Y', value: [orphan] }]
                }
            ]
        };
        const dangling = findDanglingNodes(graph);
        assert.equal(dangling.length, 1);
        assert.equal(dangling[0].name, 'Right');
    });
});
// This section is used to test if adding properties to our nodes / connections work
describe('Value properties', () => {
    // We use the deepEqual method from model-editor.js to test if we have a deep copy of the model
    it('clone initializes value attributes', () => {
        const editor = ModelEditor.createSession(mockModel);
        const hidden = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        assert.deepEqual(hidden.attributes, [{ name: 'tag', type: 'string', value: 'intermediate' }]);
    });
    // Makes sure that when we add a property to a connection, we delta records the change as added and the attributes does get added
    it('adds a connection property and records delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        const entity = locateValueEntity(editor.modified.model, value);
        const change = editor.applyPatch({
            parentId: entity.valueId,
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.layout',
            newValue: 'NCHW'
        });
        assert.equal(value.attributes.length, 2);
        assert.equal(change.entityId, `${entity.valueId}/attr:1`);
        assert.equal(editor.delta.getState(change.entityId), 'added');
    });

    // we can modify. delta records it as updated. 
    it('modifies a connection property', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        const entity = locateValueEntity(editor.modified.model, value);
        const attributeId = `${entity.valueId}/attr:0`;
        editor.applyPatch({
            entityId: attributeId,
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.tag',
            newValue: 'updated'
        });
        assert.equal(value.attributes[0].value, 'updated');
        const change = editor.delta.getChanges()[0];
        assert.equal(change.changeType, 'modify');
        assert.equal(change.oldValue, 'intermediate');
    });
    // We can delete connecrtion properties. in the mockmodel, it just has one attribute, and when we delete it, it should be 0
    it('deletes a connection property', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        const entity = locateValueEntity(editor.modified.model, value);
        editor.applyPatch({
            entityId: `${entity.valueId}/attr:0`,
            entityType: 'attribute',
            changeType: 'delete',
            property: 'attributes.tag'
        });
        assert.equal(value.attributes.length, 0);
    });
    // we add a property and delete it, so delta should be clear
    it('delete added property clears delta', () => {
        const editor = ModelEditor.createSession(mockModel);
        const value = editor.modified.getGraph().nodes[0].outputs[0].value[0];
        const entity = locateValueEntity(editor.modified.model, value);
        const change = editor.applyPatch({
            parentId: entity.valueId,
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.layout',
            newValue: 'NCHW'
        });
        editor.applyPatch({
            entityId: change.entityId,
            entityType: 'attribute',
            changeType: 'delete',
            property: 'attributes.layout'
        });
        assert.equal(value.attributes.length, 1);
        assert.equal(editor.delta.getChanges().length, 0);
    });
    // Tensors have custom metadata. 
    // We have some names that we can't use as they will colldie with value.name. 
    // This is for export safety. It'll ruin the metadata and our model-export.js will be confused
    // This is definitely a to-do in the future: to allow name, type, and description as fields
    it('rejects reserved connection property names', () => {
        assert.equal(AttributeSchemaResolver.validateValuePropertyName({ attributes: [] }, 'name'), `Property 'name' is reserved`);
        assert.equal(AttributeSchemaResolver.validateValuePropertyName({ attributes: [] }, 'type'), `Property 'type' is reserved`);
        assert.equal(AttributeSchemaResolver.validateValuePropertyName({ attributes: [] }, 'description'), `Property 'description' is reserved`);
    });

    // NCHW stands for N: batch size, C: chanenls, H: height, W: width
    // tests whether or not we preserve shared value identity when editing properties
    it('preserves shared value identity when editing properties', () => {
        const editor = ModelEditor.createSession(mockModel);
        const graph = editor.modified.getGraph();
        const outputValue = graph.nodes[0].outputs[0].value[0];
        const inputValue = graph.nodes[1].inputs[0].value[0];
        assert.equal(outputValue, inputValue);
        const entity = locateValueEntity(editor.modified.model, outputValue);
        editor.applyPatch({
            parentId: entity.valueId,
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.layout',
            newValue: 'NCHW'
        });
        assert.equal(inputValue.attributes.length, 2);
        assert.equal(inputValue.attributes[1].value, 'NCHW');
    });

    // to normalize something is to make it consistent with the rest of the model
    // the Universal model format requires us to store metadata as attributes
    it('normalizes metadata into value attributes on clone', () => {
        const model = {
            format: 'ONNX',
            modules: [{
                name: 'main',
                inputs: [{ name: 'x', value: [{ name: 'x', metadata: [{ name: 'source', value: 'dataset' }] }] }],
                outputs: [],
                nodes: []
            }]
        };
        const editor = ModelEditor.createSession(model);
        const value = editor.modified.getGraph().inputs[0].value[0];
        assert.deepEqual(value.attributes, [{ name: 'source', type: 'string', value: 'dataset' }]);
    });
});
// This tests cloning onnx-shaped for editing
describe('ModelAdapter', () => {
    // Checks if the length of attributes in the nodes are the same as the original model
    it('clones onnx-shaped graph with preserved topology', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes.length, 3);
        assert.equal(graph.nodes[0].attributes.length, 1);
        assert.equal(graph.nodes[1].attributes.length, 0);
    });
    // Reminder that assert.ok(...) passes if the expression is truthy. 
    // We check that arg.value is an array
    // We assume that every connection slot argument stores its tensors in value as an array
    // The value of a tensor would be [], [t1], [t1, t2], etc.`
    it('normalizes array-valued arguments for view-layer contract', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const arg = editor.modified.getGraph().nodes[0].outputs[0];
        assert.ok(Array.isArray(arg.value));
        assert.equal(arg.value.length, 1);
        assert.equal(arg.value[0].name, 'hidden');
    });

    // confirms identity is preserved after normalizing arguments
    it('preserves shared value identity across array-valued arguments', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes[0].outputs[0].value[0], graph.nodes[1].inputs[0].value[0]);
    });

    // Check if Conv1 survived cloning with the right editable fields
    it('reads getter-based fields into plain editable properties', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const node = editor.modified.getGraph().nodes[0];
        assert.equal(node.name, 'Conv1');
        assert.equal(node.type.name, 'Conv');
        assert.equal(node.type.category, 'Layer');
        assert.equal(node.type.module, 'ai.onnx');
        assert.equal(node.type.version, 11);
    });
    // We make sure that the attributes are cloned correctly
    // attribute visibility is a flag on a node attribute that controls if Netron shows it in the UI
    // visible: false means that Netron marks those attributes as hidden, check in onnx.js for the logic
    // We also have to copy the visibility flag when we clone a graph
    it('preserves attribute visibility when cloning', () => {
        const model = {
            format: 'ONNX',
            modules: [{
                name: 'main',
                nodes: [{
                    name: 'Conv1',
                    type: { name: 'Conv', identifier: 'Conv' },
                    attributes: [
                        { name: 'group', type: 'int64', value: 1, visible: false },
                        { name: 'strides', type: 'int64[]', value: [2, 2] }
                    ],
                    inputs: [],
                    outputs: []
                }]
            }]
        };
        const editor = ModelEditor.createSession(model);
        const attributes = editor.modified.getGraph().nodes[0].attributes;
        assert.equal(attributes[0].visible, false);
        assert.equal(attributes[1].visible, undefined);
    });
    // bigint numbers can cause issues when we try to mix it with other types. 
    // it can cause potential loss of precision, so we need to normalize it to a regular number
    it('normalizes BigInt attribute values for editing', () => {
        const model = {
            format: 'ONNX',
            modules: [{
                name: 'main',
                nodes: [{
                    name: 'Conv1',
                    type: { name: 'Conv', identifier: 'Conv' },
                    attributes: [{ name: 'strides', type: 'int[]', value: [2n, 2n] }],
                    inputs: [],
                    outputs: []
                }]
            }]
        };
        const editor = ModelEditor.createSession(model);
        const attribute = editor.modified.getGraph().nodes[0].attributes[0];
        assert.deepEqual(attribute.value, [2, 2]);
        editor.applyPatch({
            entityId: 'graph:0/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.strides',
            newValue: [2, 2]
        });
        assert.equal(editor.delta.getChanges().length, 0);
    });

    // The attributes format has to be cloned correctly
    it('preserves operator attribute schema on clone', () => {
        const model = {
            format: 'ONNX',
            modules: [{
                name: 'main',
                nodes: [{
                    name: 'Conv1',
                    type: {
                        name: 'Conv',
                        identifier: 'Conv',
                        attributes: [
                            { name: 'group', type: 'int64', default: 1 },
                            { name: 'strides', type: 'int64[]' }
                        ]
                    },
                    attributes: [],
                    inputs: [],
                    outputs: []
                }]
            }]
        };
        const editor = ModelEditor.createSession(model);
        const nodeType = editor.modified.getGraph().nodes[0].type;
        assert.equal(nodeType.attributes.length, 2);
        assert.equal(AttributeSchemaResolver.resolveType(nodeType, 'group'), 'int64');
        assert.equal(AttributeSchemaResolver.resolveType(nodeType, 'strides'), 'int64[]');
    });

    // makes sure empty argument values is empty
    it('handles optional empty argument values', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const input = editor.modified.getGraph().nodes[2].inputs[0];
        const output = editor.modified.getGraph().nodes[2].outputs[0];
        assert.deepEqual(input.value, []);
        assert.deepEqual(output.value, []);
    });
});

// Reads delta-trakcer.js and model-editor.js and checks if they don't have import Node built-in modules
// that's where the node:/.test(source) is checking for
// If either regex matches, it means that the file is importing the Node built-in modules
// browser and electron UI don't run with Node built-in modules. 
// The app will break if we try to load these modules
describe('BrowserSafety', () => {
    it('editor modules are browser-safe to import', async () => {
        for (const file of ['../source/delta-tracker.js', '../source/model-editor.js']) {
            const source = await fs.readFile(new URL(file, import.meta.url), 'utf-8');
            assert.equal(/\bfrom ['"]node:/.test(source), false);
            assert.equal(/\bimport ['"]node:/.test(source), false);
        }
    });
});
