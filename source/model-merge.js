/*
 * This file contains the logic for merging two ONNX models
 * It has four main sections
 * 1. Graph inspection (getting information from the graphs) 10 - 164
 * 2. Validation 161-276, 601-642, this is where we throw the errors
 * 3. Automatic Mapping 314 - 609, where we try to match the outputs to the inputs without user intervention
 * 4. Merge 644 - 830. We handle name collisions, connections, and the actual merge of the graphs
 * Author: Luray He
*/

import { onnx } from './onnx-proto.js';
import {
    cloneModelProtoForMerge as cloneModelProto,
    normalizeGraphReferencesForMerge as normalizeGraphReferences,
    renameInGraphForMerge as renameInGraph,
    collectGraphNamesForMerge as collectGraphNames,
    validateGraphForMerge as validateGraph
} from './onnx-export.js';
import { detectCheckpoint, parseCheckpoint, findCVFlowNVPNode, getPrimGraphAttribute } from './ambapb.js';

const DEFAULT_DOWNSTREAM_PREFIX = 'downstream_';

const checkpointModelProtoForGraph = (graph) => {
    if (!graph) {
        return null;
    }
    if (detectCheckpoint({ graph })) {
        return { graph };
    }
    const wrapperNode = findCVFlowNVPNode(graph);
    if (wrapperNode && getPrimGraphAttribute(wrapperNode)) {
        return { graph, producer_name: 'cvflowbackend' };
    }
    return null;
};
// Since onnx.proto works with logical identifiers to represent data types, we have to map the numbers back to a string
// There are probably more data types that I'll have to worry about in the future, but this works for now.
const elemTypeNames = new Map([
    [0, 'undefined'],
    [1, 'float32'],
    [2, 'uint8'],
    [3, 'int8'],
    [4, 'uint16'],
    [5, 'int16'],
    [6, 'int32'],
    [7, 'int64'],
    [8, 'string'],
    [9, 'boolean'],
    [10, 'float16'],
    [11, 'float64'],
    [12, 'uint32'],
    [13, 'uint64'],
    [16, 'bfloat16']
]);
// class for error. There are potentially multiple errors, hence the array.
export class MergeError extends Error {

    constructor(message, errors = []) {
        super(message);
        this.name = 'Merge Error';
        this.errors = errors;
    }
}
// Helper methods for the later functions
const referenceName = (value) => {
    if (typeof value === 'string') {
        return value;
    }
    if (value && typeof value === 'object' && typeof value.name === 'string') {
        return value.name;
    }
    return '';
};

const getGraph = (model) => {
    if (!model || !model.graph) {
        return null;
    }
    return model.graph;
};
const cloneGraph = (graph) => {
    const model = new onnx.ModelProto();
    model.graph = graph;
    return cloneModelProto(model).graph;
};

const getElemType = (dataFormat) => {
    if (!dataFormat) {
        return 1; // Default to float32
    }
    const { sign, bits, expbits } = dataFormat;
    if (expbits > 0) {
        return 1; // float32
    }
    if (bits === 8) {
        return sign === 0 ? 2 : 3; // uint8 vs int8
    }
    if (bits === 16) {
        return sign === 0 ? 4 : 5; // uint16 vs int16
    }
    if (bits === 32) {
        return sign === 0 ? 12 : 6; // uint32 vs int32
    }
    return 1; // default to float32
};

const getDimensions = (dimension) => {
    const dims = [];
    if (dimension) {
        // Order of dimensions: p (batch), d (channels/depth), h (height), w (width)
        if (dimension.p !== undefined && dimension.p !== null) {
            dims.push(Number(dimension.p));
        }
        if (dimension.d !== undefined && dimension.d !== null) {
            dims.push(Number(dimension.d));
        }
        if (dimension.h !== undefined && dimension.h !== null) {
            dims.push(Number(dimension.h));
        }
        if (dimension.w !== undefined && dimension.w !== null) {
            dims.push(Number(dimension.w));
        }
    }
    return dims;
};

const convertOportToValueInfo = (name, oport) => {
    const valueInfo = new onnx.ValueInfoProto();
    valueInfo.name = name;

    const elemType = getElemType(oport && oport['data-format'] ? oport['data-format'] : (oport && oport.dataFormat));
    const dims = getDimensions(oport && oport.dimension);

    const type = new onnx.TypeProto();
    const tensor = new onnx.TypeProto.Tensor();
    tensor.elem_type = elemType;
    if (dims.length > 0) {
        const shape = new onnx.TensorShapeProto();
        shape.dim = dims.map((dimVal) => {
            const dimension = new onnx.TensorShapeProto.Dimension();
            dimension.dim_value = BigInt(dimVal);
            return dimension;
        });
        tensor.shape = shape;
    }
    type.tensor_type = tensor;
    valueInfo.type = type;

    return valueInfo;
};

