/*
 * This file tests the export logic for ambapb checkpoint graphs
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import { ModelEditor } from '../source/model-editor.js';
import { exportModifiedOnnx } from '../source/onnx-export.js';
import { attachCheckpoint, parseCheckpoint } from '../source/ambapb.js';
import { parsePrimGraphJson } from '../source/ambapb-prim-graph.js';
import { PRIM_GRAPH_ATTRIBUTE } from '../source/ambapb-editor.js';

const buildCheckpointModelProto = (primGraph) => {
    const model = new onnx.ModelProto();
    model.producer_name = 'cvflowbackend';
    model.metadata_props = [{ key: 'metagraph_type', value: 'checkpoint' }];
    const graph = new onnx.GraphProto();
    const node = new onnx.NodeProto();
    node.op_type = 'CVFlowNVP';
    const attr = new onnx.AttributeProto();
    attr.name = 'prim_graph';
    attr.type = onnx.AttributeProto.AttributeType.TENSOR;
    const tensor = new onnx.TensorProto();
    tensor.data_type = onnx.TensorProto.DataType.UINT8;
    tensor.dims = [BigInt(new TextEncoder().encode(JSON.stringify(primGraph.raw)).length)];
    tensor.raw_data = new TextEncoder().encode(JSON.stringify(primGraph.raw));
    attr.t = tensor;
    node.attribute = [attr];
    graph.node = [node];
    model.graph = graph;
    return model;
};

const buildCheckpointViewModel = (proto, primGraph) => {
    const viewModel = {
        format: 'ONNX',
        _exportable: true,
        _metadata: [],
        _modules: [{
            name: 'shell',
            nodes: [{
                name: 'nvp',
                type: { name: 'CVFlowNVP', identifier: 'CVFlowNVP' },
                attributes: [{
                    name: 'prim_graph',
                    type: 'tensor',
                    value: { /* optional view tensor stub */ }
                }],
                inputs: [],
                outputs: []
            }]
        }],
        get modules() { return this._modules; },
        get exportable() { return this._exportable; },
        get proto() { return proto; }
    };
    attachCheckpoint(viewModel, proto);
    return viewModel;
};

describe('ambapb checkpoint export', () => {
    it('round-trips unmodified checkpoint', () => {
        const primGraph = loadSyntheticPrimGraph();
        const proto = buildCheckpointModelProto(primGraph);
        const model = buildCheckpointViewModel(proto, primGraph);
        const session = ModelEditor.createSession(model);
        const bytes = exportModifiedOnnx(model, session);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        const checkpoint = parseCheckpoint(decoded);
        assert.equal(checkpoint.primGraph.primitives.length, primGraph.primitives.length);
    });

    it('exports edited primitive attribute', () => {
        const primGraph = loadSyntheticPrimGraph();
        const proto = buildCheckpointModelProto(primGraph);
        const model = buildCheckpointViewModel(proto, primGraph);
        const session = ModelEditor.createSession(model);
        const nodeId = 'graph:0/node:0';
        const attrId = `${nodeId}/attr:0`;
        session.applyPatch({
            entityId: attrId,
            entityType: 'attribute',
            changeType: 'modify',
            property: `attributes.${PRIM_GRAPH_ATTRIBUTE}`,
            newValue: buildEditedPrimGraphJson(primGraph, 'conv0', 'stride', '4')
        });
        const bytes = exportModifiedOnnx(model, session);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        const checkpoint = parseCheckpoint(decoded);
        const conv = checkpoint.primGraph.primitives.find((p) => p.id === 'conv0');
        assert.equal(conv.attributes.stride, '4');
    });
});