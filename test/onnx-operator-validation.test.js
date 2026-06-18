/* 
 * This file contains tests for the validateNodeInsert function
 * We make sure that we actually show errors and warnings when we should
 * Author: Luray He
 */ 
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeFromMetadata } from '../source/model-editor.js';
import { validateNodeInsert } from '../source/onnx-operator-validation.js';

const activation = { name: 'act_in', type: 'float32' };
const convOutput = { name: 'conv_out', type: 'float32' };

// Mock schemas
const andSchema = {
    name: 'And',
    module: 'ai.onnx',
    version: 7,
    inputs: [
        { name: 'A', type: 'T' },
        { name: 'B', type: 'T' }
    ],
    outputs: [{ name: 'C', type: 'T1' }],
    min_input: 2,
    max_input: 2,
    min_output: 1,
    max_output: 1,
    type_constraints: [
        {
            type_param_str: 'T',
            allowed_type_strs: ['tensor(bool)']
        },
        {
            type_param_str: 'T1',
            allowed_type_strs: ['tensor(bool)']
        }
    ]
};

const absSchema = {
    name: 'Abs',
    module: 'ai.onnx',
    version: 6,
    inputs: [{ name: 'X', type: 'T' }],
    outputs: [{ name: 'Y', type: 'T' }],
    min_input: 1,
    max_input: 1,
    min_output: 1,
    max_output: 1,
    type_constraints: [
        {
            type_param_str: 'T',
            allowed_type_strs: ['tensor(float)', 'tensor(double)', 'tensor(float16)']
        }
    ]
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
    max_output: 1,
    type_constraints: [
        {
            type_param_str: 'T',
            allowed_type_strs: ['tensor(float)', 'tensor(double)', 'tensor(float16)']
        }
    ]
};

const reluGraph = () => ({
    name: 'main',
    nodes: [{
        name: 'Relu1',
        type: { name: 'Relu', identifier: 'Relu', module: 'ai.onnx', version: 6 },
        attributes: [],
        inputs: [{ name: 'X', value: [activation] }],
        outputs: [{ name: 'Y', value: [convOutput] }]
    }]
});

describe('validateNodeInsert', () => {
    // Makes sure that we detect 0 issues
    it('reports no issues for Abs above a unary node', () => {
        const graph = reluGraph();
        const nodeSpec = buildNodeFromMetadata(absSchema, 'InsertedAbs', graph);
        const { issues } = validateNodeInsert(graph, 0, 'above', absSchema, nodeSpec);
        assert.equal(issues.length, 0);
    });

    // We inserrt an add below a relu, an issue since and requires 2 inputs
    // We make sure that for issues, we have the correct code and severity
    it('warns when inserting And below a unary node', () => {
        const graph = reluGraph();
        const nodeSpec = buildNodeFromMetadata(andSchema, 'InsertedAnd', graph);
        const { issues } = validateNodeInsert(graph, 0, 'below', andSchema, nodeSpec);
        assert.ok(issues.some((issue) => issue.code === 'INSUFFICIENT_INPUTS'));
        assert.ok(issues.some((issue) => issue.code === 'UNCONNECTED_INPUT'));
    });

    // compare a connected input's tensor type to the ONNX op's type constraints
    // but they don't match
    // Relu output is convOutput with type float32. It's a tensor(float)
    // And's constraint for T allows only tensor(bool)
    it('warns about type mismatch for And on float tensors', () => {
        const graph = reluGraph();
        const nodeSpec = buildNodeFromMetadata(andSchema, 'InsertedAnd', graph);
        const { issues } = validateNodeInsert(graph, 0, 'below', andSchema, nodeSpec);
        assert.ok(issues.some((issue) => issue.code === 'TYPE_MISMATCH'));
    });
    // Because and requires 2 inputs
    it('warns when inserting And above a node with one dynamic input', () => {
        const graph = reluGraph();
        const nodeSpec = buildNodeFromMetadata(andSchema, 'InsertedAnd', graph);
        const { issues } = validateNodeInsert(graph, 0, 'above', andSchema, nodeSpec);
        assert.ok(issues.some((issue) => issue.code === 'INSUFFICIENT_INPUTS'));
        assert.ok(issues.some((issue) => issue.code === 'UNCONNECTED_INPUT'));
    });
    // When we actually have two tensors in one slot, we should not have any issues
    it('reports no input issues when Add above a node with two tensors in one slot', () => {
        const branchB = { name: 'branch_b', type: 'float32' };
        const graph = {
            name: 'main',
            nodes: [{
                name: 'Merge1',
                type: { name: 'Identity', identifier: 'Identity', module: 'ai.onnx', version: 1 },
                attributes: [],
                inputs: [{ name: 'X', value: [activation, branchB] }],
                outputs: [{ name: 'Y', value: [convOutput] }]
            }]
        };
        const nodeSpec = buildNodeFromMetadata(addSchema, 'InsertedAdd', graph);
        const { issues } = validateNodeInsert(graph, 0, 'above', addSchema, nodeSpec);
        // issues.length === 0 could work as well, but this is more explicit
        assert.equal(issues.some((issue) => issue.code === 'INSUFFICIENT_INPUTS'), false);
        assert.equal(issues.some((issue) => issue.code === 'UNCONNECTED_INPUT'), false);
        assert.equal(issues.some((issue) => issue.code === 'MULTIPLE_VALUES_IN_SLOT'), false);
    });
});