const getOutputPrimitiveOport = (outputPrim, primitives) => {
    if (outputPrim.oports && outputPrim.oports.length > 0) {
        return outputPrim.oports[0];
    }
    if (outputPrim.sources && outputPrim.sources.length > 0) {
        const source = outputPrim.sources[0];
        const producer = primitives.find((p) => p.id === source.id);
        if (producer && producer.oports && producer.oports.length > source.port) {
            return producer.oports[source.port];
        }
    }
    return null;
};

const extractCheckpointIO = (modelProto) => {
    const checkpoint = parseCheckpoint(modelProto);
    if (!checkpoint || !checkpoint.primGraph) {
        return { inputs: [], outputs: [] };
    }
    const primitives = checkpoint.primGraph.primitives || [];
    const raw = checkpoint.primGraph.raw || {};

    // Find inputs
    const inputFallbackId = (primitives.find((primitive) => primitive.type === 'input') || {}).id;
    const graphInputId = raw.graph_input || inputFallbackId;
    const inputPrims = primitives.filter((p) => p.type === 'input' || p.id === graphInputId);
    const inputs = [];
    for (const inputPrim of inputPrims) {
        if (inputPrim.oports && inputPrim.oports.length > 0) {
            inputs.push(convertOportToValueInfo(inputPrim.id, inputPrim.oports[0]));
        }
    }

    // Find outputs
    const outputFallbackId = (primitives.find((primitive) => primitive.type === 'output') || {}).id;
    const graphOutputId = raw.graph_output || outputFallbackId;
    const outputPrims = primitives.filter((p) => p.type === 'output' || p.id === graphOutputId);
    const outputs = [];
    for (const outputPrim of outputPrims) {
        const oport = getOutputPrimitiveOport(outputPrim, primitives);
        if (oport) {
            outputs.push(convertOportToValueInfo(outputPrim.id, oport));
        }
    }

    return { inputs, outputs };
};

// if graph and output exist, get the output from array, else empty and will throw error later on
export const extractGraphOutputs = (graph) => {
    const checkpointProto = checkpointModelProtoForGraph(graph);
    if (checkpointProto) {
        const io = extractCheckpointIO(checkpointProto);
        return io.outputs;
    }
    return Array.isArray(graph && graph.output) ? graph.output.slice() : [];
};

export const extractGraphInputs = (graph) => {
    const checkpointProto = checkpointModelProtoForGraph(graph);
    if (checkpointProto) {
        const io = extractCheckpointIO(checkpointProto);
        return io.inputs;
    }
    return Array.isArray(graph && graph.input) ? graph.input.slice() : [];
};
// find the type
const tensorTypeOf = (type) => {
    if (!type || !type.tensor_type) {
        return null;
    }
    return type.tensor_type;
};
// find the format
const formatDimension = (dimension) => {
    if (!dimension) {
        return '?';
    }
    if (dimension.dim_value !== undefined && dimension.dim_value !== null) {
        return String(dimension.dim_value);
    }
    if (dimension.dim_param) {
        return dimension.dim_param;
    }
    return '?';
};
// find the formatType
export const formatType = (type) => {
    const tensor = tensorTypeOf(type);
    if (!tensor) {
        return 'unknown';
    }
    const elemName = elemTypeNames.get(Number(tensor.elem_type)) || `type${tensor.elem_type}`;
    const dims = tensor.shape && Array.isArray(tensor.shape.dim) ? tensor.shape.dim.map(formatDimension).join(',') : '';
    return dims ? `${elemName} [${dims}]` : elemName;
};
// find the value info
const findValueInfo = (graph, name) => {
    for (const list of [graph.input, graph.output, graph.value_info]) {
        for (const value of list || []) {
            if (value && value.name === name) {
                return value;
            }
        }
    }
    return null;
};
// we infer the type by looking at the graph and the name
const inferTypeFromGraph = (graph, name, preferProducer) => {
    const existing = findValueInfo(graph, name);
    if (existing && existing.type) {
        return existing.type;
    }
    // preferproducer is the upstream graph
    // I will have to fix this as the user can't choose what is upstream and what is downstream,
    // netron will automatically decide the upstream and the downstream graph, though the user
    // will have the choice to flip the roles of the graphs if it is possible to do so 
    if (preferProducer) {
        for (const node of graph.node || []) {
            for (const outputName of node.output || []) {
                if (referenceName(outputName) === name) {
                    return findValueInfo(graph, name)?.type || null;
                }
            }
        }
        // downstream
    } else {
        for (const node of graph.node || []) {
            for (const inputName of node.input || []) {
                if (referenceName(inputName) === name) {
                    return findValueInfo(graph, name)?.type || null;
                }
            }
        }
    }
    return null;
};
// find the tensor type from input output and value_info lists 
export const resolveValueType = (graph, name, options = {}) => {
    if (!graph || !name) {
        return null;
    }
    const checkpointProto = checkpointModelProtoForGraph(graph);
    if (checkpointProto) {
        const io = extractCheckpointIO(checkpointProto);
        const match = io.inputs.find((val) => val.name === name) || io.outputs.find((val) => val.name === name);
        if (match) {
            return match.type;
        }
    }
    const existing = findValueInfo(graph, name);
    if (existing && existing.type) {
        return existing.type;
    }
    if (options.preferProducer) {
        return inferTypeFromGraph(graph, name, true);
    }
    return inferTypeFromGraph(graph, name, false);
};
// This is the first of the validation methods. We check for dimension compatibility
const compareDimensions = (left, right, allowSymbolicDims) => {
    // we have left and right because we are comparing the dimensions of the two tensors
    // left and right is weird naming, but it means first vs second operand in argument order
    const leftHasValue = left && left.dim_value !== undefined && left.dim_value !== null;
    const rightHasValue = right && right.dim_value !== undefined && right.dim_value !== null;
    const leftHasParam = left && left.dim_param;
    const rightHasParam = right && right.dim_param;
    if (leftHasValue && rightHasValue) {
        if (left.dim_value !== right.dim_value) {
            return { ok: false, reason: 'Static dimension mismatch.' };
        }
        return { ok: true };
    }
    if ((leftHasValue && rightHasParam) || (leftHasParam && rightHasValue)) {
        if (allowSymbolicDims) {
            return { ok: true };
        }
        return { ok: false, reason: 'Symbolic dimension mismatch.' };
    }
    return { ok: true };
};
// Checks the element type, rank, and shape compatibility between upstream output and downstream input
export const areTypesCompatible = (upstreamType, downstreamType, options = {}) => {
    const upstreamTensor = tensorTypeOf(upstreamType);
    const downstreamTensor = tensorTypeOf(downstreamType);
    // Check if tensor types exist or not
    if (!upstreamTensor || !downstreamTensor) {
        return { ok: false, reason: 'Only tensor types are supported at the merge boundary.' };
    }
    // This checks the element type compatibility
    if (Number(upstreamTensor.elem_type) !== Number(downstreamTensor.elem_type)) {
        return { ok: false, reason: 'Element type mismatch.' };
    }
    // Checks the rank compatibiliity
    const upstreamDims = upstreamTensor.shape && upstreamTensor.shape.dim ? upstreamTensor.shape.dim : null;
    const downstreamDims = downstreamTensor.shape && downstreamTensor.shape.dim ? downstreamTensor.shape.dim : null;
    if (upstreamDims && downstreamDims) {
        if (upstreamDims.length !== downstreamDims.length) {
            return { ok: false, reason: 'Rank mismatch.' };
        }
        for (let i = 0; i < upstreamDims.length; i++) {
            const result = compareDimensions(upstreamDims[i], downstreamDims[i], options.allowSymbolicDims === true);
            if (!result.ok) {
                return result;
            }
        }
    } else if (upstreamDims || downstreamDims) {
        return { ok: true, warning: 'Shape missing on one side.' };
    }
    return { ok: true };
};

