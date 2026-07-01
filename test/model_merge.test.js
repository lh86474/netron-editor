import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { BinaryReader } from '../source/protobuf.js';
import {
    validateMerge,
    tryMergeOnnxModels,
    formatMergeErrors,
    formatMergeWarnings,
    buildAutomaticMapping,
    buildAutomaticMappingBidirectional,
    detectMergeRoles,
    extractGraphInputs,
    extractGraphOutputs
} from '../source/model-merge.js';
import { validateGraphForMerge as validateGraph } from '../source/onnx-export.js';

const makeTensorType = (elemType, dims = []) => {
    const type = new onnx.TypeProto();
    const tensor = new onnx.TypeProto.Tensor();
    tensor.elem_type = elemType;
    if (dims.length > 0) {
        const shape = new onnx.TensorShapeProto();
        shape.dim = dims.map((value) => {
            const dimension = new onnx.TensorShapeProto.Dimension();
            dimension.dim_value = BigInt(value);
            return dimension;
        });
        tensor.shape = shape;
    }
    type.tensor_type = tensor;
    return type;
};

const makeValueInfo = (name, elemType, dims) => {
    const value = new onnx.ValueInfoProto();
    value.name = name;
    value.type = makeTensorType(elemType, dims);
    return value;
};

const makeIdentityModel = ({ name, inputs, outputs, nodes }) => {
    const model = new onnx.ModelProto();
    model.ir_version = 8n;
    const opset = new onnx.OperatorSetIdProto();
    opset.domain = 'ai.onnx';
    opset.version = 13n;
    model.opset_import = [opset];
    const graph = new onnx.GraphProto();
    graph.name = name;
    graph.input = inputs.map((entry) => makeValueInfo(entry.name, entry.elemType, entry.dims));
    graph.output = outputs.map((entry) => makeValueInfo(entry.name, entry.elemType, entry.dims));
    graph.node = nodes.map((entry) => {
        const node = new onnx.NodeProto();
        node.op_type = 'Identity';
        node.name = entry.name;
        node.input = entry.input;
        node.output = entry.output;
        return node;
    });
    model.graph = graph;
    return model;
};

const buildMergePair = () => {
    const upstream = makeIdentityModel({
        name: 'upstream',
        inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
        outputs: [{ name: 'hidden', elemType: 1, dims: [1, 3] }],
        nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
    });
    const downstream = makeIdentityModel({
        name: 'downstream',
        inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
        outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
        nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
    });
    return { upstream, downstream, mapping: [{ upstream: 'hidden', downstream: 'features' }] };
};

