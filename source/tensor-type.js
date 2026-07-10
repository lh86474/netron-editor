export class TensorTypeError extends Error {

    constructor(message) {
        super(message);
        this.name = 'Tensor Type Error';
    }
}

export const tensorDataTypeByName = new Map([
    ['undefined', 0], ['float32', 1], ['uint8', 2], ['int8', 3], ['uint16', 4], ['int16', 5],
    ['int32', 6], ['int64', 7], ['string', 8], ['boolean', 9], ['float16', 10], ['float64', 11],
    ['uint32', 12], ['uint64', 13], ['complex<float32>', 14], ['complex<float64>', 15], ['bfloat16', 16],
    ['float8e4m3fn', 17], ['float8e4m3fnuz', 18], ['float8e5m2', 19], ['float8e5m2fnuz', 20],
    ['uint4', 21], ['int4', 22], ['float4e2m1', 23], ['float8e8m0', 24], ['uint2', 25], ['int2', 26]
]);

export const formatConnectionType = (type) => {
    if (type === null || type === undefined) {
        return '';
    }
    if (typeof type === 'string') {
        return type;
    }
    if (typeof type.toString === 'function') {
        return type.toString();
    }
    return String(type);
};

export const canonicalizeTensorTypeString = (typeString) => {
    const text = formatConnectionType(typeString).trim();
    if (!text) {
        return '';
    }
    const bracket = text.indexOf('[');
    if (bracket === -1) {
        const dataType = text.toLowerCase();
        if (!tensorDataTypeByName.has(dataType)) {
            throw new TensorTypeError(`Unsupported value type '${text}'.`);
        }
        return dataType;
    }
    if (!text.endsWith(']')) {
        throw new TensorTypeError(`Invalid value type '${text}'.`);
    }
    const dataType = text.slice(0, bracket).trim().toLowerCase();
    if (!tensorDataTypeByName.has(dataType)) {
        throw new TensorTypeError(`Unsupported value type '${text}'.`);
    }
    const inner = text.slice(bracket + 1, -1).trim();
    if (!inner) {
        return `${dataType}[]`;
    }
    const dimensions = inner.split(',').map((part) => {
        const dim = part.trim();
        if (!dim) {
            throw new TensorTypeError(`Invalid value type '${text}'.`);
        }
        if (/^\d+$/.test(dim)) {
            return dim;
        }
        if (/^[A-Za-z_]\w*$/.test(dim)) {
            return dim;
        }
        throw new TensorTypeError(`Invalid dimension '${dim}' in type '${text}'.`);
    });
    return `${dataType}[${dimensions.join(',')}]`;
};

export const tensorTypeShapeDimensions = (type) => {
    if (!type) {
        return null;
    }
    if (typeof type === 'string') {
        const text = type.trim();
        if (!text) {
            return null;
        }
        const bracket = text.indexOf('[');
        if (bracket === -1 || !text.endsWith(']')) {
            return null;
        }
        const inner = text.slice(bracket + 1, -1).trim();
        if (!inner) {
            return [];
        }
        return inner.split(',').map((part) => {
            const dim = part.trim();
            return /^\d+$/.test(dim) ? BigInt(dim) : dim;
        });
    }
    if (type.shape && Array.isArray(type.shape.dimensions)) {
        return type.shape.dimensions;
    }
    return null;
};