// for warnings vs errors
const makeIssue = (code, message, extra = {}) => ({
    code,
    message,
    severity: extra.severity || 'error',
    ...extra
});
// validateMapping validates the mapping between upstream and downstream graphs
export const validateMapping = (upstreamGraph, downstreamGraph, mapping, options = {}) => {
    const issues = [];
    const upstreamOutputs = new Set(extractGraphOutputs(upstreamGraph).map((value) => value.name));
    const downstreamInputs = extractGraphInputs(downstreamGraph).map((value) => value.name);
    const downstreamInputSet = new Set(downstreamInputs);
    const usedUpstream = new Set();
    // check of there are even any outputs or inputs in the graphs
    if (upstreamOutputs.size === 0) {
        issues.push(makeIssue('NO_UPSTREAM_OUTPUTS', 'Upstream graph has no outputs.'));
    }
    if (downstreamInputs.length === 0) {
        issues.push(makeIssue('NO_DOWNSTREAM_INPUTS', 'Downstream graph has no inputs.'));
    }
    if (!Array.isArray(mapping) || mapping.length === 0) {
        issues.push(makeIssue('NO_MAPPING', 'At least one mapping entry is required.'));
    }

    const mappedDownstream = new Set();
    for (const entry of mapping || []) {
        if (!entry || !entry.upstream || !entry.downstream) {
            issues.push(makeIssue('INVALID_MAPPING', 'Mapping entries must include upstream and downstream names.'));
            continue;
        }
        if (!upstreamOutputs.has(entry.upstream)) {
            issues.push(makeIssue('UNKNOWN_UPSTREAM_OUTPUT', `Unknown upstream output '${entry.upstream}'.`, { upstream: entry.upstream, downstream: entry.downstream }));
        }
        if (!downstreamInputSet.has(entry.downstream)) {
            issues.push(makeIssue('UNKNOWN_DOWNSTREAM_INPUT', `Unknown downstream input '${entry.downstream}'.`, { upstream: entry.upstream, downstream: entry.downstream }));
        }
        if (usedUpstream.has(entry.upstream)) {
            issues.push(makeIssue('DUPLICATE_UPSTREAM_IN_MAPPING', `Upstream output '${entry.upstream}' is mapped more than once.`, { upstream: entry.upstream, downstream: entry.downstream }));
        }
        usedUpstream.add(entry.upstream);
        if (mappedDownstream.has(entry.downstream)) {
            issues.push(makeIssue('DUPLICATE_DOWNSTREAM_IN_MAPPING', `Downstream input '${entry.downstream}' is mapped more than once.`, { upstream: entry.upstream, downstream: entry.downstream }));
        }
        mappedDownstream.add(entry.downstream);

        const upstreamType = resolveValueType(upstreamGraph, entry.upstream, { preferProducer: true });
        const downstreamType = resolveValueType(downstreamGraph, entry.downstream, { preferProducer: false });
        if (!upstreamType || !downstreamType) {
            issues.push(makeIssue('UNKNOWN_TYPE', `Cannot resolve types for '${entry.upstream}' -> '${entry.downstream}'.`, { upstream: entry.upstream, downstream: entry.downstream }));
        } else {
            const compatibility = areTypesCompatible(upstreamType, downstreamType, options);
            if (!compatibility.ok) {
                issues.push(makeIssue('TYPE_MISMATCH', compatibility.reason, { upstream: entry.upstream, downstream: entry.downstream }));
            } else if (compatibility.warning) {
                issues.push(makeIssue('PARTIAL_SHAPE', compatibility.warning, { severity: 'warning', upstream: entry.upstream, downstream: entry.downstream }));
            }
        }
    }

    for (const downstreamInput of downstreamInputs) {
        if (!mappedDownstream.has(downstreamInput)) {
            issues.push(makeIssue('UNMAPPED_DOWNSTREAM_INPUT', `Downstream input '${downstreamInput}' is not mapped.`, { downstream: downstreamInput }));
        }
    }

    const upstreamNames = collectAllGraphNames(upstreamGraph);
    const downstreamNames = collectAllGraphNames(downstreamGraph);
    for (const name of downstreamNames) {
        if (upstreamNames.has(name)) {
            issues.push(makeIssue('NAME_COLLISION', `Name '${name}' exists in both graphs.`, { severity: 'warning' }));
        }
    }

    return issues;
};
// For each downstream input, find upstream output with compatible types
const listCompatibleUpstreamOutputs = (upstreamGraph, downstreamGraph, downstreamName, usedUpstream, options) => {
    const downstreamType = resolveValueType(downstreamGraph, downstreamName, { preferProducer: false });
    if (!downstreamType) {
        return { candidates: [], missingType: true };
    }
    const candidates = [];
    for (const output of extractGraphOutputs(upstreamGraph)) {
        if (!output || !output.name || usedUpstream.has(output.name)) {
            continue;
        }
        const upstreamType = resolveValueType(upstreamGraph, output.name, { preferProducer: true });
        if (!upstreamType) {
            continue;
        }
        const compatibility = areTypesCompatible(upstreamType, downstreamType, options);
        if (!compatibility.ok) {
            continue;
        }
        candidates.push({
            name: output.name,
            exactNameMatch: output.name === downstreamName,
            partialShape: Boolean(compatibility.warning)
        });
    }
    return { candidates, missingType: false };
};
// We pick one upstream output per downstream input. We have to match the name
// This is the second of the validation methods. We check for name compatibility
// If there are multiple exact matches of names, we have ambiguous_auto_mapping
const chooseAutomaticCandidate = (downstreamName, candidates) => {
    if (candidates.length === 0) {
        return {
            ok: false,
            issue: makeIssue('NO_AUTO_MAPPING', `No compatible upstream output for downstream input '${downstreamName}'.`, { downstream: downstreamName })
        };
    }
    // Issue here, graphs won't have same names, so we need to change the name to match the upstream output name
    // If the two input and output are compatable
    const exactMatches = candidates.filter((candidate) => candidate.exactNameMatch);
    if (exactMatches.length === 1) {
        return { ok: true, candidate: exactMatches[0] };
    }
    if (exactMatches.length > 1) {
        const names = exactMatches.map((candidate) => candidate.name).join(', ');
        return {
            ok: false,
            issue: makeIssue(
                'AMBIGUOUS_AUTO_MAPPING',
                `Multiple upstream outputs (${names}) match downstream input '${downstreamName}'.`,
                { downstream: downstreamName }
            )
        };
    }
    if (candidates.length === 1) {
        return { ok: true, candidate: candidates[0] };
    }
    const names = candidates.map((candidate) => candidate.name).join(', ');
    return {
        ok: false,
        issue: makeIssue(
            'AMBIGUOUS_AUTO_MAPPING',
            `Multiple compatible upstream outputs (${names}) for downstream input '${downstreamName}'.`,
            { downstream: downstreamName }
        )
    };
};
// We assume that the caller knows which graph is upstream and which is downstream
// loop downstream inputs and we buildthe mapping
// Rerun validateMapping for collision warnings
export const buildAutomaticMapping = (upstreamProto, downstreamProto, options = {}) => {
    const errors = [];
    const warnings = [];
    if (!upstreamProto || !getGraph(upstreamProto)) {
        return { ok: false, mapping: [], errors: [makeIssue('INVALID_MODEL', 'Upstream model is missing a graph.')], warnings };
    }
    if (!downstreamProto || !getGraph(downstreamProto)) {
        return { ok: false, mapping: [], errors: [makeIssue('INVALID_MODEL', 'Downstream model is missing a graph.')], warnings };
    }
    const upstreamGraph = upstreamProto.graph;
    const downstreamGraph = downstreamProto.graph;
    const downstreamInputs = extractGraphInputs(downstreamGraph);
    const upstreamOutputs = extractGraphOutputs(upstreamGraph);
    if (upstreamOutputs.length === 0) {
        errors.push(makeIssue('NO_UPSTREAM_OUTPUTS', 'Upstream graph has no outputs.'));
    }
    if (downstreamInputs.length === 0) {
        errors.push(makeIssue('NO_DOWNSTREAM_INPUTS', 'Downstream graph has no inputs.'));
    }
    if (errors.length > 0) {
        return { ok: false, mapping: [], errors, warnings };
    }

    const mapping = [];
    const usedUpstream = new Set();
    for (const downstreamInput of downstreamInputs) {
        const downstreamName = downstreamInput.name;
        const { candidates, missingType } = listCompatibleUpstreamOutputs(upstreamGraph, downstreamGraph, downstreamName, usedUpstream, options);
        if (missingType) {
            errors.push(makeIssue('UNKNOWN_TYPE', `Cannot resolve type for downstream input '${downstreamName}'.`, { downstream: downstreamName }));
            continue;
        }
        const choice = chooseAutomaticCandidate(downstreamName, candidates);
        if (!choice.ok) {
            errors.push(choice.issue);
            continue;
        }
        if (choice.candidate.partialShape) {
            warnings.push(makeIssue(
                'PARTIAL_SHAPE',
                `Shape missing on one side for '${choice.candidate.name}' -> '${downstreamName}'.`,
                { severity: 'warning', upstream: choice.candidate.name, downstream: downstreamName }
            ));
        }
        mapping.push({ upstream: choice.candidate.name, downstream: downstreamName });
        usedUpstream.add(choice.candidate.name);
    }

    if (errors.length > 0) {
        return { ok: false, mapping, errors, warnings };
    }

    const validationIssues = validateMapping(upstreamGraph, downstreamGraph, mapping, options);
    for (const issue of validationIssues) {
        if (issue.severity === 'warning') {
            warnings.push(issue);
        } else {
            errors.push(issue);
        }
    }
    return { ok: errors.length === 0, mapping, errors, warnings };
};