describe('model-merge', () => {
    it('compatible_single_pair merges successfully', () => {
        const { upstream, downstream, mapping } = buildMergePair();
        const result = tryMergeOnnxModels(upstream, downstream, { mapping });
        assert.equal(result.ok, true);
        assert.ok(result.mergedProto);
        assert.equal(result.mergedProto.graph.input.length, 1);
        assert.equal(result.mergedProto.graph.input[0].name, 'x');
        assert.equal(result.mergedProto.graph.output.length, 1);
        assert.equal(result.mergedProto.graph.output[0].name, 'y');
        assert.equal(result.mergedProto.graph.node.length, 2);
        validateGraph(result.mergedProto.graph);
    });

    it('elem_type_mismatch fails validation', () => {
        const { upstream, downstream, mapping } = buildMergePair();
        downstream.graph.input[0].type = makeTensorType(11, [1, 3]);
        const validation = validateMerge(upstream, downstream, mapping);
        assert.equal(validation.ok, false);
        assert.ok(validation.errors.some((entry) => entry.code === 'TYPE_MISMATCH'));
    });

    it('rank_mismatch fails validation', () => {
        const { upstream, downstream, mapping } = buildMergePair();
        downstream.graph.input[0].type = makeTensorType(1, [1, 3, 1]);
        const validation = validateMerge(upstream, downstream, mapping);
        assert.equal(validation.ok, false);
        assert.ok(validation.errors.some((entry) => entry.message.includes('Rank mismatch')));
    });

    it('dim_mismatch fails validation', () => {
        const { upstream, downstream, mapping } = buildMergePair();
        downstream.graph.input[0].type = makeTensorType(1, [1, 768]);
        const validation = validateMerge(upstream, downstream, mapping);
        assert.equal(validation.ok, false);
        assert.ok(validation.errors.some((entry) => entry.message.includes('dimension')));
    });

    it('unmapped_downstream_input fails validation', () => {
        const { upstream, downstream } = buildMergePair();
        downstream.graph.input.push(makeValueInfo('extra', 1, [1, 3]));
        const validation = validateMerge(upstream, downstream, [{ upstream: 'hidden', downstream: 'features' }]);
        assert.equal(validation.ok, false);
        assert.ok(validation.errors.some((entry) => entry.code === 'UNMAPPED_DOWNSTREAM_INPUT'));
    });

    it('duplicate_upstream_mapping fails validation', () => {
        const upstream = makeIdentityModel({
            name: 'upstream',
            inputs: [{ name: 'x', elemType: 1, dims: [1] }],
            outputs: [
                { name: 'a', elemType: 1, dims: [1] },
                { name: 'b', elemType: 1, dims: [1] }
            ],
            nodes: [
                { name: 'n1', input: ['x'], output: ['a'] },
                { name: 'n2', input: ['x'], output: ['b'] }
            ]
        });
        const downstream = makeIdentityModel({
            name: 'downstream',
            inputs: [
                { name: 'in1', elemType: 1, dims: [1] },
                { name: 'in2', elemType: 1, dims: [1] }
            ],
            outputs: [{ name: 'y', elemType: 1, dims: [1] }],
            nodes: [{ name: 'down', input: ['in1', 'in2'], output: ['y'] }]
        });
        const validation = validateMerge(upstream, downstream, [
            { upstream: 'a', downstream: 'in1' },
            { upstream: 'a', downstream: 'in2' }
        ]);
        assert.equal(validation.ok, false);
        assert.ok(validation.errors.some((entry) => entry.code === 'DUPLICATE_UPSTREAM_IN_MAPPING'));
    });

    it('name_collision_prefix still merges', () => {
        const upstream = makeIdentityModel({
            name: 'upstream',
            inputs: [{ name: 'x', elemType: 1, dims: [1] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1] }],
            nodes: [{ name: 'shared', input: ['x'], output: ['hidden'] }]
        });
        const downstream = makeIdentityModel({
            name: 'downstream',
            inputs: [{ name: 'features', elemType: 1, dims: [1] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1] }],
            nodes: [{ name: 'shared', input: ['features'], output: ['y'] }]
        });
        const result = tryMergeOnnxModels(upstream, downstream, { mapping: [{ upstream: 'hidden', downstream: 'features' }] });
        assert.equal(result.ok, true);
        const nodeNames = result.mergedProto.graph.node.map((node) => node.name);
        assert.ok(nodeNames.includes('shared'));
        assert.ok(nodeNames.includes('downstream_shared'));
    });

    it('round_trip_encode preserves node count', () => {
        const { upstream, downstream, mapping } = buildMergePair();
        const result = tryMergeOnnxModels(upstream, downstream, { mapping });
        assert.equal(result.ok, true);
        const bytes = onnx.ModelProto.encodeBytes(result.mergedProto);
        const decoded = onnx.ModelProto.decode(BinaryReader.open(bytes));
        assert.equal(decoded.graph.node.length, 2);
    });

    it('formatMergeErrors includes mapping details', () => {
        const text = formatMergeErrors([
            { upstream: 'hidden', downstream: 'features', message: 'Element type mismatch.' }
        ]);
        assert.match(text, /features ← hidden/);
        assert.match(text, /Element type mismatch/);
        assert.match(text, /Cannot merge models/);
    });

    it('formatMergeErrors inline omits dialog header', () => {
        const text = formatMergeErrors([
            { downstream: 'features', message: 'Downstream input is not mapped.' }
        ], { inline: true });
        assert.doesNotMatch(text, /Cannot merge models/);
        assert.match(text, /Input issues:/);
        assert.match(text, /features: Downstream input is not mapped/);
    });

    it('formatMergeWarnings lists mapping and general warnings', () => {
        const text = formatMergeWarnings([
            { upstream: 'hidden', downstream: 'features', message: 'Shape missing on one side.' },
            { message: 'Name collision will be prefixed at merge time.' }
        ], { inline: true });
        assert.match(text, /Warnings:/);
        assert.match(text, /features ← hidden/);
        assert.match(text, /Name collision/);
    });
});

