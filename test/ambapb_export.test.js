/*
 * This file tests the export logic for ambapb checkpoint graphs
 * Author: Luray He
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import { ModelEditor } from '../source/model-editor.js';
import { exportModifiedOnnx, rebuildGraphProtoFromModified } from '../source/onnx-export.js';
import { attachCheckpoint, parseCheckpoint } from '../source/ambapb.js';
import { parsePrimGraphJson, serializePrimGraphJson } from '../source/ambapb-prim-graph.js';
import { COMPILED_PRIM_GRAPH_ATTRIBUTE, PRIM_GRAPH_ATTRIBUTE } from '../source/ambapb-editor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const loadSyntheticPrimGraph = () => {
    const filePath = path.join(repoRoot, 'test', 'fixtures', 'ambapb-prim-graph.json');
    return parsePrimGraphJson(JSON.stringify(JSON.parse(fs.readFileSync(filePath, 'utf8'))));
};

const buildEditedPrimGraphJson = (primGraph, primitiveId, attributeName, value) => {
    const primitive = primGraph.primitives.find((p) => p.id === primitiveId);
    primitive.attributes = primitive.attributes || {};
    primitive.attributes[attributeName] = value;
    const rawPrimitive = primGraph.raw.primitives.find((p) => p.id === primitiveId);
    rawPrimitive.attributes = rawPrimitive.attributes || {};
    rawPrimitive.attributes[attributeName] = value;
    return serializePrimGraphJson(primGraph);
};

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

    const immsAttr = new onnx.AttributeProto();
    immsAttr.name = 'prim_graph_imms';
    immsAttr.type = onnx.AttributeProto.AttributeType.TENSORS;
    const weightTensor = new onnx.TensorProto();
    weightTensor.name = 'conv0.weight';
    weightTensor.data_type = onnx.TensorProto.DataType.FLOAT;
    weightTensor.dims = [BigInt(4)];
    weightTensor.float_data = [1.0, 2.0, 3.0, 4.0];
    immsAttr.tensors = [weightTensor];

    node.attribute = [attr, immsAttr];
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

const buildCheckpointWithCompiledGraph = (primGraph) => {
    const proto = buildCheckpointModelProto(primGraph);
    const wrapper = proto.graph.node[0];
    const compiledAttr = new onnx.AttributeProto();
    compiledAttr.name = COMPILED_PRIM_GRAPH_ATTRIBUTE;
    compiledAttr.type = onnx.AttributeProto.AttributeType.GRAPH;
    const compiledGraph = new onnx.GraphProto();
    compiledGraph.name = 'runtime';
    const convNode = new onnx.NodeProto();
    convNode.name = 'Conv_0';
    convNode.op_type = 'Conv';
    convNode.input = ['tensor_in'];
    convNode.output = ['tensor_out'];
    const stridesAttr = new onnx.AttributeProto();
    stridesAttr.name = 'strides';
    stridesAttr.type = onnx.AttributeProto.AttributeType.INTS;
    stridesAttr.ints = [BigInt(1), BigInt(1)];
    convNode.attribute = [stridesAttr];
    const nvpNode = new onnx.NodeProto();
    nvpNode.name = 'mobilenetv2_prim_nvp0';
    nvpNode.op_type = 'CVFlowNVP';
    nvpNode.output = ['nvp_out'];
    const primGraphAttr = new onnx.AttributeProto();
    primGraphAttr.name = PRIM_GRAPH_ATTRIBUTE;
    primGraphAttr.type = onnx.AttributeProto.AttributeType.TENSOR;
    const nestedPrimGraph = {
        primitives: [{
            id: 'prim_0',
            type: 'input',
            attributes: { test: 'val' }
        }]
    };
    const nestedBytes = new TextEncoder().encode(JSON.stringify(nestedPrimGraph));
    const nestedTensor = new onnx.TensorProto();
    nestedTensor.data_type = onnx.TensorProto.DataType.UINT8;
    nestedTensor.dims = [BigInt(nestedBytes.length)];
    nestedTensor.raw_data = nestedBytes;
    primGraphAttr.t = nestedTensor;
    nvpNode.attribute = [primGraphAttr];
    compiledGraph.node = [convNode, nvpNode];
    compiledAttr.g = compiledGraph;
    wrapper.attribute.push(compiledAttr);

    const viewModel = {
        format: 'ONNX',
        _exportable: true,
        _kind: 'amba-checkpoint',
        get kind() { return this._kind; },
        _modules: [{
            name: 'shell',
            nodes: [{
                name: 'data',
                type: { name: 'CVFlowNVP', identifier: 'CVFlowNVP' },
                attributes: [
                    { name: 'prim_graph', type: 'tensor', value: {} },
                    { name: 'prim_graph_imms', type: 'tensor[]', value: [] },
                    {
                        name: COMPILED_PRIM_GRAPH_ATTRIBUTE,
                        type: 'graph',
                        value: {
                            name: 'runtime',
                            inputs: [],
                            outputs: [],
                            nodes: [
                                {
                                    name: 'Conv_0',
                                    type: { name: 'Conv' },
                                    attributes: [{ name: 'strides', type: 'int64[]', value: [1, 1] }],
                                    inputs: [{ name: 'input', value: [{ name: 'tensor_in', type: 'float32' }] }],
                                    outputs: [{ name: 'output', value: [{ name: 'tensor_out', type: 'float32' }] }]
                                },
                                {
                                    name: 'mobilenetv2_prim_nvp0',
                                    type: { name: 'CVFlowNVP' },
                                    attributes: [{
                                        name: PRIM_GRAPH_ATTRIBUTE,
                                        type: 'string',
                                        value: JSON.stringify(nestedPrimGraph)
                                    }],
                                    inputs: [],
                                    outputs: [{ name: 'output', value: [{ name: 'nvp_out', type: 'float32' }] }]
                                }
                            ]
                        }
                    }
                ],
                inputs: [],
                outputs: []
            }],
            inputs: [],
            outputs: []
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

    it('exports subgraph with weights from prim_graph_imms', () => {
        const primGraph = loadSyntheticPrimGraph();
        
        const conv = primGraph.primitives.find((p) => p.id === 'conv0');
        conv.raw = conv.raw || {};
        conv.raw.immediates = [
            {
                'file-name': 'conv0.weight.bin',
                'data-format': { sign: 1, bits: 8, expoff: 0, expbits: 0 },
                'dimension': { w: 1, h: 1, d: 1, p: 1 }
            }
        ];

        const proto = buildCheckpointModelProto(primGraph);
        
        const extracted = {
            name: 'subgraph',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'conv0',
                    type: { name: 'Conv' },
                    inputs: [
                        { name: 'input', value: [{ name: 'data' }] }
                    ],
                    outputs: [
                        { name: 'output', value: [{ name: 'conv0_out' }] }
                    ]
                }
            ]
        };

        const rebuilt = rebuildGraphProtoFromModified(extracted, proto);
        assert.equal(rebuilt.node.length, 1);
        assert.equal(rebuilt.node[0].op_type, 'CVFlowNVP');
        const immsAttr = rebuilt.node[0].attribute.find((attr) => attr.name === 'prim_graph_imms');
        assert.ok(immsAttr);
        assert.equal(immsAttr.tensors.length, 1);
        assert.equal(immsAttr.tensors[0].name, 'conv0.weight');
        assert.deepEqual(Array.from(immsAttr.tensors[0].float_data), [1.0, 2.0, 3.0, 4.0]);
        const primGraphAttr = rebuilt.node[0].attribute.find((attr) => attr.name === 'prim_graph');
        assert.ok(primGraphAttr);
        const parsed = parsePrimGraphJson(primGraphAttr.t);
        assert.equal(parsed.primitives.length, 2);
        assert.ok(parsed.primitives.some((prim) => prim.id === 'conv0'));
        assert.ok(parsed.primitives.some((prim) => prim.id === 'data'));
    });

    it('exports flat runtime graph without re-wrapping in a CVFlowNVP shell', () => {
        const primGraph = loadSyntheticPrimGraph();
        const proto = buildCheckpointModelProto(primGraph);
        const model = buildCheckpointViewModel(proto, primGraph);
        const session = ModelEditor.createSession(model);
        const flatRuntime = {
            name: 'runtime',
            inputs: [{ name: 'data', value: [{ name: 'data', type: 'float32' }] }],
            outputs: [{ name: 'conv0_out', value: [{ name: 'conv0_out', type: 'float32' }] }],
            nodes: [
                {
                    name: 'conv0',
                    type: { name: 'Conv' },
                    attributes: [],
                    inputs: [{ name: 'input', value: [{ name: 'data' }] }],
                    outputs: [{ name: 'output', value: [{ name: 'conv0_out' }] }]
                },
                {
                    name: 'batch_call',
                    type: { name: 'BatchCall' },
                    attributes: [{ name: 'graph_id', type: 'string', value: 'subgraph_body' }],
                    inputs: [{ name: 'input0', value: [{ name: 'conv0_out' }] }],
                    outputs: [{ name: 'output', value: [{ name: 'batch_out' }] }]
                }
            ]
        };
        session.replaceGraph(0, flatRuntime);
        const bytes = exportModifiedOnnx(model, session);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.ok(decoded.graph.node.length >= 2);
        const soleWrapper = decoded.graph.node.length === 1 &&
            decoded.graph.node[0].op_type === 'CVFlowNVP';
        assert.ok(!soleWrapper);
        assert.ok(decoded.graph.node.some((node) => node.name === 'conv0'));
        assert.ok(decoded.graph.node.some((node) => node.name === 'batch_call'));
    });

    it('exports extracted checkpoint subgraph through exportModifiedOnnx', () => {
        const primGraph = loadSyntheticPrimGraph();
        const conv = primGraph.primitives.find((p) => p.id === 'conv0');
        conv.raw = conv.raw || {};
        conv.raw.immediates = [
            {
                'file-name': 'conv0.weight.bin',
                'data-format': { sign: 1, bits: 8, expoff: 0, expbits: 0 },
                'dimension': { w: 1, h: 1, d: 1, p: 1 }
            }
        ];
        const proto = buildCheckpointModelProto(primGraph);
        const model = buildCheckpointViewModel(proto, primGraph);
        const session = ModelEditor.createSession(model);
        const extracted = {
            name: 'subgraph',
            inputs: [],
            outputs: [],
            nodes: [{
                name: 'conv0',
                type: { name: 'Conv' },
                attributes: [],
                inputs: [{ name: 'input', value: [{ name: 'data' }] }],
                outputs: [{ name: 'output', value: [{ name: 'conv0' }] }]
            }]
        };
        session.replaceGraph(0, extracted);
        const rebuilt = rebuildGraphProtoFromModified(extracted, proto);
        model.proto.graph = rebuilt;
        const bytes = exportModifiedOnnx(model, session);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        const checkpoint = parseCheckpoint(decoded);
        assert.equal(checkpoint.primGraphImmsAttribute.tensors.length, 1);
        assert.equal(checkpoint.primGraphImmsAttribute.tensors[0].name, 'conv0.weight');
    });

    it('preserves FragSubgraph graph attributes during graph rebuild', () => {
        const model = new onnx.ModelProto();
        const graph = new onnx.GraphProto();
        graph.name = 'runtime';
        const fragNode = new onnx.NodeProto();
        fragNode.name = 'frag_node';
        fragNode.op_type = 'FragSubgraph';
        const graphAttr = new onnx.AttributeProto();
        graphAttr.name = 'graph';
        graphAttr.type = onnx.AttributeProto.AttributeType.GRAPH;
        const nestedGraph = new onnx.GraphProto();
        nestedGraph.name = 'subgraph_body';
        const innerNode = new onnx.NodeProto();
        innerNode.name = 'inner_nvp';
        innerNode.op_type = 'CVFlowNVP';
        innerNode.input = ['sub_input_0'];
        innerNode.output = ['sub_output_0'];
        nestedGraph.node = [innerNode];
        graphAttr.g = nestedGraph;
        fragNode.attribute = [graphAttr];
        graph.node = [fragNode];
        model.graph = graph;

        const extracted = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [{
                name: 'frag_node',
                type: { name: 'FragSubgraph' },
                attributes: [{
                    name: 'graph',
                    type: 'graph',
                    value: {
                        name: 'subgraph_body',
                        inputs: [],
                        outputs: [],
                        nodes: [{
                            name: 'inner_nvp',
                            type: { name: 'CVFlowNVP' },
                            attributes: [],
                            inputs: [{ name: 'input0', value: [{ name: 'sub_input_0' }] }],
                            outputs: [{ name: 'output', value: [{ name: 'sub_output_0' }] }]
                        }]
                    }
                }],
                inputs: [],
                outputs: []
            }]
        };

        const rebuilt = rebuildGraphProtoFromModified(extracted, model);
        const rebuiltFrag = rebuilt.node.find((node) => node.name === 'frag_node');
        assert.ok(rebuiltFrag);
        const rebuiltGraphAttr = rebuiltFrag.attribute.find((attr) => attr.name === 'graph');
        assert.ok(rebuiltGraphAttr && rebuiltGraphAttr.g);
        assert.equal(rebuiltGraphAttr.g.name, 'subgraph_body');
        assert.equal(rebuiltGraphAttr.g.node.length, 1);
        assert.equal(rebuiltGraphAttr.g.node[0].name, 'inner_nvp');
    });

    it('preserves FragSubgraph graph attributes during checkpoint compiled graph rebuild', () => {
        const primGraph = loadSyntheticPrimGraph();
        primGraph.raw.primitives.push({
            id: 'inner_nvp',
            'mangled-id': 'inner_nvp',
            type: 'conv2ibesbcp',
            'vas-sequence-number': 99,
            'fragment-id': '',
            sources: [{ id: 'data', port: 0 }],
            oports: [{ id: 'sub_output_0', 'additional-dep-prim-ids': [] }],
            attributes: {}
        });
        primGraph.primitives.push({
            id: 'inner_nvp',
            mangledId: 'inner_nvp',
            type: 'conv2ibesbcp',
            vasSequenceNumber: 99,
            fragmentId: '',
            sources: [{ id: 'data', port: 0 }],
            oports: [{ id: 'sub_output_0', additionalDepPrimIds: [] }],
            attributes: {},
            raw: primGraph.raw.primitives[primGraph.raw.primitives.length - 1]
        });
        const proto = buildCheckpointModelProto(primGraph);
        const wrapper = proto.graph.node[0];
        const compiledAttr = new onnx.AttributeProto();
        compiledAttr.name = 'compiled_prim_graph';
        compiledAttr.type = onnx.AttributeProto.AttributeType.GRAPH;
        const compiledGraph = new onnx.GraphProto();
        compiledGraph.name = 'runtime';
        const fragNode = new onnx.NodeProto();
        fragNode.name = 'frag_node';
        fragNode.op_type = 'FragSubgraph';
        const graphAttr = new onnx.AttributeProto();
        graphAttr.name = 'graph';
        graphAttr.type = onnx.AttributeProto.AttributeType.GRAPH;
        const nestedGraph = new onnx.GraphProto();
        nestedGraph.name = 'subgraph_body';
        const innerNode = new onnx.NodeProto();
        innerNode.name = 'inner_nvp';
        innerNode.op_type = 'CVFlowNVP';
        innerNode.input = ['sub_input_0'];
        innerNode.output = ['sub_output_0'];
        nestedGraph.node = [innerNode];
        graphAttr.g = nestedGraph;
        fragNode.attribute = [graphAttr];
        const batchNode = new onnx.NodeProto();
        batchNode.name = 'batch_call';
        batchNode.op_type = 'BatchCall';
        const graphIdAttr = new onnx.AttributeProto();
        graphIdAttr.name = 'graph_id';
        graphIdAttr.type = onnx.AttributeProto.AttributeType.STRING;
        graphIdAttr.s = new TextEncoder().encode('subgraph_body');
        batchNode.attribute = [graphIdAttr];
        compiledGraph.node = [fragNode, batchNode];
        compiledAttr.g = compiledGraph;
        wrapper.attribute.push(compiledAttr);

        const extracted = {
            name: 'runtime',
            inputs: [],
            outputs: [],
            nodes: [
                {
                    name: 'frag_node',
                    type: { name: 'FragSubgraph' },
                    attributes: [{
                        name: 'graph',
                        type: 'graph',
                        value: {
                            name: 'subgraph_body',
                            inputs: [],
                            outputs: [],
                            nodes: [{
                                name: 'inner_nvp',
                                type: { name: 'CVFlowNVP' },
                                attributes: [],
                                inputs: [{ name: 'input0', value: [{ name: 'sub_input_0' }] }],
                                outputs: [{ name: 'output', value: [{ name: 'sub_output_0' }] }]
                            }]
                        }
                    }],
                    inputs: [],
                    outputs: []
                },
                {
                    name: 'batch_call',
                    type: { name: 'BatchCall' },
                    attributes: [{ name: 'graph_id', type: 'string', value: 'subgraph_body' }],
                    inputs: [{ name: 'input0', value: [{ name: 'producer_out' }] }],
                    outputs: [{ name: 'output', value: [{ name: 'batch_out' }] }]
                }
            ]
        };

        const rebuilt = rebuildGraphProtoFromModified(extracted, proto);
        const rebuiltCompiled = rebuilt.node[0].attribute.find((attr) => attr.name === 'compiled_prim_graph');
        assert.ok(rebuiltCompiled && rebuiltCompiled.g);
        const rebuiltFrag = rebuiltCompiled.g.node.find((node) => node.name === 'frag_node');
        assert.ok(rebuiltFrag);
        const rebuiltGraphAttr = rebuiltFrag.attribute.find((attr) => attr.name === 'graph');
        assert.ok(rebuiltGraphAttr && rebuiltGraphAttr.g);
        assert.equal(rebuiltGraphAttr.g.name, 'subgraph_body');
        assert.equal(rebuiltGraphAttr.g.node.length, 1);
        assert.equal(rebuiltGraphAttr.g.node[0].name, 'inner_nvp');
    });

    it('exports compiled_prim_graph attribute edits through exportModifiedOnnx', () => {
        const primGraph = loadSyntheticPrimGraph();
        const model = buildCheckpointWithCompiledGraph(primGraph);
        const session = ModelEditor.createSession(model);

        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:0',
            entityType: 'node',
            changeType: 'modify',
            property: 'name',
            newValue: 'Conv_0_edited'
        });
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/node:0/attr:0',
            entityType: 'attribute',
            changeType: 'modify',
            property: 'attributes.strides',
            newValue: [2, 2]
        });
        session.applyPatch({
            entityId: 'graph:0/node:0/compiled_prim_graph/value:0',
            entityType: 'value',
            changeType: 'modify',
            property: 'name',
            newValue: 'tensor_in_edited'
        });

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
            property: `attributes.${PRIM_GRAPH_ATTRIBUTE}`,
            newValue: updatedNvpJson
        });

        const bytes = exportModifiedOnnx(model, session);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        const wrapper = decoded.graph.node[0];
        const compiledAttr = wrapper.attribute.find((attr) => attr.name === COMPILED_PRIM_GRAPH_ATTRIBUTE);
        assert.ok(compiledAttr && compiledAttr.g);
        const convNode = compiledAttr.g.node.find((node) => node.name === 'Conv_0_edited');
        assert.ok(convNode);
        assert.deepEqual(Array.from(convNode.input), ['tensor_in_edited']);
        const strides = convNode.attribute.find((attr) => attr.name === 'strides');
        assert.ok(strides);
        assert.deepEqual(Array.from(strides.ints), [BigInt(2), BigInt(2)]);
        const nvpNode = compiledAttr.g.node.find((node) => node.name === 'mobilenetv2_prim_nvp0');
        assert.ok(nvpNode);
        const nestedPrimGraphAttr = nvpNode.attribute.find((attr) => attr.name === PRIM_GRAPH_ATTRIBUTE);
        assert.ok(nestedPrimGraphAttr && nestedPrimGraphAttr.t);
        const parsedNested = parsePrimGraphJson(nestedPrimGraphAttr.t);
        assert.equal(parsedNested.primitives[0].id, 'prim_0_edited');
    });
});