// ranks a successful auto-mapping
const scoreMappingCandidate = (result, upstreamGraph) => {
    if (!result.ok) {
        return null;
    }
    let score = 0;
    let exactNameMatches = 0;
    // we add to score if the name is the same, otherwise we add 1
    for (const entry of result.mapping) {
        if (entry.upstream === entry.downstream) {
            exactNameMatches++;
            score += 2;
        } else {
            score += 1;
        }
    }
    score -= result.warnings.length;
    const outputCount = extractGraphOutputs(upstreamGraph).length;
    const inputCount = extractGraphInputs(upstreamGraph).length;
    return {
        score,
        exactNameMatches,
        warningCount: result.warnings.length,
        ioFit: outputCount - inputCount,
        mappingCount: result.mapping.length
    };
};

// the metrics are used to rank the candidates
const compareMappingCandidates = (left, right) => {
    if (right.metrics.score !== left.metrics.score) {
        return right.metrics.score - left.metrics.score;
    }
    if (right.metrics.exactNameMatches !== left.metrics.exactNameMatches) {
        return right.metrics.exactNameMatches - left.metrics.exactNameMatches;
    }
    if (left.metrics.warningCount !== right.metrics.warningCount) {
        return left.metrics.warningCount - right.metrics.warningCount;
    }
    if (right.metrics.ioFit !== left.metrics.ioFit) {
        return right.metrics.ioFit - left.metrics.ioFit;
    }
    return 0;
};
// makeMappingCandidate is used to create a candidate for the mapping
const makeMappingCandidate = (upstreamProto, downstreamProto, mappingResult) => {
    return {
        upstreamProto,
        downstreamProto,
        mapping: mappingResult.mapping,
        warnings: mappingResult.warnings,
        metrics: scoreMappingCandidate(mappingResult, upstreamProto.graph)
    };
};
// compareMappingCandidatesWithSlot is used to compare the candidates with the slot
const compareMappingCandidatesWithSlot = (left, right) => {
    const compared = compareMappingCandidates(left, right);
    if (compared !== 0) {
        return compared;
    }
    if (left.upstreamSlot !== right.upstreamSlot) {
        return left.upstreamSlot === 'A' ? -1 : 1;
    }
    return 0;
};
// if only one direction works, the score gap is greater than 2 or the exact name matches is greater than 1, we have high confidence
const computeRoleConfidence = (chosen, runnerUp, status) => {
    if (status === 'unidirectional' || !runnerUp) {
        return 'high';
    }
    const scoreGap = chosen.metrics.score - runnerUp.metrics.score;
    const exactGap = chosen.metrics.exactNameMatches - runnerUp.metrics.exactNameMatches;
    if (scoreGap >= 2 || exactGap >= 1) {
        return 'high';
    }
    return 'low';
};
// we collect the candidates from both directions
const buildAutomaticMappingCandidates = (protoA, protoB, options = {}) => {
    const forward = buildAutomaticMapping(protoA, protoB, options);
    const reverse = buildAutomaticMapping(protoB, protoA, options);
    const candidates = [];
    // forward.ok is true if the forward mapping is valid
    if (forward.ok) {
        candidates.push(makeMappingCandidate(protoA, protoB, forward));
    }
    // reverse.ok is true if the reverse mapping is valid
    if (reverse.ok) {
        candidates.push(makeMappingCandidate(protoB, protoA, reverse));
    }
    return { forward, reverse, candidates };
};
// tries both directions, and if only one direction works, we will use that
// if both directions work with merge, we pick the one with the higher score
// If tied, we have ambiguous_merge_role
export const buildAutomaticMappingBidirectional = (protoA, protoB, options = {}) => {
    const { forward, reverse, candidates } = buildAutomaticMappingCandidates(protoA, protoB, options);
    if (candidates.length === 1) {
        const chosen = candidates[0];
        return {
            ok: true,
            mapping: chosen.mapping,
            upstreamProto: chosen.upstreamProto,
            downstreamProto: chosen.downstreamProto,
            errors: [],
            warnings: chosen.warnings
        };
    }
    if (candidates.length > 1) {
        candidates.sort(compareMappingCandidates);
        if (compareMappingCandidates(candidates[0], candidates[1]) !== 0) {
            const chosen = candidates[0];
            return {
                ok: true,
                mapping: chosen.mapping,
                upstreamProto: chosen.upstreamProto,
                downstreamProto: chosen.downstreamProto,
                errors: [],
                warnings: chosen.warnings
            };
        }
        return {
            ok: false,
            mapping: [],
            errors: [makeIssue('AMBIGUOUS_MERGE_ROLE', 'Both model orderings produce a valid automatic mapping.')],
            warnings: []
        };
    }
    return {
        ok: false,
        mapping: [],
        errors: [...forward.errors, ...reverse.errors],
        warnings: [...forward.warnings, ...reverse.warnings]
    };
};

