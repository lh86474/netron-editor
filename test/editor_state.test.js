import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { mockModel } from './fixtures/mock-graph.js';
import { onnxShapedModel } from './fixtures/onnx-shaped-mock.js';
import { ModelEditor, AttributeSchemaResolver, locateValueEntity } from '../source/model-editor.js';

describe('EditorState', () => {
    it('clone produces independent Model_Modified', () => {
        const editor = ModelEditor.createSession(mockModel);
        const modified = editor.modified;
        modified.getGraph().nodes[0].attributes.push({ name: 'test', value: 1 });
        assert.notEqual(modified, mockModel);
        assert.equal(mockModel.modules[0].nodes[0].attributes.length, 1);
    });

    it('clone preserves graph topology and shared value identity', () => {
        const editor = ModelEditor.createSession(mockModel);
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes.length, 2);
        assert.equal(graph.nodes[0].outputs[0].value[0].name, 'hidden');
        assert.equal(graph.nodes[1].inputs[0].value[0].name, 'hidden');
        assert.equal(graph.nodes[0].outputs[0].value[0], graph.nodes[1].inputs[0].value[0]);
    });

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

describe('ModelAdapter', () => {
    it('clones onnx-shaped graph with preserved topology', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes.length, 3);
        assert.equal(graph.nodes[0].attributes.length, 1);
        assert.equal(graph.nodes[1].attributes.length, 0);
    });

    it('normalizes array-valued arguments for view-layer contract', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const arg = editor.modified.getGraph().nodes[0].outputs[0];
        assert.ok(Array.isArray(arg.value));
        assert.equal(arg.value.length, 1);
        assert.equal(arg.value[0].name, 'hidden');
    });

    it('preserves shared value identity across array-valued arguments', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const graph = editor.modified.getGraph();
        assert.equal(graph.nodes[0].outputs[0].value[0], graph.nodes[1].inputs[0].value[0]);
    });

    it('reads getter-based fields into plain editable properties', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const node = editor.modified.getGraph().nodes[0];
        assert.equal(node.name, 'Conv1');
        assert.equal(node.type.name, 'Conv');
        assert.equal(node.type.category, 'Layer');
        assert.equal(node.type.module, 'ai.onnx');
        assert.equal(node.type.version, 11);
    });

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

    it('handles optional empty argument values', () => {
        const editor = ModelEditor.createSession(onnxShapedModel);
        const input = editor.modified.getGraph().nodes[2].inputs[0];
        const output = editor.modified.getGraph().nodes[2].outputs[0];
        assert.deepEqual(input.value, []);
        assert.deepEqual(output.value, []);
    });
});

describe('BrowserSafety', () => {
    it('editor modules are browser-safe to import', async () => {
        for (const file of ['../source/delta-tracker.js', '../source/model-editor.js']) {
            const source = await fs.readFile(new URL(file, import.meta.url), 'utf-8');
            assert.equal(/\bfrom ['"]node:/.test(source), false);
            assert.equal(/\bimport ['"]node:/.test(source), false);
        }
    });
});
