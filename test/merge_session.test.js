/*
 * This file contains the tests for the session object that backs the merge UI
 * It has the following tests:
 * 1. starts pending until both slots are loaded
 * 2. auto-detects roles and pre-fills mapping when both models load
 * 3. re-detects roles when a slot model is replaced
 * 4. swapRoles flips upstream slot and clears invalid mapping
 * 5. swapRoles clears mapping when it is invalid under flipped roles
 * 6. does not re-detect roles after swap until a slot changes
 * Author: Luray He
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { onnx } from '../source/onnx-proto.js';
import '../source/onnx-encode.js';
import { createMergeSession } from '../source/merge-session.js';
import { tryMergeOnnxModels } from '../source/model-merge.js';
// We make a mock tensor type
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
// mock tensor value
const makeValueInfo = (name, elemType, dims) => {
    const value = new onnx.ValueInfoProto();
    value.name = name;
    value.type = makeTensorType(elemType, dims);
    return value;
};
// mock model with identity node
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

const slotEntry = (proto, filename) => ({
    model: null,
    proto,
    target: null,
    filename
});

describe('MergeSession', () => {
    // shouldn't merge until we have two file slots loaded. 
    // roleDetection.status must be pending. 
    // .mappingSource is how we know if the mapping was auto-detected, manual, or empty. 
    it('starts pending until both slots are loaded', () => {
        const session = createMergeSession();
        assert.equal(session.roleDetection.status, 'pending');
        assert.equal(session.getUpstream(), null);
        assert.equal(session.mappingSource, 'empty');
        assert.match(session.getRoleSummary(), /Load both models/);
    });

    // This is a successful merge that is unidirectional. 
    // We should auto detect which model is upstream and which one is downstream 
    it('auto-detects roles and pre-fills mapping when both models load', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(consumer, 'consumer.onnx'));
        assert.equal(session.roleDetection.status, 'pending');

        session.setSlotModel('B', slotEntry(producer, 'producer.onnx'));
        assert.equal(session.roleDetection.status, 'unidirectional');
        assert.equal(session.getUpstreamSlot(), 'B');
        assert.equal(session.getDownstreamSlot(), 'A');
        assert.equal(session.getUpstream().filename, 'producer.onnx');
        assert.equal(session.getDownstream().filename, 'consumer.onnx');
        assert.equal(session.mappingSource, 'auto');
        assert.deepEqual(session.mapping, [{ upstream: 'hidden', downstream: 'features' }]);
        assert.equal(session.validation.ok, true);
        assert.equal(session.canOpenMerged(), true);
    });
    // When a model is replaced, makes sure we re-run role detection
    it('re-detects roles when a slot model is replaced', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const incompatible = makeIdentityModel({
            name: 'incompatible',
            inputs: [{ name: 'features', elemType: 11, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 11, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        assert.equal(session.getUpstreamSlot(), 'A');

        session.setSlotModel('B', slotEntry(incompatible, 'incompatible.onnx'));
        assert.equal(session.roleDetection.status, 'failed');
        assert.equal(session.mapping.length, 0);
        assert.equal(session.roleDetection.userOverridden, false);
    });
    // Makes sure that when we swap roles back into a valid merge, we clear invalid mapping and still be able to merge
    it('swapRoles flips upstream slot and clears invalid mapping', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        assert.equal(session.getUpstreamSlot(), 'A');

        assert.equal(session.swapRoles(), true);
        assert.equal(session.getUpstreamSlot(), 'B');
        assert.equal(session.roleDetection.userOverridden, true);
        assert.equal(session.mapping.length, 0);
        assert.equal(session.mappingSource, 'empty');
        assert.equal(session.validation.ok, false);
    });
    // mapping should clear when it becomes invalid after flipped role
    it('swapRoles clears mapping when it is invalid under flipped roles', () => {
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
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(modelA, 'a.onnx'));
        session.setSlotModel('B', slotEntry(modelB, 'b.onnx'));
        assert.equal(session.getUpstreamSlot(), 'A');
        assert.deepEqual(session.mapping, [{ upstream: 'b', downstream: 'b' }]);

        assert.equal(session.swapRoles(), true);
        assert.equal(session.getUpstreamSlot(), 'B');
        assert.equal(session.mapping.length, 0);
        assert.equal(session.validation.ok, false);
    });
    // Since the roles are assigned
    it('does not re-detect roles after swap until a slot changes', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        session.swapRoles();
        assert.equal(session.getUpstreamSlot(), 'B');

        session.resolveRoles();
        assert.equal(session.getUpstreamSlot(), 'B');
        assert.equal(session.roleDetection.userOverridden, true);
    });
    // When the user manually updates the mapping, we should mark it as manual and revalidate
    it('updateMappingRow marks mapping as manual and revalidates', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        session.updateMappingRow('features', 'hidden');
        assert.equal(session.mappingSource, 'manual');
        assert.equal(session.validation.ok, true);

        session.updateMappingRow('features', null);
        assert.equal(session.mapping.length, 0);
        assert.equal(session.validation.ok, false);
    });

    // Makes sure that when we have a valid mapping, we can drive the merge
    it('auto mapping from session can drive merge', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        const merged = tryMergeOnnxModels(session.getUpstream().proto, session.getDownstream().proto, {
            mapping: session.mapping
        });
        assert.equal(merged.ok, true);
    });

    // If we want to change a file, we go to pending
    it('clearSlot resets role detection', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        session.clearSlot('B');
        assert.equal(session.roleDetection.status, 'pending');
        assert.equal(session.getUpstreamSlot(), null);
        assert.equal(session.mapping.length, 0);
    });

    it('swapRoles remains stable across repeated flips', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 768] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 768] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 10] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        assert.equal(session.getUpstreamSlot(), 'A');

        for (let i = 0; i < 10; i++) {
            assert.equal(session.swapRoles(), true);
            assert.equal(session.getUpstreamSlot(), i % 2 === 0 ? 'B' : 'A');
            assert.equal(session.roleDetection.userOverridden, true);
            assert.equal(session.mapping.length, 0);
            assert.equal(session.validation.ok, false);
        }
    });

    it('updateMappingRow surfaces unknown upstream tensor names', () => {
        const producer = makeIdentityModel({
            name: 'producer',
            inputs: [{ name: 'x', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'hidden', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'up', input: ['x'], output: ['hidden'] }]
        });
        const consumer = makeIdentityModel({
            name: 'consumer',
            inputs: [{ name: 'features', elemType: 1, dims: [1, 3] }],
            outputs: [{ name: 'y', elemType: 1, dims: [1, 3] }],
            nodes: [{ name: 'down', input: ['features'], output: ['y'] }]
        });
        const session = createMergeSession();
        session.setSlotModel('A', slotEntry(producer, 'producer.onnx'));
        session.setSlotModel('B', slotEntry(consumer, 'consumer.onnx'));
        session.updateMappingRow('features', 'deleted_tensor');
        assert.equal(session.mappingSource, 'manual');
        assert.equal(session.validation.ok, false);
        assert.ok(session.validation.errors.some((entry) => entry.code === 'UNKNOWN_UPSTREAM_OUTPUT'));
    });
});
