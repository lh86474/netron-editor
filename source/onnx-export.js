
import './onnx-encode.js';
import { onnx } from './onnx-proto.js';
import { BinaryReader } from './protobuf.js';
import { enumerateGraphValues } from './model-editor.js';

export class OnnxExportError extends Error {

    constructor(message) {
        super(message);
        this.name = 'ONNX Export Error';
    }
}

const dataTypeByName = new Map([
    ['undefined', 0], ['float32', 1], ['uint8', 2], ['int8', 3], ['uint16', 4], ['int16', 5],
    ['int32', 6], ['int64', 7], ['string', 8], ['boolean', 9], ['float16', 10], ['float64', 11],
    ['uint32', 12], ['uint64', 13], ['complex<float32>', 14], ['complex<float64>', 15], ['bfloat16', 16]
]);

const attributeTypeMap = {
    'float32': { type: 1, field: 'f' },
    'float': { type: 1, field: 'f' },
    'float64': { type: 1, field: 'f' },
    'int64': { type: 2, field: 'i' },
    'int': { type: 2, field: 'i' },
    'int32': { type: 2, field: 'i' },
    'string': { type: 3, field: 's' },
    'float32[]': { type: 6, field: 'floats' },
    'float[]': { type: 6, field: 'floats' },
    'int64[]': { type: 7, field: 'ints' },
    'int[]': { type: 7, field: 'ints' },
    'string[]': { type: 8, field: 'strings' }
};

const referenceName = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && typeof value.name === 'string') {
        return value.name;
    }
    return '';
};

const parseEntityId = (entityId) => {
    const nodeMatch = /^graph:(\d+)\/node:(\d+)(?:\/attr:(\d+))?$/.exec(entityId);
    if (nodeMatch) {
        return {
            graphIndex: Number(nodeMatch[1]),
            nodeIndex: Number(nodeMatch[2]),
            attributeIndex: nodeMatch[3] !== undefined ? Number(nodeMatch[3]) : null
        };
    }
    const valueMatch = /^graph:(\d+)\/value:(\d+)$/.exec(entityId);
    if (valueMatch) {
        return {
            graphIndex: Number(valueMatch[1]),
            valueIndex: Number(valueMatch[2])
        };
    }
    return null;
};

const cloneModelProto = (model) => {
    const bytes = onnx.ModelProto.encodeBytes(model);
    return onnx.ModelProto.decode(BinaryReader.open(bytes));
};

const encodeText = (value) => new TextEncoder().encode(value);

const buildAttributeProto = (name, type, value) => {
    const mapping = attributeTypeMap[type] || attributeTypeMap['string'];
    const attribute = new onnx.AttributeProto();
    attribute.name = name;
    attribute.type = mapping.type;
    if (mapping.field === 's') {
        attribute.s = encodeText(String(value));
    } else if (mapping.field === 'f') {
        attribute.f = Number(value);
    } else if (mapping.field === 'i') {
        attribute.i = typeof value === 'bigint' ? value : BigInt(value);
    } else if (mapping.field === 'floats') {
        attribute.floats = Array.isArray(value) ? value.map((item) => Number(item)) : [];
    } else if (mapping.field === 'ints') {
        attribute.ints = Array.isArray(value) ? value.map((item) => typeof item === 'bigint' ? item : BigInt(item)) : [];
    } else if (mapping.field === 'strings') {
        attribute.strings = Array.isArray(value) ? value.map((item) => encodeText(String(item))) : [];
    } else {
        throw new OnnxExportError(`Unsupported attribute type '${type}' for export.`);
    }
    return attribute;
};

const parseTensorTypeString = (typeString) => {
    if (!typeString || typeof typeString !== 'string') {
        throw new OnnxExportError('Value type is required for export.');
    }
    const bracket = typeString.indexOf('[');
    const dataTypeName = bracket === -1 ? typeString.trim() : typeString.slice(0, bracket).trim();
    const elemType = dataTypeByName.get(dataTypeName.toLowerCase());
    if (elemType === undefined) {
        throw new OnnxExportError(`Unsupported value type '${typeString}' for export.`);
    }
    const type = new onnx.TypeProto();
    const tensor = new onnx.TypeProto.Tensor();
    tensor.elem_type = elemType;
    if (bracket !== -1 && typeString.endsWith(']')) {
        const shape = new onnx.TensorShapeProto();
        const inner = typeString.slice(bracket + 1, -1).trim();
        if (inner.length > 0) {
            for (const part of inner.split(',')) {
                const trimmed = part.trim();
                const dimension = new onnx.TensorShapeProto.Dimension();
                if (/^\d+$/.test(trimmed)) {
                    dimension.dim_value = BigInt(trimmed);
                } else {
                    dimension.dim_param = trimmed;
                }
                shape.dim.push(dimension);
            }
        }
        tensor.shape = shape;
    }
    type.tensor_type = tensor;
    return type;
};

