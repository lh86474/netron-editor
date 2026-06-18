/* 
 * This file tests insert() node directly, not just what the delta tracker has after an insert
 * this tests the lower-level functoinality of node insertions
 * This file has three main sections
 * insertNode above
 * insertNode below
 * insertNode via ModelEditor
 * Author: Luray He
 */ 
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ModelEditor, insertNode, buildNodeFromMetadata } from '../source/model-editor.js';
// some fake tensors
const activation = { name: 'act_in' };
const weight = { name: 'W', initializer: {} };
const bias = { name: 'B', initializer: {} };
const convOutput = { name: 'conv_out' };
// these three consts are operator definitions for what gets inserted
const absNodeSpec = {
    name: 'InsertedAbs',
    type: { name: 'Abs', identifier: 'Abs', module: 'ai.onnx', version: 1 },
    attributes: [],
    inputs: [{ name: 'X', value: [] }],
    outputs: [{ name: 'Y', value: [] }],
    min_input: 1,
    max_input: 1,
    min_output: 1,
    inputSchemas: [{ name: 'X' }]
};

const addSchema = {
    name: 'Add',
    module: 'ai.onnx',
    version: 13,
    inputs: [
        { name: 'A', type: 'T' },
        { name: 'B', type: 'T' }
    ],
    outputs: [{ name: 'C', type: 'T' }],
    min_input: 2,
    max_input: 2,
    min_output: 1,
    max_output: 1
};

