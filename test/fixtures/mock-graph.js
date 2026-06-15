const inputValue = { name: 'input', attributes: [] };
const hiddenValue = { name: 'hidden', attributes: [{ name: 'tag', type: 'string', value: 'intermediate' }] };
const outputValue = { name: 'output', attributes: [] };

export const mockModel = {
    format: 'Mock',
    modules: [{
        name: 'main',
        identifier: 'main',
        inputs: [{ name: 'input', value: inputValue }],
        outputs: [{ name: 'output', value: outputValue }],
        nodes: [
            {
                name: 'Conv1',
                type: { name: 'Conv', identifier: 'Conv' },
                attributes: [{ name: 'kernel_shape', type: 'int[]', value: [3, 3] }],
                inputs: [{ name: 'X', value: inputValue }],
                outputs: [{ name: 'Y', value: hiddenValue }]
            },
            {
                name: 'Relu1',
                type: { name: 'Relu', identifier: 'Relu' },
                attributes: [],
                inputs: [{ name: 'X', value: hiddenValue }],
                outputs: [{ name: 'Y', value: outputValue }]
            }
        ]
    }]
};

const chainInputValue = { name: 'input', attributes: [] };
const chainHidden1 = { name: 'hidden1', attributes: [] };
const chainHidden2 = { name: 'hidden2', attributes: [] };
const chainOutputValue = { name: 'output', attributes: [] };

export const mockChainModel = {
    format: 'Mock',
    modules: [{
        name: 'main',
        identifier: 'main',
        inputs: [{ name: 'input', value: chainInputValue }],
        outputs: [{ name: 'output', value: chainOutputValue }],
        nodes: [
            {
                name: 'Conv1',
                type: { name: 'Conv', identifier: 'Conv' },
                attributes: [],
                inputs: [{ name: 'X', value: chainInputValue }],
                outputs: [{ name: 'Y', value: chainHidden1 }]
            },
            {
                name: 'Relu1',
                type: { name: 'Relu', identifier: 'Relu' },
                attributes: [],
                inputs: [{ name: 'X', value: chainHidden1 }],
                outputs: [{ name: 'Y', value: chainHidden2 }]
            },
            {
                name: 'Softmax1',
                type: { name: 'Softmax', identifier: 'Softmax' },
                attributes: [],
                inputs: [{ name: 'X', value: chainHidden2 }],
                outputs: [{ name: 'Y', value: chainOutputValue }]
            }
        ]
    }]
};

const identityOpSchema = {
    name: 'Identity',
    module: 'ai.onnx',
    version: 1,
    inputs: [{ name: 'input' }],
    outputs: [{ name: 'output' }],
    min_input: 1,
    min_output: 1,
    attributes: []
};

export const identityNodeSpec = (name) => ({
    name,
    type: { name: 'Identity', identifier: 'Identity', module: 'ai.onnx', version: 1 },
    attributes: [],
    inputs: [{ name: 'input', value: [] }],
    outputs: [{ name: 'output', value: [] }]
});

export { identityOpSchema };