const normalizeGraphReferences = (graph) => {
    for (const node of graph.node || []) {
        node.input = (node.input || []).map(referenceName);
        node.output = (node.output || []).map(referenceName);
    }
};

const renameInGraph = (graph, oldName, newName) => {
    if (!oldName || oldName === newName) {
        return;
    }
    const replace = (name) => referenceName(name) === oldName ? newName : referenceName(name);
    for (const node of graph.node || []) {
        node.input = (node.input || []).map(replace);
        node.output = (node.output || []).map(replace);
    }
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value.name === oldName) {
                value.name = newName;
            }
        }
    }
    for (const tensor of graph.initializer || []) {
        if (tensor.name === oldName) {
            tensor.name = newName;
        }
    }
    for (const tensor of graph.sparse_initializer || []) {
        if (tensor.values && tensor.values.name === oldName) {
            tensor.values.name = newName;
        }
        if (tensor.indices && tensor.indices.name === oldName) {
            tensor.indices.name = newName;
        }
    }
    for (const annotation of graph.quantization_annotation || []) {
        if (annotation.tensor_name === oldName) {
            annotation.tensor_name = newName;
        }
    }
};

const findValueInfo = (graph, name) => {
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value.name === name) {
                return value;
            }
        }
    }
    return null;
};

const collectGraphNames = (graph) => {
    const names = new Set();
    for (const node of graph.node || []) {
        for (const name of node.input || []) {
            names.add(name);
        }
        for (const name of node.output || []) {
            names.add(name);
        }
    }
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value.name) {
                names.add(value.name);
            }
        }
    }
    for (const tensor of graph.initializer || []) {
        if (tensor.name) {
            names.add(tensor.name);
        }
    }
    return names;
};

const validateGraph = (graph) => {
    const available = new Set();
    for (const value of graph.input || []) {
        if (value.name) {
            available.add(value.name);
        }
    }
    for (const tensor of graph.initializer || []) {
        if (tensor.name) {
            available.add(tensor.name);
        }
    }
    for (const tensor of graph.sparse_initializer || []) {
        if (tensor.values && tensor.values.name) {
            available.add(tensor.values.name);
        }
        if (tensor.indices && tensor.indices.name) {
            available.add(tensor.indices.name);
        }
    }
    for (const node of graph.node || []) {
        if (!node.op_type) {
            throw new OnnxExportError(`Node '${node.name || '(unnamed)'}' is missing op_type.`);
        }
        for (const input of node.input || []) {
            const inputName = referenceName(input);
            if (inputName && !available.has(inputName)) {
                throw new OnnxExportError(`Dangling input reference '${inputName}' on node '${node.name || node.op_type}'.`);
            }
        }
        for (const output of node.output || []) {
            const outputName = referenceName(output);
            if (outputName) {
                available.add(outputName);
            }
        }
        const attributeNames = new Set();
        for (const attribute of node.attribute || []) {
            if (!attribute.name) {
                throw new OnnxExportError(`Node '${node.name || node.op_type}' has an attribute without a name.`);
            }
            if (attributeNames.has(attribute.name)) {
                throw new OnnxExportError(`Duplicate attribute '${attribute.name}' on node '${node.name || node.op_type}'.`);
            }
            attributeNames.add(attribute.name);
        }
    }
};

const validateModel = (model) => {
    if (!model.graph) {
        throw new OnnxExportError('Model has no graph to export.');
    }
    validateGraph(model.graph);
    for (const func of model.functions || []) {
        for (const node of func.node || []) {
            if (!node.op_type) {
                throw new OnnxExportError(`Function '${func.name}' contains a node without op_type.`);
            }
        }
    }
};