const slotForUpstreamProto = (protoA, protoB, upstreamProto) => {
    if (upstreamProto === protoA) {
        return 'A';
    }
    if (upstreamProto === protoB) {
        return 'B';
    }
    return null;
};
// this is what the UI uses
// detectMergeRoles is used to detect the roles of the graphs
export const detectMergeRoles = (protoA, protoB, options = {}) => {
    const emptyResult = {
        ok: false,
        status: 'failed',
        upstreamProto: null,
        downstreamProto: null,
        upstreamSlot: null,
        mapping: [],
        errors: [],
        warnings: [],
        confidence: null
    };
    // makes sure the graphs are loaded
    if (!protoA || !getGraph(protoA) || !protoB || !getGraph(protoB)) {
        return {
            ...emptyResult,
            errors: [makeIssue('INVALID_MODEL', 'Both models must be loaded with a graph before roles can be detected.')]
        };
    }
    const { forward, reverse, candidates } = buildAutomaticMappingCandidates(protoA, protoB, options);
    if (candidates.length === 0) {
        return {
            ...emptyResult,
            errors: [...forward.errors, ...reverse.errors],
            warnings: [...forward.warnings, ...reverse.warnings]
        };
    }
    const ranked = candidates.map((candidate) => ({
        ...candidate,
        upstreamSlot: slotForUpstreamProto(protoA, protoB, candidate.upstreamProto)
    }));
    ranked.sort(compareMappingCandidatesWithSlot);
    const chosen = ranked[0];
    const runnerUp = ranked.length > 1 ? ranked[1] : null;
    const status = ranked.length === 1 ? 'unidirectional' : 'resolved';
    return {
        ok: true,
        status,
        upstreamProto: chosen.upstreamProto,
        downstreamProto: chosen.downstreamProto,
        upstreamSlot: chosen.upstreamSlot,
        mapping: chosen.mapping,
        errors: [],
        warnings: chosen.warnings,
        confidence: computeRoleConfidence(chosen, runnerUp, status)
    };
};