describe('buildAutomaticMapping', () => {
    it('maps single compatible output to single input', () => {
        const { upstream, downstream } = buildMergePair();
        const result = buildAutomaticMapping(upstream, downstream);
        assert.equal(result.ok, true);
        assert.deepEqual(result.mapping, [{ upstream: 'hidden', downstream: 'features' }]);
    });

    it('prefers exact name match over other compatible outputs', () => {
        const upstream = makeIdentityModel({
            name: 'upstream',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [
                { name: 'features', elemType: 1, dims: [1, 3] },
                { name: 'hidden', elemType: 1, dims: [1, 3] }
            ],
            nodes: [
                { name: 'n1', input: ['x'], output: ['features'] },
                { name: 'n2', input: ['x'], output: ['hidden'] }
            ]
        });
        const downstream = makeIdentityModel({
            name: 'downstream',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const result = buildAutomaticMapping(upstream, downstream);
        assert.equal(result.ok, true);
        assert.deepEqual(result.mapping, [{ upstream: 'features', downstream: 'features' }]);
    });

    it('maps multiple inputs when each has a unique compatible output', () => {
        const upstream = makeIdentityModel({
            name: 'upstream',
            inputs: [{ name: 'x', elemType: 1, dims: [1] }],
            outputs: [
                { name: 'a', elemType: 1, dims: [1] },
                { name: 'b', elemType: 1, dims: [2] }
            ],
            nodes: [
                { name: 'n1', input: ['x'], output: ['a'] },
                { name: 'n2', input: ['x'], output: ['b'] }
            ]
        });
        const downstream = makeIdentityModel({
            name: 'downstream',
            inputs: [
                { name: 'in1', elemType: 1, dims: [1] },
                { name: 'in2', elemType: 1, dims: [2] }
            ],
            outputs: [{ name: 'y', elemType: 1, dims: [1] }],
            nodes: [{ name: 'down', input: ['in1', 'in2'], output: ['y'] }]
        });
        const result = buildAutomaticMapping(upstream, downstream);
        assert.equal(result.ok, true);
        assert.equal(result.mapping.length, 2);
        assert.deepEqual(result.mapping, [
            { upstream: 'a', downstream: 'in1' },
            { upstream: 'b', downstream: 'in2' }
        ]);
    });

    it('fails when multiple compatible outputs exist for one input', () => {
        const upstream = makeIdentityModel({
            name: 'upstream',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [
                { name: 'out1', elemType: 1, dims: [1, 3] },
                { name: 'out2', elemType: 1, dims: [1, 3] }
            ],
            nodes: [
                { name: 'n1', input: ['x'], output: ['out1'] },
                { name: 'n2', input: ['x'], output: ['out2'] }
            ]
        });
        const downstream = makeIdentityModel({
            name: 'downstream',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const result = buildAutomaticMapping(upstream, downstream);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((entry) => entry.code === 'AMBIGUOUS_AUTO_MAPPING'));
    });

    it('fails when no compatible upstream output exists', () => {
        const { upstream, downstream } = buildMergePair();
        downstream.graph.input[0].type = makeTensorType(11, [1, 3]);
        const result = buildAutomaticMapping(upstream, downstream);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((entry) => entry.code === 'NO_AUTO_MAPPING'));
    });

    it('automatic mapping can drive a successful merge', () => {
        const { upstream, downstream } = buildMergePair();
        const auto = buildAutomaticMapping(upstream, downstream);
        assert.equal(auto.ok, true);
        const merged = tryMergeOnnxModels(upstream, downstream, { mapping: auto.mapping });
        assert.equal(merged.ok, true);
    });
});

describe('buildAutomaticMappingBidirectional', () => {
    it('finds the correct model order automatically', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const wrongOrder = buildAutomaticMapping(consumer, producer);
        assert.equal(wrongOrder.ok, false);

        const result = buildAutomaticMappingBidirectional(consumer, producer);
        assert.equal(result.ok, true);
        assert.equal(result.upstreamProto, producer);
        assert.equal(result.downstreamProto, consumer);
        assert.deepEqual(result.mapping, [{ upstream: 'hidden', downstream: 'features' }]);
    });

    it('reports ambiguous role when both orderings tie', () => {
        const modelA = makeIdentityModel({
            name: 'model-a',
            inputs: [{ name: 'a', elemType: 1, dims: [1] }],
            outputs: [{ name: 'b', elemType: 1, dims: [1] }],
            nodes: [{ name: 'n1', input: ['a'], output: ['b'] }]
        });
        const modelB = makeIdentityModel({
            name: 'model-b',
            inputs: [{ name: 'b', elemType: 1, dims: [1] }],
            outputs: [{ name: 'a', elemType: 1, dims: [1] }],
            nodes: [{ name: 'n2', input: ['b'], output: ['a'] }]
        });
        const result = buildAutomaticMappingBidirectional(modelA, modelB);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((entry) => entry.code === 'AMBIGUOUS_MERGE_ROLE'));
    });
});

