const inputValue = { name: 'input' };
const hiddenValue = { name: 'hidden' };
const outputValue = { name: 'output' };

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
