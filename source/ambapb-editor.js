/* 
 * The logic for editing the ambapb shell node and its attributes
 * Author: Luray He
 */
import {
    parsePrimGraphJson,
    serializePrimGraphJson,
    validatePrimGraph
} from './ambapb-prim-graph.js';

export const CVFLOW_NVP_OP_TYPE = 'CVFlowNVP';
export const PRIM_GRAPH_ATTRIBUTE = 'prim_graph';
export const COMPILED_PRIM_GRAPH_ATTRIBUTE = 'compiled_prim_graph';
export const PRIM_GRAPH_IMMS_ATTRIBUTE = 'prim_graph_imms';

export const READ_ONLY_SHELL_ATTRIBUTES = new Set([
    COMPILED_PRIM_GRAPH_ATTRIBUTE,
    PRIM_GRAPH_IMMS_ATTRIBUTE
]);
// Will be a living list. We only have information from the files that were given to us
export const EDITABLE_SHELL_OP_TYPES = new Set([
    CVFLOW_NVP_OP_TYPE,
    'FragSubgraph',
    'BatchCall'
]);

export function isCVFlowNVPNode(node) {
    return Boolean(node && node.type && node.type.name === CVFLOW_NVP_OP_TYPE);
}

export function isAmbapbRuntimeShellNode(node) {
    return Boolean(node && node.type && EDITABLE_SHELL_OP_TYPES.has(node.type.name));
}

export function isAmbapbShellNode(node) {
    return isCVFlowNVPNode(node);
}

export function isCompiledAmbapbGraph(graph) {
    return Boolean(graph && graph._ambapbCompiledGraph);
}

export function isViewingCompiledAmbapbGraph(path, activeTarget) {
    if (isCompiledAmbapbGraph(activeTarget)) {
        return true;
    }
    if (Array.isArray(path)) {
        for (const entry of path) {
            if (entry && isCompiledAmbapbGraph(entry.target)) {
                return true;
            }
        }
    }
    return false;
};

const resolvePatchNodeContext = (model, patch) => {
    if (!model || !Array.isArray(model.modules)) {
        return null;
    }
    const entityId = patch.entityId || patch.parentId;
    if (!entityId) {
        return null;
    }
    const nestedMatch = /^graph:(\d+)\/node:(\d+)\/([^/]+)\/node:(\d+)/.exec(entityId);
    if (nestedMatch) {
        const graphIndex = Number(nestedMatch[1]);
        const hostNodeIndex = Number(nestedMatch[2]);
        const graphAttrName = nestedMatch[3];
        const subNodeIndex = Number(nestedMatch[4]);
        const graph = model.modules[graphIndex];
        const hostNode = graph && graph.nodes ? graph.nodes[hostNodeIndex] : null;
        const graphEntry = hostNode &&
            [...(hostNode.attributes || []), ...(hostNode.blocks || [])]
                .find((entry) => entry.name === graphAttrName && entry.type === 'graph' && entry.value);
        const subGraph = graphEntry ? graphEntry.value : null;
        return {
            graph: subGraph,
            node: subGraph && Array.isArray(subGraph.nodes) ? subGraph.nodes[subNodeIndex] || null : null,
            graphIndex,
            nodeIndex: subNodeIndex,
            nestedInlineCompiled: true,
            hostNode
        };
    }
    const match = /^graph:(\d+)\/node:(\d+)/.exec(entityId);
    if (!match) {
        return null;
    }
    const graphIndex = Number(match[1]);
    const nodeIndex = Number(match[2]);
    const graph = model.modules[graphIndex];
    if (!graph || !Array.isArray(graph.nodes)) {
        return null;
    }
    return {
        graph,
        node: graph.nodes[nodeIndex] || null,
        graphIndex,
        nodeIndex
    };
};

export function cloneAmbapbEditingState(ambapb) {
    if (!ambapb) {
        return null;
    }
    const cloned = {
        metadata: ambapb.metadata,
        canEdit: ambapb.canEdit,
        canExport: ambapb.canExport,
        imms: ambapb.imms
    };
    if (ambapb.primGraph) {
        cloned.primGraph = parsePrimGraphJson(serializePrimGraphJson(ambapb.primGraph));
    }
    return cloned;
}

export function attachAmbapbEditingState(model, ambapb) {
    if (!model || !ambapb) {
        return;
    }
    model._ambapb = {
        metadata: ambapb.metadata,
        canEdit: ambapb.canEdit,
        canExport: ambapb.canExport,
        imms: ambapb.imms,
        primGraph: ambapb.primGraph
    };
}

export function getPrimGraphSnapshotValue(ambapb) {
    if (!ambapb || !ambapb.primGraph) {
        return '';
    }
    return serializePrimGraphJson(ambapb.primGraph);
}

