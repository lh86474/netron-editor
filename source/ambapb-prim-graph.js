/*
 * This file is for parsing, serializing, and validating the prim_graph JSON
 * Also includes tensor encoding helpers
 * reuse validatePrimGraph, parseGraphJson to export fails on bad JSON
 * Author: Luray He
 */
// 
import { onnx } from './onnx-proto.js';

export const PRIM_GRAPH_ATTRIBUTE_NAME = 'prim_graph';
export class AmbapbParseError extends Error {

    constructor(message) {
        super(message);
        this.name = 'AmbapbParseError';
    }
}

const textDecoder = new TextDecoder('utf-8');

// Protobuf decoding is inconsistent at the edges. Sometimes
// I have Uint8Array, sometimes JS string, sometimes nothing. 
// value is not a fixed thing. It is whatever payload decodeEntryBytes receives from two different ONNX/protobuf fields
const decodeEntryBytes = (value) => {
    if (value === null || value === undefined) {
        return new Uint8Array(0);
    }
    if (value instanceof Uint8Array) {
        return value;
    }
    if (typeof value === 'string') {
        return textDecoder.encode(value);
    }
    // Not string or Uint8Array, return empty array
    return new Uint8Array(0);
};
// This is the other way around. We want to decode to a string. 
const decodeText = (input) => {
    if (typeof input === 'string') {
        return input;
    }
    if (input instanceof Uint8Array) {
        return textDecoder.decode(input);
    }
    if (input && typeof input === 'object' && input.raw_data instanceof Uint8Array) {
        return textDecoder.decode(input.raw_data);
    }
    if (input && typeof input === 'object' && Array.isArray(input.string_data) && input.string_data.length > 0) {
        const entry = input.string_data[0];
        return typeof entry === 'string' ? entry : textDecoder.decode(entry);
    }
    throw new AmbapbParseError('Unsupported prim_graph payload type.');
};

// Attributes are a map of string keys to string values.
// We normalize them to a map of string keys to string values.
// We also convert null and undefined to empty strings.
const normalizeAttributes = (attributes) => {
    const normalized = {};
    if (!attributes || typeof attributes !== 'object') {
        return normalized;
    }
    for (const [key, value] of Object.entries(attributes)) {
        normalized[key] = value === null || value === undefined ? '' : String(value);
    }
    return normalized;
};

// Oports are a list of objects with id, dataFormat, dimension, and additionalDepPrimIds.
// We normalize them to a list of objects with id, dataFormat, dimension, and additionalDepPrimIds.
// We also convert null and undefined to empty strings.
const normalizeOport = (oport) => {
    return {
        id: oport.id || '',
        dataFormat: oport['data-format'] || null,
        dimension: oport.dimension || null,
        additionalDepPrimIds: Array.isArray(oport['additional-dep-prim-ids']) ?
            oport['additional-dep-prim-ids'].slice() :
            [],
        raw: oport
    };
};


const normalizeSource = (source) => {
    return {
        id: source.id || '',
        port: typeof source.port === 'number' ? source.port : Number(source.port || 0)
    };
};

const normalizePrimitive = (entry) => {
    if (!entry || typeof entry !== 'object') {
        throw new AmbapbParseError('Invalid primitive entry.');
    }
    if (!entry.id || !entry.type) {
        throw new AmbapbParseError('Primitive entry is missing id or type.');
    }
    return {
        id: entry.id,
        mangledId: entry['mangled-id'] || entry.id,
        type: entry.type,
        vasSequenceNumber: entry['vas-sequence-number'],
        fragmentId: entry['fragment-id'] || '',
        oports: Array.isArray(entry.oports) ? entry.oports.map(normalizeOport) : [],
        attributes: normalizeAttributes(entry.attributes),
        sources: Array.isArray(entry.sources) ? entry.sources.map(normalizeSource) : [],
        raw: entry
    };
};

// prim_graph JSON stores a list of primitives.
// we want to turn it into normalized primitives
export const parsePrimGraphJson = (bytesOrText) => {
    let text = '';
    try {
        text = decodeText(bytesOrText);
    } catch (error) {
        throw error instanceof AmbapbParseError ? error : new AmbapbParseError(error.message);
    }
    let raw = null;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new AmbapbParseError(`Invalid prim_graph JSON (${error.message}).`);
    }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.primitives)) {
        throw new AmbapbParseError('prim_graph JSON must contain a primitives array.');
    }
    const primitives = raw.primitives.map(normalizePrimitive);
    return { primitives, raw };
};

export const parsePrimGraphFromAttribute = (attribute) => {
    if (!attribute || !attribute.t) {
        throw new AmbapbParseError('prim_graph attribute is missing tensor data.');
    }
    return parsePrimGraphJson(attribute.t);
};

export const serializePrimGraphJson = (primGraph) => {
    if (!primGraph || !primGraph.raw) {
        throw new AmbapbParseError('primGraph.raw is required for serialization.');
    }
    return JSON.stringify(primGraph.raw);
};

export const cloneDims = (dims) => { 
    if (!Array.isArray(dims) || dims.length === 0) {
        return [];
    }
    return dims.map((dim) => typeof dim === 'bigint' ? dim: BigInt(dim));
};