describe('detectMergeRoles', () => {
    it('assigns producer to upstream slot regardless of load order', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });

        const consumerFirst = detectMergeRoles(consumer, producer);
        assert.equal(consumerFirst.ok, true);
        assert.equal(consumerFirst.status, 'unidirectional');
        assert.equal(consumerFirst.upstreamSlot, 'B');
        assert.equal(consumerFirst.upstreamProto, producer);
        assert.equal(consumerFirst.downstreamProto, consumer);
        assert.equal(consumerFirst.confidence, 'high');
        assert.deepEqual(consumerFirst.mapping, [{ upstream: 'hidden', downstream: 'features' }]);

        const producerFirst = detectMergeRoles(producer, consumer);
        assert.equal(producerFirst.ok, true);
        assert.equal(producerFirst.status, 'unidirectional');
        assert.equal(producerFirst.upstreamSlot, 'A');
        assert.equal(producerFirst.upstreamProto, producer);
        assert.equal(producerFirst.downstreamProto, consumer);
    });

    it('returns failed when neither direction works', () => {
        const modelA = makeIdentityModel({
            name: 'model-a',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const modelB = makeIdentityModel({
            name: 'model-b',
            inputs: [{ name: 'features', elemType: 11, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 11, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const result = detectMergeRoles(modelA, modelB);
        assert.equal(result.ok, false);
        assert.equal(result.status, 'failed');
        assert.equal(result.upstreamSlot, null);
        assert.equal(result.mapping.length, 0);
    });

    it('prefers the direction with more exact name matches', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1] }],
            outputs: [
                { name: 'features', elemType: 1, dims: [1] },
                { name: 'other', elemType: 1, dims: [1] }
            ],
            nodes: [
                { name: 'n1', input: ['x'], output: ['features'] },
                { name: 'n2', input: ['x'], output: ['other'] }
            ]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const result = detectMergeRoles(producer, consumer);
        assert.equal(result.ok, true);
        assert.equal(result.upstreamSlot, 'A');
        assert.deepEqual(result.mapping, [{ upstream: 'features', downstream: 'features' }]);
        assert.equal(result.confidence, 'high');
    });

    it('resolves circular models with low confidence using slot A preference', () => {
        const modelA = makeIdentityModel({
            name: 'model-a',
            inputs: [{ name: 'a', elemType: 1, dims: [1] }],
            outputs: [{ name: 'b', elemType: 1, dims: [1] }],
            nodes: [{ name: 'n1', input: ['a'], output: ['b'] }]
        });
        const modelB = makeIdentityModel({
            name: 'model-b',
            inputs: [{ name: 'b', elemType: 1, dims: [1] }],
            outputs: [{ name: 'a', elemType: 1, dims: [1] }],
            nodes: [{ name: 'n2', input: ['b'], output: ['a'] }]
        });
        const result = detectMergeRoles(modelA, modelB);
        assert.equal(result.ok, true);
        assert.equal(result.status, 'resolved');
        assert.equal(result.upstreamSlot, 'A');
        assert.equal(result.confidence, 'low');
        assert.deepEqual(result.mapping, [{ upstream: 'b', downstream: 'b' }]);
    });

    it('prefers the model with more outputs as upstream when scores tie', () => {
        const modelA = makeIdentityModel({
            name: 'model-a',
            inputs: [{ name: 'a', elemType: 1, dims: [1] }],
            outputs: [
                { name: 'b', elemType: 1, dims: [1] },
                { name: 'c', elemType: 1, dims: [1] }
            ],
            nodes: [
                { name: 'n1', input: ['a'], output: ['b'] },
                { name: 'n2', input: ['a'], output: ['c'] }
            ]
        });
        const modelB = makeIdentityModel({
            name: 'model-b',
            inputs: [{ name: 'b', elemType: 1, dims: [1] }],
            outputs: [{ name: 'a', elemType: 1, dims: [1] }],
            nodes: [{ name: 'n2', input: ['b'], output: ['a'] }]
        });
        const result = detectMergeRoles(modelA, modelB);
        assert.equal(result.ok, true);
        assert.equal(result.upstreamSlot, 'A');
        assert.equal(result.upstreamProto, modelA);
        assert.equal(result.downstreamProto, modelB);
        assert.deepEqual(result.mapping, [{ upstream: 'b', downstream: 'b' }]);
    });
});