const applyAttributeChanges = (graph, originalProto, editSession, changes) => {
    const deletes = [];
    const modifications = [];
    const additions = [];
    for (const change of changes) {
        if (change.entityType !== 'attribute') {
            continue;
        }
        if (change.changeType === 'delete') {
            deletes.push(change);
        } else if (change.changeType === 'add') {
            additions.push(change);
        } else {
            modifications.push(change);
        }
    }
    for (const change of deletes) {
        const location = parseEntityId(change.entityId);
        const originalNode = originalProto.graph.node[location.nodeIndex];
        const originalAttribute = (originalNode.attribute || [])[location.attributeIndex];
        if (originalAttribute && originalAttribute.name) {
            const node = graph.node[location.nodeIndex];
            node.attribute = (node.attribute || []).filter((attribute) => attribute.name !== originalAttribute.name);
        }
    }
    for (const change of modifications) {
        const location = parseEntityId(change.entityId);
        const node = graph.node[location.nodeIndex];
        const attribute = node.attribute[location.attributeIndex];
        if (!attribute) {
            continue;
        }
        const modifiedNode = editSession.modified.getGraph(location.graphIndex).nodes[location.nodeIndex];
        const modifiedAttribute = (modifiedNode.attributes || [])[location.attributeIndex];
        const attributeType = change.attributeType || (modifiedAttribute && modifiedAttribute.type) || 'string';
        const rebuilt = buildAttributeProto(attribute.name, attributeType, change.newValue);
        node.attribute[location.attributeIndex] = rebuilt;
    }
    for (const change of additions) {
        const parentId = change.parentId || change.entityId.replace(/\/attr:\d+$/, '');
        const location = parseEntityId(parentId);
        const node = graph.node[location.nodeIndex];
        const property = change.property || '';
        const name = property.startsWith('attributes.') ? property.slice('attributes.'.length) : property;
        const modifiedNode = editSession.modified.getGraph(location.graphIndex).nodes[location.nodeIndex];
        const modifiedAttribute = (modifiedNode.attributes || []).find((entry) => entry.name === name);
        const attributeType = change.attributeType || (modifiedAttribute && modifiedAttribute.type) || 'string';
        const attribute = buildAttributeProto(name, attributeType, change.newValue);
        node.attribute = node.attribute || [];
        node.attribute.push(attribute);
    }
};

const applyChanges = (cloned, originalProto, editSession) => {
    const graph = cloned.graph;
    const changes = editSession.delta.getChanges();

    for (const change of changes) {
        if (change.entityType === 'node' && change.property === 'name') {
            const location = parseEntityId(change.entityId);
            graph.node[location.nodeIndex].name = change.newValue;
        }
    }

    applyAttributeChanges(graph, originalProto, editSession, changes);

    const valueRenames = new Map();
    for (const change of changes) {
        if (change.entityType !== 'value') {
            continue;
        }
        const location = parseEntityId(change.entityId);
        if (change.property === 'name') {
            const originalName = change.oldValue;
            if (originalName && change.newValue && originalName !== change.newValue) {
                valueRenames.set(originalName, change.newValue);
            }
        } else if (change.property === 'type') {
            const modifiedGraph = editSession.modified.getGraph(location.graphIndex);
            let currentName = null;
            for (const [value, valueId] of enumerateGraphValues(modifiedGraph, location.graphIndex)) {
                if (valueId === change.entityId) {
                    currentName = value.name;
                    break;
                }
            }
            if (!currentName) {
                throw new OnnxExportError(`Value '${change.entityId}' not found for type export.`);
            }
            let valueInfo = findValueInfo(graph, currentName);
            if (!valueInfo) {
                valueInfo = new onnx.ValueInfoProto();
                valueInfo.name = currentName;
                graph.value_info = graph.value_info || [];
                graph.value_info.push(valueInfo);
            }
            valueInfo.type = parseTensorTypeString(change.newValue);
        } else if (change.property === 'description') {
            const modifiedGraph = editSession.modified.getGraph(location.graphIndex);
            let currentName = null;
            for (const [value, valueId] of enumerateGraphValues(modifiedGraph, location.graphIndex)) {
                if (valueId === change.entityId) {
                    currentName = value.name;
                    break;
                }
            }
            if (!currentName) {
                throw new OnnxExportError(`Value '${change.entityId}' not found for description export.`);
            }
            let valueInfo = findValueInfo(graph, currentName);
            if (!valueInfo) {
                valueInfo = new onnx.ValueInfoProto();
                valueInfo.name = currentName;
                graph.value_info = graph.value_info || [];
                graph.value_info.push(valueInfo);
            }
            valueInfo.doc_string = change.newValue;
        }
    }

    for (const [oldName, newName] of valueRenames) {
        if (collectGraphNames(graph).has(newName)) {
            throw new OnnxExportError(`Cannot rename '${oldName}' to '${newName}' because the name already exists.`);
        }
        renameInGraph(graph, oldName, newName);
    }
};

export const canExportOnnx = (model) => {
    return model && model.exportable === true;
};

export const exportModifiedOnnx = (model, editSession) => {
    if (!canExportOnnx(model)) {
        throw new OnnxExportError('This model cannot be exported as ONNX.');
    }
    if (!editSession) {
        throw new OnnxExportError('No editor session is available for export.');
    }
    const proto = model.proto;
    if (!proto) {
        throw new OnnxExportError('Original ONNX protobuf is not available for export.');
    }
    const cloned = cloneModelProto(proto);
    normalizeGraphReferences(cloned.graph);
    applyChanges(cloned, proto, editSession);
    validateModel(cloned);
    return onnx.ModelProto.encodeBytes(cloned);
};