const hasExternalWeights = (graph) => {
    for (const tensor of graph.initializer || []) {
        if (tensor.data_location === 1 || (Array.isArray(tensor.external_data) && tensor.external_data.length > 0)) {
            return true;
        }
    }
    return false;
};

export const validateMerge = (upstreamProto, downstreamProto, mapping, options = {}) => {
    const errors = [];
    const warnings = [];
    if (!upstreamProto || !getGraph(upstreamProto)) {
        errors.push(makeIssue('INVALID_MODEL', 'Upstream model is missing a graph.'));
    }
    if (!downstreamProto || !getGraph(downstreamProto)) {
        errors.push(makeIssue('INVALID_MODEL', 'Downstream model is missing a graph.'));
    }
    if (errors.length > 0) {
        return { ok: false, errors, warnings };
    }
    const upstreamGraph = upstreamProto.graph;
    const downstreamGraph = downstreamProto.graph;
    if (hasExternalWeights(upstreamGraph) || hasExternalWeights(downstreamGraph)) {
        errors.push(makeIssue('EXTERNAL_WEIGHTS', 'External weight data is not supported in v1.'));
    }
    if (Array.isArray(upstreamProto.functions) && upstreamProto.functions.length > 0) {
        warnings.push(makeIssue('CUSTOM_FUNCTIONS', 'Upstream model defines custom functions; they are not merged in v1.', { severity: 'warning' }));
    }
    if (Array.isArray(downstreamProto.functions) && downstreamProto.functions.length > 0) {
        warnings.push(makeIssue('CUSTOM_FUNCTIONS', 'Downstream model defines custom functions; they are not merged in v1.', { severity: 'warning' }));
    }
    for (const issue of validateMapping(upstreamGraph, downstreamGraph, mapping, options)) {
        if (issue.severity === 'warning') {
            warnings.push(issue);
        } else {
            errors.push(issue);
        }
    }
    return { ok: errors.length === 0, errors, warnings };
};