describe('amba-checkpoint-merge', () => {
    const makeCheckpointModel = (primitives, rawFields = {}) => {
        const model = new onnx.ModelProto();
        model.producer_name = 'cvflowbackend';
        model.metadata_props = [{ key: 'metagraph_type', value: 'checkpoint' }];
        const graph = new onnx.GraphProto();
        
        const raw = {
            primitives: primitives,
            ...rawFields
        };
        
        const node = new onnx.NodeProto();
        node.op_type = 'CVFlowNVP';
        const attr = new onnx.AttributeProto();
        attr.name = 'prim_graph';
        attr.type = onnx.AttributeProto.AttributeType.TENSOR;
        const tensor = new onnx.TensorProto();
        tensor.data_type = onnx.TensorProto.DataType.UINT8;
        const rawDataBytes = new TextEncoder().encode(JSON.stringify(raw));
        tensor.dims = [BigInt(rawDataBytes.length)];
        tensor.raw_data = rawDataBytes;
        attr.t = tensor;
        node.attribute = [attr];
        
        const inputs = primitives.filter((p) => p.type === 'input');
        const outputs = primitives.filter((p) => p.type === 'output');
        
        graph.input = inputs.map((p) => {
            const val = new onnx.ValueInfoProto();
            val.name = p.id;
            const type = new onnx.TypeProto();
            const tensorProto = new onnx.TypeProto.Tensor();
            tensorProto.elem_type = 2; // uint8
            type.tensor_type = tensorProto;
            val.type = type;
            return val;
        });
        
        graph.output = outputs.map((p) => {
            const val = new onnx.ValueInfoProto();
            val.name = p.id;
            const type = new onnx.TypeProto();
            const tensorProto = new onnx.TypeProto.Tensor();
            tensorProto.elem_type = 2; // uint8
            type.tensor_type = tensorProto;
            val.type = type;
            return val;
        });
        
        graph.node = [node];
        model.graph = graph;
        return model;
    };

    it('extractCheckpointIO extracts inputs and outputs with correct shapes and formats', () => {
        const prims = [
            {
                id: 'input_data',
                type: 'input',
                oports: [{
                    dimension: { w: 224, h: 224, d: 3, p: 1 },
                    'data-format': { sign: 0, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'conv',
                type: 'conv',
                sources: [{ id: 'input_data', port: 0 }],
                oports: [{
                    dimension: { w: 112, h: 112, d: 32, p: 1 },
                    'data-format': { sign: 1, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'output_data',
                type: 'output',
                sources: [{ id: 'conv', port: 0 }]
            }
        ];
        const model = makeCheckpointModel(prims, { graph_input: 'input_data', graph_output: 'output_data' });
        console.log('DETECT:', detectCheckpoint({ graph: model.graph }));
        console.log('PARSE:', parseCheckpoint({ graph: model.graph, metadata_props: model.metadata_props }));
        const inputs = extractGraphInputs(model.graph);
        const outputs = extractGraphOutputs(model.graph);
        
        assert.equal(inputs.length, 1);
        assert.equal(inputs[0].name, 'input_data');
        assert.equal(inputs[0].type.tensor_type.elem_type, 2); // uint8
        assert.equal(inputs[0].type.tensor_type.shape.dim.length, 4);
        assert.equal(inputs[0].type.tensor_type.shape.dim[0].dim_value, 1n); // p
        assert.equal(inputs[0].type.tensor_type.shape.dim[1].dim_value, 3n); // d
        assert.equal(inputs[0].type.tensor_type.shape.dim[2].dim_value, 224n); // h
        assert.equal(inputs[0].type.tensor_type.shape.dim[3].dim_value, 224n); // w
        
        assert.equal(outputs.length, 1);
        assert.equal(outputs[0].name, 'output_data');
        assert.equal(outputs[0].type.tensor_type.elem_type, 3); // int8 (conv product)
    });

    it('validates type compatibility between checkpoint models', () => {
        const upstreamPrims = [
            {
                id: 'input_data',
                type: 'input',
                oports: [{
                    dimension: { w: 224, h: 224, d: 3, p: 1 },
                    'data-format': { sign: 0, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'output_data',
                type: 'output',
                sources: [{ id: 'input_data', port: 0 }]
            }
        ];
        const downstreamPrims1 = [
            {
                id: 'input_features',
                type: 'input',
                oports: [{
                    dimension: { w: 224, h: 224, d: 3, p: 1 },
                    'data-format': { sign: 0, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'output_data',
                type: 'output',
                sources: [{ id: 'input_features', port: 0 }]
            }
        ];
        const downstreamPrims2 = [
            {
                id: 'input_features',
                type: 'input',
                oports: [{
                    dimension: { w: 112, h: 112, d: 3, p: 1 }, // Dimension mismatch
                    'data-format': { sign: 0, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'output_data',
                type: 'output',
                sources: [{ id: 'input_features', port: 0 }]
            }
        ];
        
        const upstream = makeCheckpointModel(upstreamPrims, { graph_input: 'input_data', graph_output: 'output_data' });
        const downstreamCompatible = makeCheckpointModel(downstreamPrims1, { graph_input: 'input_features', graph_output: 'output_data' });
        const downstreamIncompatible = makeCheckpointModel(downstreamPrims2, { graph_input: 'input_features', graph_output: 'output_data' });
        
        const mapCompatible = buildAutomaticMapping(upstream, downstreamCompatible);
        assert.equal(mapCompatible.ok, true);
        assert.deepEqual(mapCompatible.mapping, [{ upstream: 'output_data', downstream: 'input_features' }]);
        
        const mapIncompatible = buildAutomaticMapping(upstream, downstreamIncompatible);
        assert.equal(mapIncompatible.ok, false);
    });

    it('successfully merges two checkpoint models', () => {
        const upstreamPrims = [
            {
                id: 'input_data',
                type: 'input',
                oports: [{
                    dimension: { w: 224, h: 224, d: 3, p: 1 },
                    'data-format': { sign: 0, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'conv1',
                type: 'conv',
                sources: [{ id: 'input_data', port: 0 }],
                oports: [{
                    dimension: { w: 112, h: 112, d: 32, p: 1 },
                    'data-format': { sign: 1, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'output_data',
                type: 'output',
                sources: [{ id: 'conv1', port: 0 }]
            }
        ];
        const downstreamPrims = [
            {
                id: 'input_features',
                type: 'input',
                oports: [{
                    dimension: { w: 112, h: 112, d: 32, p: 1 },
                    'data-format': { sign: 1, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'conv2',
                type: 'conv2',
                sources: [{ id: 'input_features', port: 0 }],
                oports: [{
                    dimension: { w: 56, h: 56, d: 64, p: 1 },
                    'data-format': { sign: 1, bits: 8, expoff: 0, expbits: 0 }
                }]
            },
            {
                id: 'output1',
                type: 'output',
                sources: [
                    { id: 'conv2', port: 0 }
                ]
            }
        ];
        
        const upstream = makeCheckpointModel(upstreamPrims, { graph_input: 'input_data', graph_output: 'output_data' });
        const downstream = makeIdentityModel({
            name: 'downstream_shell',
            inputs: [{ name: 'input_features', elemType: 3, dims: [1, 32, 112, 112] }],
            outputs: [{ name: 'y', elemType: 3, dims: [1, 64, 56, 56] }],
            nodes: [{ name: 'down_shell', input: ['input_features'], output: ['y'], op_type: 'CVFlowNVP' }]
        });
        downstream.producer_name = 'cvflowbackend';
        downstream.metadata_props = [{ key: 'metagraph_type', value: 'checkpoint' }];
        
        // Let's add the prim_graph attribute to downstream shell
        const primGraphAttr = new onnx.AttributeProto();
        primGraphAttr.name = 'prim_graph';
        primGraphAttr.type = onnx.AttributeProto.AttributeType.TENSOR;
        const tensor = new onnx.TensorProto();
        tensor.data_type = onnx.TensorProto.DataType.UINT8;
        const rawBytes = new TextEncoder().encode(JSON.stringify({ primitives: downstreamPrims, graph_input: 'input_features', graph_output: 'output1' }));
        tensor.dims = [BigInt(rawBytes.length)];
        tensor.raw_data = rawBytes;
        primGraphAttr.t = tensor;
        downstream.graph.node[0].attribute = [primGraphAttr];
        
        const result = tryMergeOnnxModels(upstream, downstream, {
            mapping: [{ upstream: 'output_data', downstream: 'input_features' }]
        });
        
        assert.equal(result.ok, true);
        assert.ok(result.mergedProto);
        
        // Verify we have two separate CVFlowNVP nodes connected to each other
        const nodes = result.mergedProto.graph.node;
        assert.equal(nodes.length, 2);
        
        const upstreamNode = nodes.find((n) => n.name === 'ambapb-prim-graph');
        const downstreamNode = nodes.find((n) => n.name === 'downstream_down_shell');
        
        assert.ok(upstreamNode);
        assert.ok(downstreamNode);
        
        assert.equal(upstreamNode.op_type, 'CVFlowNVP');
        assert.equal(downstreamNode.op_type, 'CVFlowNVP');
        
        // Verify connections
        assert.deepEqual(Array.from(upstreamNode.input), ['input_data']);
        assert.deepEqual(Array.from(upstreamNode.output), ['output_data']);
        assert.deepEqual(Array.from(downstreamNode.input), ['output_data']);
        assert.deepEqual(Array.from(downstreamNode.output), ['downstream_y']);
        
        // Verify attributes are preserved
        const upstreamAttr = upstreamNode.attribute.find((a) => a.name === 'prim_graph');
        const downstreamAttr = downstreamNode.attribute.find((a) => a.name === 'prim_graph');
        assert.ok(upstreamAttr);
        assert.ok(downstreamAttr);
    });

    it('refuses to merge mixed model types', () => {
        const onnxModel = makeIdentityModel({
            name: 'onnx',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'n', input: ['x'], output: ['y'] }]
        });
        const checkpoint = makeCheckpointModel([{ id: 'data', type: 'input', oports: [{ dimension: { w: 224, h: 224 }, 'data-format': { sign: 0, bits: 8 } }] }]);
        
        const result = tryMergeOnnxModels(onnxModel, checkpoint);
        assert.equal(result.ok, false);
        assert.ok(result.errors.some((err) => err.code === 'INCOMPATIBLE_MODELS'));
    });
});
