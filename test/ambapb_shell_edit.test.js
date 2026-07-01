/* 
 * This file also tests the editing logic, more specifically testing
 * that the edits are applied and delta tracker tracks changes correctly
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachCheckpoint } from '../source/ambapb.js';
import { CVFLOW_NVP_OP_TYPE } from '../source/ambapb-editor.js';
import { parsePrimGraphJson, serializePrimGraphJson } from '../source/ambapb-prim-graph.js';
import {
    formatPrimGraphForEditor,
    getPrimGraphSnapshotValue,
    syncShellAttribute,
    validateAmbapbPatch
} from '../source/ambapb-editor.js';
import { ModelEditor } from '../source/model-editor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

const buildShellCheckpointModel = () => {
    const primGraph = loadSyntheticPrimGraph();
    const viewModel = {
        format: 'ONNX',
        _exportable: false,
        _metadata: [],
        _kind: 'amba-checkpoint',
        get kind() {
            return this._kind;
        },
        _modules: [{
            name: '',
            nodes: [{
                name: 'data',
                type: { name: CVFLOW_NVP_OP_TYPE, identifier: CVFLOW_NVP_OP_TYPE },
                attributes: [
                    { name: 'prim_graph', type: 'tensor', value: { type: 'uint8', dims: [1] } },
                    { name: 'prim_graph_imms', type: 'tensor[]', value: [] },
                    { name: 'compiled_prim_graph', type: 'graph', value: { name: 'compiled', nodes: [], inputs: [], outputs: [] } }
                ],
                inputs: [],
                outputs: []
            }],
            inputs: [],
            outputs: []
        }],
        get modules() {
            return this._modules;
        }
    };
    viewModel._ambapb = {
        primGraph,
        imms: { entries: [], encoding: 'none' },
        canEdit: true,
        canExport: false
    };
    return viewModel;
};

const primGraphAttributeEntityId = (session) => {
    const node = session.modified.getGraph(0).nodes[0];
    const index = node.attributes.findIndex((entry) => entry.name === 'prim_graph');
    assert.ok(index >= 0);
    return `graph:0/node:0/attr:${index}`;
};

const editedPrimGraphJson = () => {
    const primGraph = loadSyntheticPrimGraph();
    primGraph.raw.primitives[1].attributes.stride = '4';
    return serializePrimGraphJson(primGraph);
};

describe('ambapb shell editing', () => {
    it('formats prim_graph JSON for the sidebar editor', () => {
        const model = buildShellCheckpointModel();
        const formatted = formatPrimGraphForEditor(model._ambapb);
        assert.ok(formatted.includes('\n'));
        assert.ok(formatted.includes('"stride": "2"'));
    });

    it('syncs prim_graph JSON edits into model._ambapb.primGraph', () => {
        const model = buildShellCheckpointModel();
        const json = editedPrimGraphJson();
        syncShellAttribute(model, 0, 0, 'prim_graph', json);
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '4');
        assert.equal(model._ambapb.primGraph.raw.primitives[1].attributes.stride, '4');
    });

    it('applies prim_graph edits through ModelEditor and records delta', () => {
        const model = buildShellCheckpointModel();
        const session = ModelEditor.createSession(model);
        const entityId = primGraphAttributeEntityId(session);
        const json = editedPrimGraphJson();
        session.history.checkpoint(session);
        session.applyPatch({
            entityId,
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.prim_graph',
            newValue: json
        });
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '4');
        assert.equal(session.original._ambapb.primGraph.primitives[1].attributes.stride, '4');
        const change = session.delta.getChanges().find((entry) => entry.entityId === entityId);
        assert.ok(change);
        assert.equal(change.newValue, getPrimGraphSnapshotValue(model._ambapb));
        assert.equal(session.delta.getAggregateState('graph:0/node:0'), 'modified');
    });

    it('supports undo and redo for prim_graph edits', () => {
        const model = buildShellCheckpointModel();
        const session = ModelEditor.createSession(model);
        const entityId = primGraphAttributeEntityId(session);
        session.history.checkpoint(session);
        session.applyPatch({
            entityId,
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.prim_graph',
            newValue: editedPrimGraphJson()
        });
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '4');
        session.history.undo(session);
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '2');
        session.history.redo(session);
        assert.equal(model._ambapb.primGraph.primitives[1].attributes.stride, '4');
    });

    it('allows add and delete attribute patches on runtime shell nodes', () => {
        const model = buildShellCheckpointModel();
        const session = ModelEditor.createSession(model);
        validateAmbapbPatch(session.modified.model, {
            parentId: 'graph:0/node:0',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.new_attr',
            newValue: '1'
        });
        assert.throws(() => validateAmbapbPatch(session.modified.model, {
            entityId: 'graph:0/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'delete',
            property: 'attributes.prim_graph'
        }), /not supported/);
    });

    it('allows renaming runtime shell nodes', () => {
        const model = buildShellCheckpointModel();
        const session = ModelEditor.createSession(model);
        validateAmbapbPatch(session.modified.model, {
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'renamed_nvp'
        });
    });

    it('rejects edits on non-shell checkpoint nodes and read-only attributes', () => {
        const model = buildShellCheckpointModel();
        model._modules[0].nodes.push({
            name: 'inner',
            type: { name: 'Conv' },
            attributes: [],
            inputs: [],
            outputs: []
        });
        const session = ModelEditor.createSession(model);
        assert.throws(() => validateAmbapbPatch(session.modified.model, {
            parentId: 'graph:0/node:1',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.new_attr',
            newValue: '1'
        }), /not supported/);
        assert.throws(() => validateAmbapbPatch(session.modified.model, {
            entityId: 'graph:0/node:0/attr:2',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.compiled_prim_graph',
            newValue: '{}'
        }), /not supported/);
    });

    it('allows edits while viewing compiled graphs', () => {
        const model = buildShellCheckpointModel();
        model._modules[0]._ambapbCompiledGraph = true;
        const session = ModelEditor.createSession(model);
        validateAmbapbPatch(session.modified.model, {
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'renamed'
        }, { viewingCompiledGraph: true });
    });

    it('allows editing name, description, and attributes of compiled nodes', () => {
        const model = buildShellCheckpointModel();
        const compiledGraph = model._modules[0].nodes[0].attributes.find(entry => entry.name === 'compiled_prim_graph').value;
        compiledGraph._ambapbCompiledGraph = true;
        compiledGraph.nodes.push({
            name: 'Conv_0',
            type: { name: 'Conv' },
            attributes: [{ name: 'strides', type: 'int64[]', value: [1, 1] }],
            inputs: [{
                name: 'input',
                value: [{ name: 'tensor_in', type: 'float32' }]
            }],
            outputs: [{
                name: 'output',
                value: [{ name: 'tensor_out', type: 'float32' }]
            }]
        });

        const nestedNvpJson = JSON.stringify({
            primitives: [{
                id: 'prim_0',
                type: 'input',
                attributes: { test: 'val' }
            }]
        });

        compiledGraph.nodes.push({
            name: 'mobilenetv2_prim_nvp0',
            type: { name: 'CVFlowNVP' },
            attributes: [{ name: 'prim_graph', type: 'string', value: nestedNvpJson }]
        });

        const session = ModelEditor.createSession(model);

        // Edit name of the compiled node
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'Conv_0_edited'
        });
        assert.equal(compiledGraph.nodes[0].name, 'Conv_0_edited');

        // Edit attribute of the compiled node
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.strides',
            newValue: [2, 2]
        });
        assert.deepEqual(compiledGraph.nodes[0].attributes[0].value, [2, 2]);

        // Edit nested compiled connection name
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/value:0',
            entityType: 'value',
            changeType: 'modify',
            property: 'name',
            newValue: 'tensor_in_edited'
        });
        assert.equal(compiledGraph.nodes[0].inputs[0].value[0].name, 'tensor_in_edited');

        // Add an attribute to the nested connection
        session.applyPatch({
            parentId: 'graph:0/node:0/compiled_prim_graph/value:0',
            entityType: 'attribute',
            changeType: 'add',
            property: 'attributes.test_attr',
            newValue: '42'
        });
        assert.equal(compiledGraph.nodes[0].inputs[0].value[0].attributes[0].name, 'test_attr');
        assert.equal(compiledGraph.nodes[0].inputs[0].value[0].attributes[0].value, '42');

        // Delete an attribute of the nested connection
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/value:0/attr:0',
            entityType: 'attribute',
            changeType: 'delete',
            property: 'attributes.test_attr'
        });
        assert.equal(compiledGraph.nodes[0].inputs[0].value[0].attributes.length, 0);

        // Edit prim_graph of nested NVP node
        const updatedNvpJson = JSON.stringify({
            primitives: [{
                id: 'prim_0_edited',
                type: 'input',
                attributes: { test: 'val2' }
            }]
        });
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:1/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.prim_graph',
            newValue: updatedNvpJson
        });
        assert.equal(compiledGraph.nodes[1].attributes[0].value, updatedNvpJson);
    });

    it('attachCheckpoint keeps shell graph and enables editing', () => {
        const primGraph = loadSyntheticPrimGraph();
        const viewModel = {
            _exportable: true,
            _metadata: [],
            _modules: [{ name: 'shell', nodes: [{ name: 'data', type: { name: CVFLOW_NVP_OP_TYPE } }] }],
            get modules() {
                return this._modules;
            }
        };
        attachCheckpoint(viewModel, {
            graph: {
                node: [{
                    op_type: CVFLOW_NVP_OP_TYPE,
                    attribute: [{
                        name: 'prim_graph',
                        t: { raw_data: new TextEncoder().encode(JSON.stringify(primGraph.raw)) }
                    }]
                }]
            },
            metadata_props: [{ key: 'metagraph_type', value: 'checkpoint' }],
            producer_name: 'cvflowbackend'
        });
        assert.equal(viewModel._modules[0].nodes.length, 1);
        assert.equal(viewModel._ambapb.canEdit, true);
        const session = ModelEditor.createSession(viewModel);
        assert.equal(session.modified.getGraph(0).nodes[0].type.name, CVFLOW_NVP_OP_TYPE);
    });
});
