/* This file gets data from onnx-metadata.json and validates the node insert plan. 
 * Will throw error if needed
 * Author: Luray He
 */
import { planNodeInsert } from './model-editor.js';

const DATA_TYPE_TO_ONNX = new Map([
    ['float32', 'tensor(float)'],
    ['float', 'tensor(float)'],
    ['float64', 'tensor(double)'],
    ['double', 'tensor(double)'],
    ['float16', 'tensor(float16)'],
    ['bfloat16', 'tensor(bfloat16)'],
    ['boolean', 'tensor(bool)'],
    ['bool', 'tensor(bool)'],
    ['int8', 'tensor(int8)'],
    ['int16', 'tensor(int16)'],
    ['int32', 'tensor(int32)'],
    ['int64', 'tensor(int64)'],
    ['uint8', 'tensor(uint8)'],
    ['uint16', 'tensor(uint16)'],
    ['uint32', 'tensor(uint32)'],
    ['uint64', 'tensor(uint64)'],
    ['string', 'tensor(string)'],
    ['complex64', 'tensor(complex64)'],
    ['complex128', 'tensor(complex128)']
]);

const normalizeOnnxType = (type) => {
    if (!type || typeof type !== 'string') {
        return null;
    }
    const trimmed = type.trim();
    if (trimmed.startsWith('tensor(')) {
        return trimmed;
    }
    const mapped = DATA_TYPE_TO_ONNX.get(trimmed.toLowerCase());
    if (mapped) {
        return mapped;
    }
    return `tensor(${trimmed})`;
};

const valueTypeToOnnx = (type) => {
    if (type === null || type === undefined) {
        return null;
    }
    if (typeof type === 'string') {
        const base = type.split('[')[0];
        return normalizeOnnxType(base);
    }
    if (typeof type === 'object') {
        if (typeof type.toString === 'function') {
            const text = type.toString();
            if (text && text !== '[object Object]') {
                return valueTypeToOnnx(text);
            }
        }
        if (type.dataType) {
            return valueTypeToOnnx(type.dataType);
        }
    }
    return null;
};

const isOptionalSchemaInput = (schemaInput) => schemaInput && schemaInput.option === 'optional';

const isInputConnected = (input) => Array.isArray(input.value) && input.value.length > 0;

const findTypeConstraint = (opSchema, typeParam) => {
    if (!typeParam || !Array.isArray(opSchema.type_constraints)) {
        return null;
    }
    return opSchema.type_constraints.find((entry) => entry.type_param_str === typeParam) || null;
};

const typeMatchesConstraint = (actualType, constraint) => {
    if (!actualType || !constraint || !Array.isArray(constraint.allowed_type_strs)) {
        return true;
    }
    return constraint.allowed_type_strs.includes(actualType);
};

const formatTypeList = (types) => types.join(', ');

export const validateNodeInsert = (graph, refNodeIndex, position, opSchema, nodeSpec) => {
    const issues = [];
    const plan = planNodeInsert(graph, refNodeIndex, position, nodeSpec);
    const schemaInputs = opSchema.inputs || [];
    const minInputs = opSchema.min_input !== undefined ? opSchema.min_input :
        Math.max(schemaInputs.length, 1);
    const connectedCount = plan.inputs.filter(isInputConnected).length;
    const operatorName = opSchema.name || nodeSpec.type?.name || 'operator';
    const refName = plan.refNode.name || plan.refNode.type?.name || 'node';
    const positionLabel = position === 'above' ? 'above' : 'below';

    if (connectedCount < minInputs) {
        issues.push({
            severity: 'error',
            code: 'INSUFFICIENT_INPUTS',
            message: `${operatorName} requires at least ${minInputs} connected input(s), but only ${connectedCount} will be connected when inserted ${positionLabel} ${refName}.`
        });
    }

    for (let index = 0; index < plan.inputs.length; index++) {
        const input = plan.inputs[index];
        const schemaInput = schemaInputs[index];
        if (isInputConnected(input)) {
            continue;
        }
        if (isOptionalSchemaInput(schemaInput)) {
            continue;
        }
        issues.push({
            severity: 'error',
            code: 'UNCONNECTED_INPUT',
            message: `Input '${input.name}' of ${operatorName} will be unconnected after insert ${positionLabel} ${refName}.`
        });
    }

    if (opSchema.max_input !== undefined && connectedCount > opSchema.max_input) {
        issues.push({
            severity: 'warning',
            code: 'TOO_MANY_INPUTS',
            message: `${operatorName} accepts at most ${opSchema.max_input} input(s), but ${connectedCount} will be connected.`
        });
    }

    for (let index = 0; index < plan.inputs.length; index++) {
        const input = plan.inputs[index];
        if (!isInputConnected(input)) {
            continue;
        }
        const schemaInput = schemaInputs[index];
        const typeParam = schemaInput ? schemaInput.type : null;
        const constraint = findTypeConstraint(opSchema, typeParam);
        if (!constraint) {
            continue;
        }
        const sourceValue = input.value[0];
        const actualType = valueTypeToOnnx(sourceValue && sourceValue.type);
        if (!actualType) {
            continue;
        }
        if (!typeMatchesConstraint(actualType, constraint)) {
            issues.push({
                severity: 'warning',
                code: 'TYPE_MISMATCH',
                message: `Input '${input.name}' of ${operatorName} expects ${formatTypeList(constraint.allowed_type_strs)}, but upstream type appears to be ${actualType}.`
            });
        }
    }

    for (const attribute of opSchema.attributes || []) {
        if (!attribute.required || attribute.default !== undefined) {
            continue;
        }
        const hasAttribute = (nodeSpec.attributes || []).some((entry) => entry.name === attribute.name);
        if (!hasAttribute) {
            issues.push({
                severity: 'warning',
                code: 'MISSING_REQUIRED_ATTRIBUTE',
                message: `${operatorName} requires attribute '${attribute.name}' which is not set.`
            });
        }
    }

    return { issues };
};
