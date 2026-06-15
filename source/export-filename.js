
export const stripExportExtension = (filename) => {
    if (!filename || typeof filename !== 'string') {
        return 'model';
    }
    const trimmed = filename.trim();
    const lastIndex = trimmed.lastIndexOf('.');
    if (lastIndex <= 0) {
        return trimmed || 'model';
    }
    return trimmed.substring(0, lastIndex);
};

export const sanitizeExportBasename = (name, maxLength = 120) => {
    if (!name || typeof name !== 'string') {
        return 'model';
    }
    let sanitized = name.trim()
        .replace(/[/\\?%*:|"<>]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+/, '')
        .replace(/^_|_$/g, '');
    if (!sanitized) {
        sanitized = 'model';
    }
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength).replace(/_+$/, '');
    }
    return sanitized || 'model';
};

const formatNameGroup = (names, maxLength = 120) => {
    const list = (Array.isArray(names) ? names : [names])
        .filter((name) => name && typeof name === 'string')
        .map((name) => sanitizeExportBasename(name));
    if (list.length === 0) {
        return '';
    }
    let joined = list.join('+');
    if (joined.length > maxLength) {
        joined = joined.substring(0, maxLength).replace(/[+_]+$/, '');
    }
    return joined || '';
};

export const buildSubgraphExportBasename = (base, beginNames, endNames) => {
    const sanitizedBase = sanitizeExportBasename(stripExportExtension(base));
    const begin = formatNameGroup(beginNames);
    const end = formatNameGroup(endNames);
    if (begin && end) {
        return `${sanitizedBase}_${begin}_to_${end}`;
    }
    return `${sanitizedBase}_subgraph`;
};

export const buildMergeFilename = (upstreamName, downstreamName) => {
    const upstream = sanitizeExportBasename(stripExportExtension(upstreamName || 'upstream'));
    const downstream = sanitizeExportBasename(stripExportExtension(downstreamName || 'downstream'));
    return `${upstream}_merged_${downstream}.onnx`;
};

export const normalizeExportFilename = (filename, extension) => {
    if (!filename || typeof filename !== 'string') {
        return null;
    }
    const trimmed = filename.trim();
    if (!trimmed) {
        return null;
    }
    const lower = trimmed.toLowerCase();
    const suffix = `.${extension.toLowerCase()}`;
    if (lower.endsWith(suffix)) {
        return trimmed;
    }
    return `${trimmed}.${extension}`;
};