const collectAllGraphNames = (graph) => {
    const names = collectGraphNames(graph);
    for (const node of graph.node || []) {
        if (node.name) {
            names.add(node.name);
        }
    }
    return names;
};
// prefixDownstreamGraph is used to prefix the downstream graph names
// rename to downstream_{name}
// we use renameInGraph
export const prefixDownstreamGraph = (downstreamGraph, prefix, reservedNames) => {
    const renameMap = new Map();
    for (const name of collectAllGraphNames(downstreamGraph)) {
        if (reservedNames.has(name)) {
            renameMap.set(name, `${prefix}${name}`);
        }
    }
    for (const [oldName, newName] of renameMap) {
        renameInGraph(downstreamGraph, oldName, newName);
        for (const node of downstreamGraph.node || []) {
            if (node.name === oldName) {
                node.name = newName;
            }
        }
    }
    return renameMap;
};

export const applyMappingRenames = (downstreamGraph, mapping, prefixMap = new Map()) => {
    for (const entry of mapping || []) {
        const downstreamName = prefixMap.get(entry.downstream) || entry.downstream;
        renameInGraph(downstreamGraph, downstreamName, entry.upstream);
    }
};

export const removeMappedDownstreamInputs = (downstreamGraph, mapping) => {
    const mappedDownstreamNames = new Set((mapping || []).map((entry) => entry.downstream));
    downstreamGraph.input = (downstreamGraph.input || []).filter((value) => !mappedDownstreamNames.has(value.name));
};

// dedupeValueInfo is used to deduplicate the value info
const dedupeValueInfo = (values, preferFirst = true) => {
    const map = new Map();
    for (const value of values) {
        if (!value || !value.name) {
            continue;
        }
        if (!map.has(value.name) || !preferFirst) {
            map.set(value.name, value);
        }
    }
    return Array.from(map.values());
};

// mergeGraphProtos is used to merge the graphs by concatenating the nodes, inputs, outputs, initializers, sparse initializers, and value info
export const mergeGraphProtos = (upstreamGraph, downstreamGraph) => {
    const merged = new onnx.GraphProto();
    merged.name = upstreamGraph.name || downstreamGraph.name || '';
    merged.doc_string = upstreamGraph.doc_string || downstreamGraph.doc_string || '';
    merged.node = [...(upstreamGraph.node || []), ...(downstreamGraph.node || [])];
    merged.input = [...(upstreamGraph.input || [])];
    merged.output = [...(downstreamGraph.output || [])];
    merged.initializer = [...(upstreamGraph.initializer || []), ...(downstreamGraph.initializer || [])];
    merged.sparse_initializer = [...(upstreamGraph.sparse_initializer || []), ...(downstreamGraph.sparse_initializer || [])];
    merged.value_info = dedupeValueInfo([
        ...(upstreamGraph.value_info || []),
        ...(downstreamGraph.value_info || []),
        ...(upstreamGraph.input || []),
        ...(upstreamGraph.output || []),
        ...(downstreamGraph.output || [])
    ], true);
    merged.quantization_annotation = [
        ...(upstreamGraph.quantization_annotation || []),
        ...(downstreamGraph.quantization_annotation || [])
    ];
    normalizeGraphReferences(merged);
    return merged;
};

export const mergeOpsetImports = (upstreamProto, downstreamProto) => {
    const merged = new Map();
    for (const proto of [upstreamProto, downstreamProto]) {
        for (const entry of proto.opset_import || []) {
            const domain = entry.domain || '';
            const version = entry.version || 0n;
            const current = merged.get(domain);
            if (!current || version > current.version) {
                merged.set(domain, entry);
            }
        }
    }
    return Array.from(merged.values());
};

