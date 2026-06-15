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
    detectMergeRoles
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