export const encodePrimGraphTensor = (jsonText, originalTensor = null) => {
    const bytes = new TextEncoder().encode(jsonText);
    const tensor = new onnx.TensorProto();
    if (originalTensor) {
        tensor.data_type = originalTensor.data_type ?? onnx.TensorProto.DataType.UINT8;
        tensor.data_location = originalTensor.data_location ?? 0;
        if (originalTensor.name) {
            tensor.name = originalTensor.name;
        }
        if (originalTensor.doc_string) {
            tensor.doc_string = originalTensor.doc_string;
        }
        const dims = cloneDims(originalTensor.dims);
        if (dims.length === 1) {
            tensor.dims = [BigInt(bytes.length)];
        } else if (dims.length > 0) {
            tensor.dims = dims;
        } else {
            tensor.dims = [BigInt(bytes.length)];
        }
    } else {
        tensor.data_type = onnx.TensorProto.DataType.UINT8;
        tensor.data_location = 0;
        tensor.dims = [BigInt(bytes.length)];
    }
    tensor.raw_data = bytes;
    return tensor;
};
export const buildPrimGraphAttributeProto = (jsonText, originalAttribute = null) => {
    const primGraph = parsePrimGraphJson(jsonText);
    const validation = validatePrimGraph(primGraph.primitives);
    if (!validation.ok) {
        throw new AmbapbParseError(validation.errors.join('\n'));
    }
    const canonicalJson = JSON.stringify(primGraph.raw);
    const attribute = new onnx.AttributeProto();
    attribute.name = PRIM_GRAPH_ATTRIBUTE_NAME;
    attribute.type = onnx.AttributeProto.AttributeType.TENSOR;
    const originalTensor = originalAttribute && originalAttribute.t ? originalAttribute.t : null;
    attribute.t = encodePrimGraphTensor(canonicalJson, originalTensor);
    return attribute;
};

const copyTensorEntry = (tensor) => {
    return {
        dims: Array.isArray(tensor.dims) ? tensor.dims.map((dim) => typeof dim === 'bigint' ? dim : BigInt(dim)) : [],
        dataType: tensor.data_type ?? tensor.dataType ?? 0,
        rawData: tensor.raw_data instanceof Uint8Array ? tensor.raw_data.slice() : decodeEntryBytes(tensor.raw_data)
    };
};

const decodeStringEntry = (entry) => {
    if (typeof entry === 'string') {
        return entry;
    }
    if (entry instanceof Uint8Array) {
        return textDecoder.decode(entry);
    }
    return '';
};

export const parsePrimGraphImms = (attribute) => {
    if (!attribute) {
        return { entries: [], encoding: 'none' };
    }
    if (Array.isArray(attribute.strings) && attribute.strings.length > 0) {
        return {
            encoding: 'strings',
            entries: attribute.strings.map((entry) => ({
                text: decodeStringEntry(entry),
                bytes: decodeEntryBytes(entry)
            }))
        };
    }
    if (Array.isArray(attribute.tensors) && attribute.tensors.length > 0) {
        return {
            encoding: 'tensors',
            entries: attribute.tensors.map(copyTensorEntry)
        };
    }
    return { entries: [], encoding: 'none' };
};

// from sources and oport additional-dep-prim-ids
// I'm going to remove this feature since this originally, our plan
// was to visualize prim_graph as an actual rendered graph, but
export const buildDependencyGraph = (primitives) => {
    const graph = new Map();
    const ensureEntry = (id) => {
        if (!graph.has(id)) {
            graph.set(id, { producers: [], consumers: [] });
        }
        return graph.get(id);
    };
    for (const primitive of primitives || []) {
        ensureEntry(primitive.id);
    }
    for (const primitive of primitives || []) {
        const entry = ensureEntry(primitive.id);
        const producers = [];
        for (const source of primitive.sources || []) {
            if (!source.id) {
                continue;
            }
            producers.push(source.id);
            ensureEntry(source.id).consumers.push(primitive.id);
        }
        for (const oport of primitive.oports || []) {
            for (const depId of oport.additionalDepPrimIds || []) {
                if (!depId) {
                    continue;
                }
                producers.push(depId);
                ensureEntry(depId).consumers.push(primitive.id);
            }
        }
        entry.producers = [...new Set(producers)];
    }
    return graph;
};

export const enumeratePrimPorts = (primitives) => {
    const ports = new Map();
    for (const primitive of primitives || []) {
        for (let index = 0; index < (primitive.oports || []).length; index++) {
            const oport = primitive.oports[index];
            const key = `${primitive.id}:${index}`;
            ports.set(key, { primitive, oportIndex: index, oport });
            if (oport.id) {
                ports.set(`${primitive.id}/${oport.id}`, { primitive, oportIndex: index, oport });
            }
        }
    }
    return ports;
};
// set to make sure all primitives have unique ids
export const validatePrimGraph = (primitives) => {
    const errors = [];
    const ids = new Set();
    for (const primitive of primitives || []) {
        if (ids.has(primitive.id)) {
            errors.push(`Duplicate primitive id '${primitive.id}'.`);
        }
        ids.add(primitive.id);
    }
    const graph = buildDependencyGraph(primitives);
    for (const primitive of primitives || []) {
        for (const source of primitive.sources || []) {
            if (source.id && !ids.has(source.id)) {
                errors.push(`Primitive '${primitive.id}' references missing source '${source.id}'.`);
            }
        }
        for (const oport of primitive.oports || []) {
            for (const depId of oport.additionalDepPrimIds || []) {
                if (depId && !ids.has(depId)) {
                    errors.push(`Primitive '${primitive.id}' references missing dependency '${depId}'.`);
                }
            }
        }
        if (primitive.type !== 'input' && (primitive.sources || []).length === 0 &&
            !(primitive.oports || []).some((oport) => (oport.additionalDepPrimIds || []).length > 0)) {
            errors.push(`Primitive '${primitive.id}' has no producers.`);
        }
        if (!graph.has(primitive.id)) {
            errors.push(`Primitive '${primitive.id}' is missing from dependency graph.`);
        }
    }
    return {
        ok: errors.length === 0,
        errors
    };
};