export function formatPrimGraphForEditor(ambapb) {
    const text = getPrimGraphSnapshotValue(ambapb);
    if (!text) {
        return '';
    }
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
        return text;
    }
}

const attributeNameFromProperty = (property) => {
    const prefix = 'attributes.';
    if (typeof property === 'string' && property.startsWith(prefix)) {
        return property.slice(prefix.length);
    }
    return property;
};

export function syncPrimGraphFromJson(ambapb, jsonText) {
    if (!ambapb) {
        return false;
    }
    const primGraph = parsePrimGraphJson(jsonText);
    const validation = validatePrimGraph(primGraph.primitives);
    if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
    }
    ambapb.primGraph = primGraph;
    return true;
};
// the indice is used to find the primitive in the primGraph
const findPrimitiveIndices = (primGraph, primitiveId) => {
    if (!primGraph || !primitiveId) {
        return { normalizedIndex: -1, rawIndex: -1 };
    }
    const normalizedIndex = (primGraph.primitives || []).findIndex((entry) => entry.id === primitiveId);
    const rawIndex = (primGraph.raw && Array.isArray(primGraph.raw.primitives)) ?
        primGraph.raw.primitives.findIndex((entry) => entry && entry.id === primitiveId) :
        -1;
    return { normalizedIndex, rawIndex };
};

// we go through the prim graph and find the primitive and all of the data 
// it has because we eventually want to display it in a list. 
export function syncPrimitiveAttribute(ambapb, primitiveId, attributeName, value) {
    if (!ambapb || !ambapb.primGraph) {
        throw new Error('primGraph is required.');
    }
    if (!primitiveId || !attributeName) {
        throw new Error('primitive id and attribute name are required.');
    }
    const stringValue = value === null || value === undefined ? '' : String(value);
    const { normalizedIndex, rawIndex } = findPrimitiveIndices(ambapb.primGraph, primitiveId);
    if (normalizedIndex < 0) {
        throw new Error(`Primitive '${primitiveId}' not found.`);
    }
    const primitive = ambapb.primGraph.primitives[normalizedIndex];
    primitive.attributes = primitive.attributes || {};
    primitive.attributes[attributeName] = stringValue;
    if (rawIndex >= 0) {
        const rawPrimitive = ambapb.primGraph.raw.primitives[rawIndex];
        rawPrimitive.attributes = rawPrimitive.attributes || {};
        rawPrimitive.attributes[attributeName] = stringValue;
    }
    return true;
};

export function buildPrimGraphJsonAfterAttributeEdit(ambapb, primitiveId, attributeName, value) {
    const primGraph = parsePrimGraphJson(serializePrimGraphJson(ambapb.primGraph));
    syncPrimitiveAttribute({ primGraph }, primitiveId, attributeName, value);
    const validation = validatePrimGraph(primGraph.primitives);
    if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
    }
    return serializePrimGraphJson(primGraph);
};
// match id, type, mangled-id
export function filterPrimitives(primitives, query) {
    const list = Array.isArray(primitives) ? primitives : [];
    const term = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (!term) {
        return list;
    }
    return list.filter((primitive) => {
        const id = (primitive.id || '').toLowerCase();
        const type = (primitive.type || '').toLowerCase();
        const mangledId = (primitive.mangledId || '').toLowerCase();
        return id.includes(term) || type.includes(term) || mangledId.includes(term);
    });
};
// helper to check if we have modified something. 
// helper is run everytime the list is rendered. We re-render when we edit something
export function isPrimitiveModified(originalAmbapb, modifiedAmbapb, primitiveId) {
    if (!originalAmbapb || !modifiedAmbapb || !primitiveId) {
        return false;
    }
    const original = (originalAmbapb.primGraph && originalAmbapb.primGraph.primitives || [])
        .find((entry) => entry.id === primitiveId);
    const modified = (modifiedAmbapb.primGraph && modifiedAmbapb.primGraph.primitives || [])
        .find((entry) => entry.id === primitiveId);
    if (!original || !modified) {
        return Boolean(original) !== Boolean(modified);
    }
    const originalAttrs = original.attributes || {};
    const modifiedAttrs = modified.attributes || {};
    const keys = new Set([...Object.keys(originalAttrs), ...Object.keys(modifiedAttrs)]);
    for (const key of keys) {
        if (String(originalAttrs[key] ?? '') !== String(modifiedAttrs[key] ?? '')) {
            return true;
        }
    }
    return false;
};

export function ensureAmbapbUiState(ambapb) {
    if (!ambapb) {
        return null;
    }
    if (!ambapb._uiState || typeof ambapb._uiState !== 'object') {
        ambapb._uiState = {
            selectedPrimitiveId: null,
            searchQuery: '',
            advancedOpen: false
        };
    }
    return ambapb._uiState;
};