const concatSchema = {
    name: 'Concat',
    module: 'ai.onnx',
    version: 13,
    inputs: [{ name: 'inputs', type: 'T', list: true }],
    outputs: [{ name: 'concat_result', type: 'T' }],
    min_input: 1,
    max_input: 2147483647,
    min_output: 1,
    max_output: 1
};
// This is a mini graph that will be used in tests
const convWithWeightsGraph = () => ({
    name: 'main',
    nodes: [{
        name: 'Conv1',
        type: { name: 'Conv', identifier: 'Conv', module: 'ai.onnx', version: 11 },
        attributes: [{ name: 'kernel_shape', type: 'int[]', value: [1, 1] }],
        inputs: [
            { name: 'X', value: [activation] },
            { name: 'W', value: [weight] },
            { name: 'B', value: [bias] }
        ],
        outputs: [{ name: 'Y', value: [convOutput] }]
    }]
});
// insertNode above tests
// Our code takes the dynamic input tensors from the reference node
// we connect new node's output to the refrence node's input slot
describe('insertNode above', () => {
    // An initializer is a tensor whose data embedded in the model: the weights, biases, constants. 
    // We make sure that these initializers are attached to the node it originally belonged to. 
    // It does not get rewired. 
    // splicing means to cut a connection and insert a new node into the middle of the wire. 
    it('splices only data inputs and preserves initializer inputs on the reference node', () => {
        const graph = convWithWeightsGraph();
        const conv = graph.nodes[0];
        const { node: absNode } = insertNode(graph, 0, 'above', absNodeSpec);

        assert.equal(absNode.inputs.length, 1);
        assert.equal(absNode.outputs.length, 1);
        assert.deepEqual(absNode.inputs[0].value, [activation]);
        assert.notEqual(absNode.inputs[0].value[0], conv.inputs[0].value[0]);

        assert.deepEqual(conv.inputs[1].value, [weight]);
        assert.deepEqual(conv.inputs[2].value, [bias]);
        assert.equal(conv.inputs[0].value[0], absNode.outputs[0].value[0]);
        assert.equal(conv.inputs[0].value[0].name, 'InsertedAbs_out_0');
    });
    // Unary chain: just one input and output for the chain
    // We inserted an abs node, and its input should be one, and its output should be the relu's input
    it('splices a unary chain when the reference node has no initializer inputs', () => {
        const graph = {
            name: 'main',
            nodes: [{
                name: 'Relu1',
                type: { name: 'Relu', identifier: 'Relu' },
                attributes: [],
                inputs: [{ name: 'X', value: [activation] }],
                outputs: [{ name: 'Y', value: [convOutput] }]
            }]
        };
        const relu = graph.nodes[0];
        const { node: absNode } = insertNode(graph, 0, 'above', absNodeSpec);

        assert.equal(absNode.inputs.length, 1);
        assert.deepEqual(absNode.inputs[0].value, [activation]);
        assert.equal(relu.inputs[0].value[0], absNode.outputs[0].value[0]);
    });

    // Add has two dynamic inpput, but Abs only has one input slot. 
    // The implementation must not try to splice both paths. 
    // Non-initializer inputs will be spliceTargets. 
    it('only splices the first data input when the reference node has multiple data inputs', () => {
        const branchB = { name: 'branch_b' };
        const graph = {
            name: 'main',
            nodes: [{
                name: 'Add1',
                type: { name: 'Add', identifier: 'Add', module: 'ai.onnx', version: 1 },
                attributes: [],
                inputs: [
                    { name: 'A', value: [activation] },
                    { name: 'B', value: [branchB] }
                ],
                outputs: [{ name: 'C', value: [convOutput] }]
            }]
        };
        const add = graph.nodes[0];
        const { node: absNode } = insertNode(graph, 0, 'above', absNodeSpec);

        assert.deepEqual(absNode.inputs[0].value, [activation]);
        assert.equal(add.inputs[0].value[0], absNode.outputs[0].value[0]);
        assert.deepEqual(add.inputs[1].value, [branchB]);
    });
    // This is if we are inserting a node below a reference node with multiple outputs 
    // Makes sure that we actually distribute the tensors across the argument slots in the properties
    it('distributes multiple tensors from one dynamic input across fixed-arity slots', () => {
        const branchB = { name: 'branch_b' };
        const graph = {
            name: 'main',
            nodes: [{
                name: 'Merge1',
                type: { name: 'Identity', identifier: 'Identity' },
                attributes: [],
                inputs: [{ name: 'X', value: [activation, branchB] }],
                outputs: [{ name: 'Y', value: [convOutput] }]
            }]
        };
        const merge = graph.nodes[0];
        const addSpec = buildNodeFromMetadata(addSchema, 'InsertedAdd', graph);
        const { node: addNode } = insertNode(graph, 0, 'above', addSpec);

        assert.equal(addNode.inputs.length, 2);
        assert.deepEqual(addNode.inputs[0].value, [activation]);
        assert.deepEqual(addNode.inputs[1].value, [branchB]);
        assert.equal(merge.inputs[0].value[0], addNode.outputs[0].value[0]);
    });
    // The existing add here has two proper inputs. 
    // When we add another add above the existing add, the two inputs should go to the new add and into the two argument slots
    it('keeps one tensor per slot when inserting above a properly wired binary node', () => {
        const branchB = { name: 'branch_b' };
        const graph = {
            name: 'main',
            nodes: [{
                name: 'Add1',
                type: { name: 'Add', identifier: 'Add', module: 'ai.onnx', version: 13 },
                attributes: [],
                inputs: [
                    { name: 'A', value: [activation] },
                    { name: 'B', value: [branchB] }
                ],
                outputs: [{ name: 'C', value: [convOutput] }]
            }]
        };
        const addSpec = buildNodeFromMetadata(addSchema, 'InsertedAdd', graph);
        const { node: addNode } = insertNode(graph, 0, 'above', addSpec);

        assert.deepEqual(addNode.inputs[0].value, [activation]);
        assert.deepEqual(addNode.inputs[1].value, [branchB]);
    });
    // We have an existing add in the mock graph. 
    // We inserta concat above add, which is a variadic operation that can take a lot of tensor connections 
    // insertNode gathers all dynamic tensors and puts it into a single input slot. 
    it('collects all dynamic tensors into a variadic list input', () => {
        const branchB = { name: 'branch_b' };
        const graph = {
            name: 'main',
            nodes: [{
                name: 'Add1',
                type: { name: 'Add', identifier: 'Add', module: 'ai.onnx', version: 13 },
                attributes: [],
                inputs: [
                    { name: 'A', value: [activation] },
                    { name: 'B', value: [branchB] }
                ],
                outputs: [{ name: 'C', value: [convOutput] }]
            }]
        };
        const concatSpec = buildNodeFromMetadata(concatSchema, 'InsertedConcat', graph);
        const { node: concatNode } = insertNode(graph, 0, 'above', concatSpec);

        assert.equal(concatNode.inputs.length, 1);
        assert.deepEqual(concatNode.inputs[0].value, [activation, branchB]);
    });
});
// tests for inserting nodes below. Will probably need to be rigorous, but for now, functionality is good enough
describe('insertNode below', () => {
    // Have two nodes in mock graph: Conv1 and Relu.
    // If we try to insert an abs node right below Conv, that'll lead to some issues since
    // conv has one activation output, and relu has one input. 
    // insertNode should not try to splice both paths. 
    // Non-initializer outputs will be spliceTargets. 
    it('still splices the activation output into downstream consumers', () => {
        const downstreamInput = { name: 'relu_in' };
        const graph = {
            name: 'main',
            nodes: [
                {
                    name: 'Conv1',
                    type: { name: 'Conv', identifier: 'Conv' },
                    attributes: [],
                    inputs: [{ name: 'X', value: [activation] }],
                    outputs: [{ name: 'Y', value: [convOutput] }]
                },
                {
                    name: 'Relu1',
                    type: { name: 'Relu', identifier: 'Relu' },
                    attributes: [],
                    inputs: [{ name: 'X', value: [convOutput] }],
                    outputs: [{ name: 'Y', value: [downstreamInput] }]
                }
            ]
        };
        const { node: absNode } = insertNode(graph, 0, 'below', absNodeSpec);

        assert.equal(graph.nodes.length, 3);
        assert.equal(absNode.inputs.length, 1);
        assert.deepEqual(absNode.inputs[0].value, [convOutput]);
        const relu = graph.nodes[2];
        assert.equal(relu.inputs[0].value[0], absNode.outputs[0].value[0]);
        assert.notEqual(relu.inputs[0].value[0], convOutput);
    });
});
// makes sure that apply patch works with insertions
// will need a test for insert below as well
describe('insertNode via ModelEditor', () => {
    it('preserves conv weights when inserting above through applyPatch', () => {
        const model = {
            format: 'ONNX',
            modules: [convWithWeightsGraph()]
        };
        const editor = ModelEditor.createSession(model);
        const absSpec = buildNodeFromMetadata({
            name: 'Abs',
            module: 'ai.onnx',
            version: 1,
            inputs: [{ name: 'X' }],
            outputs: [{ name: 'Y' }],
            min_input: 1,
            min_output: 1
        }, 'InsertedAbs', editor.modified.getGraph());

        editor.applyPatch({
            parentId: 'graph:0/node:0',
            entityType: 'node',
            changeType: 'add',
            property: 'insert',
            position: 'above',
            newValue: absSpec
        });

        const graph = editor.modified.getGraph();
        const absNode = graph.nodes[0];
        const conv = graph.nodes[1];

        assert.equal(absNode.type.name, 'Abs');
        assert.equal(absNode.inputs.length, 1);
        assert.equal(absNode.inputs[0].value[0].name, 'act_in');
        assert.equal(conv.inputs[1].value[0].name, 'W');
        assert.ok(conv.inputs[1].value[0].initializer);
        assert.equal(conv.inputs[2].value[0].name, 'B');
        assert.ok(conv.inputs[2].value[0].initializer);
        assert.equal(absNode.inputs.some((input) => input.value.some((value) => value.name === 'W')), false);
        assert.equal(conv.inputs[0].value[0], absNode.outputs[0].value[0]);
    });
});
