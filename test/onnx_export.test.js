/*
 * This file contians tests for the exportModifiedOnnx function
 * Tests Modified export: if renamed node, changed attributes, correct proto bytes are preserved
 * Uses stored proto even if in-memory graph was mutated for viewing, schema never changes
 * If not exportable, must through OnnxExportError
 * If we have Structural edits, such as insert and delete, that must survive export
 * Subgraphs must be able to be exported as well. 
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import { ModelEditor } from '../source/model-editor.js';
import { exportModifiedOnnx, OnnxExportError, rebuildGraphProtoFromModified } from '../source/onnx-export.js';

import { identityNodeSpec } from './fixtures/mock-graph.js';
import { extractSubgraph } from '../source/model-editor.js';

// mock model to test proto byte preservation
const buildMinimalModel = () => {
    const model = new onnx.ModelProto();
    model.ir_version = 8n;
    const opset = new onnx.OperatorSetIdProto();
    opset.domain = 'ai.onnx';
    opset.version = 13n;
    model.opset_import = [opset];
    const graph = new onnx.GraphProto();
    graph.name = 'test_graph';
    const input = new onnx.ValueInfoProto();
    input.name = 'x';
    const inputType = new onnx.TypeProto();
    const inputTensor = new onnx.TypeProto.Tensor();
    inputTensor.elem_type = 1;
    const inputShape = new onnx.TensorShapeProto();
    const inputDim = new onnx.TensorShapeProto.Dimension();
    inputDim.dim_value = 1n;
    inputShape.dim = [inputDim];
    inputTensor.shape = inputShape;
    inputType.tensor_type = inputTensor;
    input.type = inputType;
    graph.input = [input];
    const output = new onnx.ValueInfoProto();
    output.name = 'y';
    graph.output = [output];
    const node = new onnx.NodeProto();
    node.op_type = 'Identity';
    node.name = 'identity';
    node.input = ['x'];
    node.output = ['y'];
    const attribute = new onnx.AttributeProto();
    attribute.name = 'test_attr';
    attribute.type = 7;
    attribute.ints = [1n, 2n, 3n];
    node.attribute = [attribute];
    graph.node = [node];
    model.graph = graph;
    return model;
};
// Mock graph
const buildViewModel = (proto) => ({
    format: 'ONNX v8',
    exportable: true,
    proto,
    modules: [{
        name: 'test_graph',
        identifier: 'test_graph',
        inputs: [{ name: 'x', value: [{ name: 'x', type: 'float32[1]' }] }],
        outputs: [{ name: 'y', value: [{ name: 'y' }] }],
        nodes: [{
            name: 'identity',
            type: { name: 'Identity', identifier: 'Identity' },
            attributes: [{ name: 'test_attr', type: 'int64[]', value: [1n, 2n, 3n] }],
            inputs: [{ name: '', value: [{ name: 'x', type: 'float32[1]' }] }],
            outputs: [{ name: '', value: [{ name: 'y' }] }]
        }]
    }]
});
// mock chain model
const buildChainModel = () => {
    const model = new onnx.ModelProto();
    model.ir_version = 8n;
    const opset = new onnx.OperatorSetIdProto();
    opset.domain = 'ai.onnx';
    opset.version = 13n;
    model.opset_import = [opset];
    const graph = new onnx.GraphProto();
    graph.name = 'chain_graph';
    const input = new onnx.ValueInfoProto();
    input.name = 'x';
    graph.input = [input];
    const output = new onnx.ValueInfoProto();
    output.name = 'y';
    graph.output = [output];
    const first = new onnx.NodeProto();
    first.op_type = 'Identity';
    first.name = 'first';
    first.input = ['x'];
    first.output = ['hidden'];
    const second = new onnx.NodeProto();
    second.op_type = 'Identity';
    second.name = 'second';
    second.input = ['hidden'];
    second.output = ['y'];
    graph.node = [first, second];
    model.graph = graph;
    return model;
};
// build chain mdoel from metadata
const buildChainViewModel = (proto) => ({
    format: 'ONNX v8',
    exportable: true,
    proto,
    modules: [{
        name: 'chain_graph',
        identifier: 'chain_graph',
        inputs: [{ name: 'x', value: [{ name: 'x' }] }],
        outputs: [{ name: 'y', value: [{ name: 'y' }] }],
        nodes: [
            {
                name: 'first',
                type: { name: 'Identity', identifier: 'Identity' },
                attributes: [],
                inputs: [{ name: '', value: [{ name: 'x' }] }],
                outputs: [{ name: '', value: [{ name: 'hidden' }] }]
            },
            {
                name: 'second',
                type: { name: 'Identity', identifier: 'Identity' },
                attributes: [],
                inputs: [{ name: '', value: [{ name: 'hidden' }] }],
                outputs: [{ name: '', value: [{ name: 'y' }] }]
            }
        ]
    }]
});

// metadata for mock
const buildThreeNodeChainModel = () => {
    const model = new onnx.ModelProto();
    model.ir_version = 8n;
    const opset = new onnx.OperatorSetIdProto();
    opset.domain = 'ai.onnx';
    opset.version = 13n;
    model.opset_import = [opset];
    const graph = new onnx.GraphProto();
    graph.name = 'chain3_graph';
    const input = new onnx.ValueInfoProto();
    input.name = 'x';
    graph.input = [input];
    const output = new onnx.ValueInfoProto();
    output.name = 'y';
    graph.output = [output];
    const first = new onnx.NodeProto();
    first.op_type = 'Identity';
    first.name = 'first';
    first.input = ['x'];
    first.output = ['hidden1'];
    const second = new onnx.NodeProto();
    second.op_type = 'Identity';
    second.name = 'second';
    second.input = ['hidden1'];
    second.output = ['hidden2'];
    const third = new onnx.NodeProto();
    third.op_type = 'Identity';
    third.name = 'third';
    third.input = ['hidden2'];
    third.output = ['y'];
    graph.node = [first, second, third];
    model.graph = graph;
    return model;
};

// build from buildThreeNodeChainModel
const buildThreeNodeChainViewModel = (proto) => ({
    format: 'ONNX v8',
    exportable: true,
    proto,
    modules: [{
        name: 'chain3_graph',
        identifier: 'chain3_graph',
        inputs: [{ name: 'x', value: [{ name: 'x' }] }],
        outputs: [{ name: 'y', value: [{ name: 'y' }] }],
        nodes: [
            {
                name: 'first',
                type: { name: 'Identity', identifier: 'Identity' },
                attributes: [],
                inputs: [{ name: '', value: [{ name: 'x' }] }],
                outputs: [{ name: '', value: [{ name: 'hidden1' }] }]
            },
            {
                name: 'second',
                type: { name: 'Identity', identifier: 'Identity' },
                attributes: [],
                inputs: [{ name: '', value: [{ name: 'hidden1' }] }],
                outputs: [{ name: '', value: [{ name: 'hidden2' }] }]
            },
            {
                name: 'third',
                type: { name: 'Identity', identifier: 'Identity' },
                attributes: [],
                inputs: [{ name: '', value: [{ name: 'hidden2' }] }],
                outputs: [{ name: '', value: [{ name: 'y' }] }]
            }
        ]
    }]
});

describe('ONNX export', () => {
    // if a model was unmodified, we should be able to round-trip it
    // meaning that the proto bytes should be the same as the original
    it('round-trips an unmodified minimal model', () => {
        const model = buildMinimalModel();
        const bytes = onnx.ModelProto.encodeBytes(model);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.name, 'test_graph');
        assert.equal(decoded.graph.node.length, 1);
        assert.equal(decoded.graph.node[0].op_type, 'Identity');
        assert.deepEqual(decoded.graph.node[0].attribute[0].ints, [1n, 2n, 3n]);
    });

    // Two mock edits that changes the node name and one of the attributes
    // We make sure that the changes are applied by decoding it and getting the fields
    it('exports modified node and attribute changes', () => {
        const proto = buildMinimalModel();
        const viewModel = buildViewModel(proto);
        const editor = ModelEditor.createSession(viewModel);
        editor.applyPatch({
            entityId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'renamed_identity'
        });
        editor.applyPatch({
            entityId: 'graph:0/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.test_attr',
            newValue: [4, 5, 6]
        });
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node[0].name, 'renamed_identity');
        assert.deepEqual(decoded.graph.node[0].attribute[0].ints, [4n, 5n, 6n]);
    });
    // Makes sure we have same proto, we make sure that when we uploaded a modified graph
    // we have input name as x and output name as y.
    it('exports from a pristine proto even when the loaded model graph was mutated for viewing', () => {
        const loaded = buildMinimalModel();
        const pristine = onnx.ModelProto.decode(BinaryReader.open(onnx.ModelProto.encodeBytes(loaded)));
        loaded.graph.node[0].input = [{ name: 'x', initializer: null }];
        loaded.graph.node[0].output = [{ name: 'y', initializer: null }];
        const viewModel = buildViewModel(loaded);
        viewModel.proto = pristine;
        const editor = ModelEditor.createSession(viewModel);
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node[0].input[0], 'x');
        assert.equal(decoded.graph.node[0].output[0], 'y');
    });
    // Reject when model is not exportable
    it('rejects export when model is not exportable', () => {
        const viewModel = buildViewModel(buildMinimalModel());
        viewModel.exportable = false;
        const editor = ModelEditor.createSession(viewModel);
        assert.throws(() => exportModifiedOnnx(viewModel, editor), OnnxExportError);
    });
    // Make sure that we have the correct number of nodes, and that the inserted node is correct
    it('exports graph after insert below reference node', () => {
        const proto = buildChainModel();
        const viewModel = buildChainViewModel(proto);
        const editor = ModelEditor.createSession(viewModel);
        editor.applyPatch({
            parentId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'below',
            newValue: identityNodeSpec('inserted_below')
        });
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node.length, 3);
        const inserted = decoded.graph.node.find((node) => node.name === 'inserted_below');
        assert.ok(inserted);
        assert.equal(inserted.input[0], 'hidden');
        const second = decoded.graph.node.find((node) => node.name === 'second');
        assert.ok(second);
        assert.notEqual(second.input[0], 'hidden');
        assert.equal(second.input[0], inserted.output[0]);
    });
    // check for insert above. Check that we have 3 nodes, 
    it('exports graph after insert above reference node', () => {
        const proto = buildChainModel();
        const viewModel = buildChainViewModel(proto);
        const editor = ModelEditor.createSession(viewModel);
        editor.applyPatch({
            parentId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'above',
            newValue: identityNodeSpec('inserted_above')
        });
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node.length, 3);
        const inserted = decoded.graph.node.find((node) => node.name === 'inserted_above');
        assert.ok(inserted);
        assert.equal(inserted.input[0], 'hidden');
        const second = decoded.graph.node.find((node) => node.name === 'second');
        assert.ok(second);
        assert.equal(second.input[0], inserted.output[0]);
        assert.notEqual(second.input[0], 'hidden');
    });

    // Deletion test. 
    it('exports graph after deleting middle node', () => {
        const proto = buildThreeNodeChainModel();
        const viewModel = buildThreeNodeChainViewModel(proto);
        const editor = ModelEditor.createSession(viewModel);
        editor.applyPatch({
            entityId: 'graph:0/node:1',
            entityType: 'node',
            changeType: 'delete',
            property: 'remove'
        });
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node.length, 2);
        const third = decoded.graph.node.find((node) => node.name === 'third');
        assert.ok(third);
        assert.equal(third.input[0], 'hidden1');
        assert.equal(decoded.graph.node[0].name, 'first');
        assert.equal(decoded.graph.output[0].name, 'y');
    });
    // subgraph extract test
    it('exports graph after subgraph extract and proto rebuild', () => {
        const proto = buildThreeNodeChainModel();
        const viewModel = buildThreeNodeChainViewModel(proto);
        const editor = ModelEditor.createSession(viewModel);
        const graph = editor.modified.getGraph();
        const extracted = extractSubgraph(graph, graph.nodes[0], graph.nodes[1]);
        editor.replaceGraph(0, extracted);
        viewModel.proto.graph = rebuildGraphProtoFromModified(extracted, viewModel.proto);
        const bytes = exportModifiedOnnx(viewModel, editor);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node.length, 2);
        assert.equal(decoded.graph.node[0].name, 'first');
        assert.equal(decoded.graph.node[1].name, 'second');
        assert.equal(decoded.graph.input[0].name, 'x');
        assert.equal(decoded.graph.output[0].name, 'hidden2');
        assert.equal(decoded.graph.node[0].input[0], 'x');
        assert.equal(decoded.graph.node[1].output[0], 'hidden2');
    });
});