// mergeModelProtos is used to merge the models by concatenating the graphs, opset imports, producer name, domain, model version, doc string, and metadata props
// different from the mergeGraphProtos, we have to merge the models by concatenating the graphs, opset imports, producer name, domain, model version, doc string, and metadata props
export const mergeModelProtos = (upstreamProto, downstreamProto, options = {}) => {
    const mapping = options.mapping || [];
    const prefix = options.downstreamPrefix || DEFAULT_DOWNSTREAM_PREFIX;
    const upstream = cloneModelProto(upstreamProto);
    const downstream = cloneModelProto(downstreamProto);
    const upstreamGraph = upstream.graph;
    const downstreamGraph = downstream.graph;
    const reservedNames = collectAllGraphNames(upstreamGraph);
    const prefixMap = prefixDownstreamGraph(downstreamGraph, prefix, reservedNames);
    applyMappingRenames(downstreamGraph, mapping, prefixMap);
    removeMappedDownstreamInputs(downstreamGraph, mapping);
    const mergedGraph = mergeGraphProtos(upstreamGraph, downstreamGraph);
    normalizeGraphReferences(mergedGraph);
    validateGraph(mergedGraph);
    const merged = new onnx.ModelProto();
    merged.ir_version = upstream.ir_version > downstream.ir_version ? upstream.ir_version : downstream.ir_version;
    merged.opset_import = mergeOpsetImports(upstream, downstream);
    merged.producer_name = 'netron-editor';
    merged.domain = upstream.domain || downstream.domain || '';
    merged.model_version = upstream.model_version > downstream.model_version ? upstream.model_version : downstream.model_version;
    merged.doc_string = `Merged: ${options.upstreamName || 'upstream'} + ${options.downstreamName || 'downstream'}`;
    merged.graph = mergedGraph;
    merged.metadata_props = [...(upstream.metadata_props || []), ...(downstream.metadata_props || [])];
    return merged;
};



export const tryMergeOnnxModels = (upstreamProto, downstreamProto, options = {}) => {
    const isUpstreamCheckpoint = detectCheckpoint(upstreamProto);
    const isDownstreamCheckpoint = detectCheckpoint(downstreamProto);

    if (isUpstreamCheckpoint !== isDownstreamCheckpoint) {
        return {
            ok: false,
            errors: [makeIssue('INCOMPATIBLE_MODELS', 'Cannot merge a standard ONNX model with an Amba checkpoint model.')],
            warnings: []
        };
    }

    const validation = validateMerge(upstreamProto, downstreamProto, options.mapping || [], options);
    if (!validation.ok) {
        return { ok: false, errors: validation.errors, warnings: validation.warnings };
    }
    try {
        const mergedProto = mergeModelProtos(upstreamProto, downstreamProto, options);
        return { ok: true, mergedProto, warnings: validation.warnings };
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        return {
            ok: false,
            errors: [makeIssue('MERGE_FAILED', message)],
            warnings: validation.warnings
        };
    }
};

export const formatMergeErrors = (errors, options = {}) => {
    const lines = [];
    if (!options.inline) {
        lines.push('Cannot merge models.', '');
    }
    const mappingIssues = (errors || []).filter((entry) => entry.upstream && entry.downstream);
    const downstreamIssues = (errors || []).filter((entry) => entry.downstream && !entry.upstream);
    const otherIssues = (errors || []).filter((entry) => !entry.downstream);
    if (mappingIssues.length > 0) {
        lines.push('Mapping issues:');
        for (const issue of mappingIssues) {
            lines.push(`• ${issue.downstream} ← ${issue.upstream}: ${issue.message}`);
        }
        if (otherIssues.length > 0 || downstreamIssues.length > 0) {
            lines.push('');
        }
    }
    if (downstreamIssues.length > 0) {
        lines.push('Input issues:');
        for (const issue of downstreamIssues) {
            lines.push(`• ${issue.downstream}: ${issue.message}`);
        }
        if (otherIssues.length > 0) {
            lines.push('');
        }
    }
    if (otherIssues.length > 0) {
        lines.push('Other issues:');
        for (const issue of otherIssues) {
            lines.push(`• ${issue.message}`);
        }
    }
    return lines.join('\n');
};

export const formatMergeWarnings = (warnings, options = {}) => {
    if (!Array.isArray(warnings) || warnings.length === 0) {
        return '';
    }
    const lines = options.inline ? ['Warnings:'] : ['Warnings:', ''];
    for (const issue of warnings) {
        if (issue.upstream && issue.downstream) {
            lines.push(`• ${issue.downstream} ← ${issue.upstream}: ${issue.message}`);
        } else if (issue.downstream) {
            lines.push(`• ${issue.downstream}: ${issue.message}`);
        } else {
            lines.push(`• ${issue.message}`);
        }
    }
    return lines.join('\n');
};