export function resolveSelectedPrimitiveId(ambapb, primitiveIds) {
    const uiState = ensureAmbapbUiState(ambapb);
    const ids = Array.isArray(primitiveIds) ? primitiveIds : [];
    if (uiState.selectedPrimitiveId && ids.includes(uiState.selectedPrimitiveId)) {
        return uiState.selectedPrimitiveId;
    }
    return ids.length > 0 ? ids[0] : null;
};
// sync the prim_graph JSON text into model._ambapb.primGraph
export function syncShellAttribute(model, graphIndex, nodeIndex, attributeName, value) {
    const ambapb = model && model._ambapb;
    const graph = model && model.modules && model.modules[graphIndex];
    const node = graph && graph.nodes[nodeIndex];
    if (!ambapb || !isAmbapbShellNode(node)) {
        return false;
    }
    if (attributeName === PRIM_GRAPH_ATTRIBUTE) {
        return syncPrimGraphFromJson(ambapb, value);
    }
    return false;
}

// Don't want to edit compiled graph
export function isAmbapbEditableGraph(model, graphIndex = 0) {
    const graph = model && model.modules && model.modules[graphIndex];
    return Boolean(model && model._ambapb && model._ambapb.canEdit && graph && !graph._ambapb);
}

// we don't want to support topology editing for now: too risky and changes
// entire structure of prim_graph
export function assertAmbapbAttributePatchAllowed(model, patch, options = {}) {
    if (!model || !model._ambapb || !model._ambapb.canEdit) {
        return;
    }
    const entityId = patch.entityId || patch.parentId;
    // /value denotes connections, and we want to make sure that 
    // we are allowed to edit them
    if (entityId && entityId.includes('/value:')) {
        return;
    }
    const context = resolvePatchNodeContext(model, patch);
    const isCompiledNode = (context && isCompiledAmbapbGraph(context.graph)) ||
        (context && context.nestedInlineCompiled) ||
        options.viewingCompiledGraph === true;
    if (isCompiledNode) {
        if (patch.entityType === 'node' && (patch.property === 'insert' || patch.property === 'remove')) {
            throw new Error('Checkpoint topology editing is not supported.');
        }
        return;
    }
    if (context && context.nestedInlineCompiled) {
        if (patch.entityType === 'node' && patch.property === 'name') {
            throw new Error('Renaming inlined compiled nodes is not supported.');
        }
        if (patch.entityType === 'node' &&
            (patch.property === 'insert' || patch.property === 'remove')) {
            throw new Error('Checkpoint topology editing is not supported.');
        }
        return;
    }
    if (options.viewingCompiledGraph === true) {
        throw new Error('Compiled graph nodes are read-only.');
    }
    if (context && isCompiledAmbapbGraph(context.graph)) {
        throw new Error('Compiled graph nodes are read-only.');
    }
    if (patch.entityType === 'node' && (patch.property === 'insert' || patch.property === 'remove')) {
        throw new Error('Checkpoint topology editing is not supported.');
    }
    if (patch.entityType === 'node' && (patch.property === 'name' || patch.property === 'description')) {
        if (!context || !context.node || !isAmbapbRuntimeShellNode(context.node)) {
            throw new Error('Editing this checkpoint node is not supported.');
        }
        return;
    }
    if (patch.entityType === 'attribute') {
        if (!context || !context.node || !isAmbapbRuntimeShellNode(context.node)) {
            throw new Error('Editing this checkpoint node is not supported.');
        }
        const attributeName = attributeNameFromProperty(patch.property);
        if (READ_ONLY_SHELL_ATTRIBUTES.has(attributeName)) {
            throw new Error(`Editing '${attributeName}' is not supported.`);
        }
        if (patch.changeType === 'delete' && attributeName === PRIM_GRAPH_ATTRIBUTE) {
            throw new Error(`Deleting '${attributeName}' is not supported.`);
        }
    }
}

// for now, prim_graph edits are JSON text, we will change this later
export function validateAmbapbPatch(model, patch, options = {}) {
    assertAmbapbAttributePatchAllowed(model, patch, options);
    if (patch.entityType !== 'attribute' || patch.changeType !== 'modify') {
        return;
    }
    const attributeName = attributeNameFromProperty(patch.property);
    if (attributeName !== PRIM_GRAPH_ATTRIBUTE) {
        return;
    }
    if (typeof patch.newValue !== 'string') {
        throw new Error('prim_graph edits must be JSON text.');
    }
    const primGraph = parsePrimGraphJson(patch.newValue);
    const validation = validatePrimGraph(primGraph.primitives);
    if (!validation.ok) {
        throw new Error(validation.errors.join('\n'));
    }
}
