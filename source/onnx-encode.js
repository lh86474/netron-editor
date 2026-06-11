
/*
    This file defines a lot of different helper functions to encode the graph into the ONNX IR
    Very extensive as it needs to cover all data types supported by ONNX IR
    Support export of all data types supported by ONNX IR
    It also supports all of the Protobuf classes that are used to build an .onnx graph
    Check onnx.proto3 for the full structure of the messages. EVerything here is based on onnx.proto3
    Author: Luray He
*/
import { onnx } from './onnx-proto.js';
import { BinaryWriter, encodeUnknown, own } from './protobuf.js';

const encodeSubmessage = (writer, field, message, encode) => {
    if (message === null || message === undefined) {
        return;
    }
    writer.uint32((field << 3) | 2);
    const fork = writer.fork();
    encode(fork, message);
    fork.ldelim();
};

const encodeStringField = (writer, field, message, key) => {
    if (own(message, key) && message[key] !== '') {
        writer.uint32((field << 3) | 2);
        writer.string(message[key]);
    }
};

const encodeInt32Field = (writer, field, message, key) => {
    if (own(message, key) && message[key] !== 0) {
        writer.uint32((field << 3) | 0);
        writer.int32(message[key]);
    }
};

const encodeInt64Field = (writer, field, message, key) => {
    if (own(message, key) && message[key] !== 0n) {
        writer.uint32((field << 3) | 0);
        writer.int64(message[key]);
    }
};

const encodeFloatField = (writer, field, message, key) => {
    if (own(message, key) && message[key] !== 0) {
        writer.uint32((field << 3) | 5);
        writer.float(message[key]);
    }
};

const encodeRepeatedString = (writer, field, values) => {
    if (!values || values.length === 0) {
        return;
    }
    for (const value of values) {
        writer.uint32((field << 3) | 2);
        writer.string(value);
    }
};

const encodeRepeatedSubmessage = (writer, field, values, encode) => {
    if (!values || values.length === 0) {
        return;
    }
    for (const value of values) {
        encodeSubmessage(writer, field, value, encode);
    }
};

const encodePackedInt64 = (writer, field, values) => {
    if (!values || values.length === 0) {
        return;
    }
    writer.uint32((field << 3) | 2);
    const fork = writer.fork();
    for (const value of values) {
        fork.int64(value);
    }
    fork.ldelim();
};

const encodePackedInt32 = (writer, field, values) => {
    if (!values || values.length === 0) {
        return;
    }
    writer.uint32((field << 3) | 2);
    const fork = writer.fork();
    for (const value of values) {
        fork.int32(value);
    }
    fork.ldelim();
};

const encodePackedFloat = (writer, field, values) => {
    if (!values || values.length === 0) {
        return;
    }
    writer.uint32((field << 3) | 2);
    const fork = writer.fork();
    for (const value of values) {
        fork.float(value);
    }
    fork.ldelim();
};

const encodePackedDouble = (writer, field, values) => {
    if (!values || values.length === 0) {
        return;
    }
    writer.uint32((field << 3) | 2);
    const fork = writer.fork();
    for (const value of values) {
        fork.double(value);
    }
    fork.ldelim();
};

const encodeBytesField = (writer, field, message, key) => {
    if (own(message, key) && message[key] && message[key].length > 0) {
        writer.uint32((field << 3) | 2);
        writer.bytes(message[key]);
    }
};

const encodeRepeatedBytes = (writer, field, values) => {
    if (!values || values.length === 0) {
        return;
    }
    for (const value of values) {
        writer.uint32((field << 3) | 2);
        writer.bytes(value);
    }
};

onnx.StringStringEntryProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'key');
    encodeStringField(writer, 2, message, 'value');
    encodeUnknown(writer, message);
};

onnx.OperatorSetIdProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'domain');
    encodeInt64Field(writer, 2, message, 'version');
    encodeUnknown(writer, message);
};

onnx.TensorShapeProto.Dimension.encode = (writer, message) => {
    encodeInt64Field(writer, 1, message, 'dim_value');
    encodeStringField(writer, 2, message, 'dim_param');
    encodeStringField(writer, 3, message, 'denotation');
    encodeUnknown(writer, message);
};

onnx.TensorShapeProto.encode = (writer, message) => {
    encodeRepeatedSubmessage(writer, 1, message.dim, onnx.TensorShapeProto.Dimension.encode);
    encodeUnknown(writer, message);
};

onnx.TypeProto.Tensor.encode = (writer, message) => {
    encodeInt32Field(writer, 1, message, 'elem_type');
    if (message.shape) {
        encodeSubmessage(writer, 2, message.shape, onnx.TensorShapeProto.encode);
    }
    encodeUnknown(writer, message);
};

onnx.TypeProto.Sequence.encode = (writer, message) => {
    if (message.elem_type) {
        encodeSubmessage(writer, 1, message.elem_type, onnx.TypeProto.encode);
    }
    encodeUnknown(writer, message);
};

onnx.TypeProto.Map.encode = (writer, message) => {
    encodeInt32Field(writer, 1, message, 'key_type');
    if (message.value_type) {
        encodeSubmessage(writer, 2, message.value_type, onnx.TypeProto.encode);
    }
    encodeUnknown(writer, message);
};

onnx.TypeProto.Optional.encode = (writer, message) => {
    if (message.elem_type) {
        encodeSubmessage(writer, 1, message.elem_type, onnx.TypeProto.encode);
    }
    encodeUnknown(writer, message);
};

onnx.TypeProto.SparseTensor.encode = (writer, message) => {
    encodeInt32Field(writer, 1, message, 'elem_type');
    if (message.shape) {
        encodeSubmessage(writer, 2, message.shape, onnx.TensorShapeProto.encode);
    }
    encodeUnknown(writer, message);
};

onnx.TypeProto.Opaque.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'domain');
    encodeStringField(writer, 2, message, 'name');
    encodeUnknown(writer, message);
};

onnx.TypeProto.encode = (writer, message) => {
    if (message.tensor_type) {
        encodeSubmessage(writer, 1, message.tensor_type, onnx.TypeProto.Tensor.encode);
    }
    if (message.sequence_type) {
        encodeSubmessage(writer, 4, message.sequence_type, onnx.TypeProto.Sequence.encode);
    }
    if (message.map_type) {
        encodeSubmessage(writer, 5, message.map_type, onnx.TypeProto.Map.encode);
    }
    if (message.optional_type) {
        encodeSubmessage(writer, 9, message.optional_type, onnx.TypeProto.Optional.encode);
    }
    if (message.sparse_tensor_type) {
        encodeSubmessage(writer, 8, message.sparse_tensor_type, onnx.TypeProto.SparseTensor.encode);
    }
    if (message.opaque_type) {
        encodeSubmessage(writer, 7, message.opaque_type, onnx.TypeProto.Opaque.encode);
    }
    encodeStringField(writer, 6, message, 'denotation');
    encodeUnknown(writer, message);
};

onnx.ValueInfoProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'name');
    if (message.type) {
        encodeSubmessage(writer, 2, message.type, onnx.TypeProto.encode);
    }
    encodeStringField(writer, 3, message, 'doc_string');
    encodeRepeatedSubmessage(writer, 4, message.metadata_props, onnx.StringStringEntryProto.encode);
    encodeUnknown(writer, message);
};

onnx.TensorProto.Segment.encode = (writer, message) => {
    encodeInt64Field(writer, 1, message, 'begin');
    encodeInt64Field(writer, 2, message, 'end');
    encodeUnknown(writer, message);
};

onnx.TensorProto.encode = (writer, message) => {
    encodePackedInt64(writer, 1, message.dims);
    encodeInt32Field(writer, 2, message, 'data_type');
    if (message.segment) {
        encodeSubmessage(writer, 3, message.segment, onnx.TensorProto.Segment.encode);
    }
    if (message.float_data && message.float_data.length > 0) {
        encodePackedFloat(writer, 4, message.float_data);
    }
    encodePackedInt32(writer, 5, message.int32_data);
    encodeRepeatedBytes(writer, 6, message.string_data);
    encodePackedInt64(writer, 7, message.int64_data);
    encodeStringField(writer, 8, message, 'name');
    encodeStringField(writer, 12, message, 'doc_string');
    encodeBytesField(writer, 9, message, 'raw_data');
    encodeRepeatedSubmessage(writer, 13, message.external_data, onnx.StringStringEntryProto.encode);
    encodeInt32Field(writer, 14, message, 'data_location');
    if (message.double_data && message.double_data.length > 0) {
        encodePackedDouble(writer, 10, message.double_data);
    }
    encodePackedInt64(writer, 11, message.uint64_data);
    encodeRepeatedSubmessage(writer, 16, message.metadata_props, onnx.StringStringEntryProto.encode);
    encodeUnknown(writer, message);
};

onnx.SparseTensorProto.encode = (writer, message) => {
    if (message.values) {
        encodeSubmessage(writer, 1, message.values, onnx.TensorProto.encode);
    }
    if (message.indices) {
        encodeSubmessage(writer, 2, message.indices, onnx.TensorProto.encode);
    }
    encodePackedInt64(writer, 3, message.dims);
    encodeUnknown(writer, message);
};

onnx.AttributeProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'name');
    encodeStringField(writer, 21, message, 'ref_attr_name');
    encodeStringField(writer, 13, message, 'doc_string');
    encodeInt32Field(writer, 20, message, 'type');
    encodeFloatField(writer, 2, message, 'f');
    encodeInt64Field(writer, 3, message, 'i');
    encodeBytesField(writer, 4, message, 's');
    if (message.t) {
        encodeSubmessage(writer, 5, message.t, onnx.TensorProto.encode);
    }
    if (message.g) {
        encodeSubmessage(writer, 6, message.g, onnx.GraphProto.encode);
    }
    if (message.sparse_tensor) {
        encodeSubmessage(writer, 22, message.sparse_tensor, onnx.SparseTensorProto.encode);
    }
    if (message.tp) {
        encodeSubmessage(writer, 14, message.tp, onnx.TypeProto.encode);
    }
    if (message.floats && message.floats.length > 0) {
        encodePackedFloat(writer, 7, message.floats);
    }
    encodePackedInt64(writer, 8, message.ints);
    encodeRepeatedBytes(writer, 9, message.strings);
    encodeRepeatedSubmessage(writer, 10, message.tensors, onnx.TensorProto.encode);
    encodeRepeatedSubmessage(writer, 11, message.graphs, onnx.GraphProto.encode);
    encodeRepeatedSubmessage(writer, 23, message.sparse_tensors, onnx.SparseTensorProto.encode);
    encodeRepeatedSubmessage(writer, 15, message.type_protos, onnx.TypeProto.encode);
    encodeUnknown(writer, message);
};

onnx.IntIntListEntryProto.encode = (writer, message) => {
    encodeInt64Field(writer, 1, message, 'key');
    encodePackedInt64(writer, 2, message.value);
    encodeUnknown(writer, message);
};

onnx.SimpleShardedDimProto.encode = (writer, message) => {
    encodeInt64Field(writer, 1, message, 'dim_value');
    encodeStringField(writer, 2, message, 'dim_param');
    encodeInt64Field(writer, 3, message, 'num_shards');
    encodeUnknown(writer, message);
};

onnx.ShardedDimProto.encode = (writer, message) => {
    encodeInt64Field(writer, 1, message, 'axis');
    encodeRepeatedSubmessage(writer, 2, message.simple_sharding, onnx.SimpleShardedDimProto.encode);
    encodeUnknown(writer, message);
};

onnx.ShardingSpecProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'tensor_name');
    encodePackedInt64(writer, 2, message.device);
    encodeRepeatedSubmessage(writer, 3, message.index_to_device_group_map, onnx.IntIntListEntryProto.encode);
    encodeRepeatedSubmessage(writer, 4, message.sharded_dim, onnx.ShardedDimProto.encode);
    encodeUnknown(writer, message);
};

onnx.NodeDeviceConfigurationProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'configuration_id');
    encodeRepeatedSubmessage(writer, 2, message.sharding_spec, onnx.ShardingSpecProto.encode);
    encodeInt32Field(writer, 3, message, 'pipeline_stage');
    encodeUnknown(writer, message);
};

onnx.NodeProto.encode = (writer, message) => {
    encodeRepeatedString(writer, 1, message.input);
    encodeRepeatedString(writer, 2, message.output);
    encodeStringField(writer, 3, message, 'name');
    encodeStringField(writer, 4, message, 'op_type');
    encodeStringField(writer, 7, message, 'domain');
    encodeStringField(writer, 8, message, 'overload');
    encodeRepeatedSubmessage(writer, 5, message.attribute, onnx.AttributeProto.encode);
    encodeStringField(writer, 6, message, 'doc_string');
    encodeRepeatedSubmessage(writer, 9, message.metadata_props, onnx.StringStringEntryProto.encode);
    encodeRepeatedSubmessage(writer, 10, message.device_configurations, onnx.NodeDeviceConfigurationProto.encode);
    encodeUnknown(writer, message);
};

onnx.TensorAnnotation.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'tensor_name');
    encodeRepeatedSubmessage(writer, 2, message.quant_parameter_tensor_names, onnx.StringStringEntryProto.encode);
    encodeUnknown(writer, message);
};

onnx.TrainingInfoProto.encode = (writer, message) => {
    if (message.initialization) {
        encodeSubmessage(writer, 1, message.initialization, onnx.GraphProto.encode);
    }
    if (message.algorithm) {
        encodeSubmessage(writer, 2, message.algorithm, onnx.GraphProto.encode);
    }
    encodeRepeatedSubmessage(writer, 3, message.initialization_binding, onnx.StringStringEntryProto.encode);
    encodeRepeatedSubmessage(writer, 4, message.update_binding, onnx.StringStringEntryProto.encode);
    encodeUnknown(writer, message);
};

onnx.GraphProto.encode = (writer, message) => {
    encodeRepeatedSubmessage(writer, 1, message.node, onnx.NodeProto.encode);
    encodeStringField(writer, 2, message, 'name');
    encodeRepeatedSubmessage(writer, 5, message.initializer, onnx.TensorProto.encode);
    encodeRepeatedSubmessage(writer, 15, message.sparse_initializer, onnx.SparseTensorProto.encode);
    encodeStringField(writer, 10, message, 'doc_string');
    encodeRepeatedSubmessage(writer, 11, message.input, onnx.ValueInfoProto.encode);
    encodeRepeatedSubmessage(writer, 12, message.output, onnx.ValueInfoProto.encode);
    encodeRepeatedSubmessage(writer, 13, message.value_info, onnx.ValueInfoProto.encode);
    encodeRepeatedSubmessage(writer, 14, message.quantization_annotation, onnx.TensorAnnotation.encode);
    encodeRepeatedSubmessage(writer, 16, message.metadata_props, onnx.StringStringEntryProto.encode);
    encodeUnknown(writer, message);
};

onnx.DeviceConfigurationProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'name');
    encodeInt32Field(writer, 2, message, 'num_devices');
    encodeRepeatedString(writer, 3, message.device);
    encodeUnknown(writer, message);
};

onnx.FunctionProto.encode = (writer, message) => {
    encodeStringField(writer, 1, message, 'name');
    encodeRepeatedString(writer, 4, message.input);
    encodeRepeatedString(writer, 5, message.output);
    encodeRepeatedString(writer, 6, message.attribute);
    encodeRepeatedSubmessage(writer, 11, message.attribute_proto, onnx.AttributeProto.encode);
    encodeRepeatedSubmessage(writer, 7, message.node, onnx.NodeProto.encode);
    encodeStringField(writer, 8, message, 'doc_string');
    encodeRepeatedSubmessage(writer, 9, message.opset_import, onnx.OperatorSetIdProto.encode);
    encodeStringField(writer, 10, message, 'domain');
    encodeStringField(writer, 13, message, 'overload');
    encodeRepeatedSubmessage(writer, 12, message.value_info, onnx.ValueInfoProto.encode);
    encodeRepeatedSubmessage(writer, 14, message.metadata_props, onnx.StringStringEntryProto.encode);
    encodeUnknown(writer, message);
};

onnx.ModelProto.encode = (writer, message) => {
    encodeInt64Field(writer, 1, message, 'ir_version');
    encodeRepeatedSubmessage(writer, 8, message.opset_import, onnx.OperatorSetIdProto.encode);
    encodeStringField(writer, 2, message, 'producer_name');
    encodeStringField(writer, 3, message, 'producer_version');
    encodeStringField(writer, 4, message, 'domain');
    encodeInt64Field(writer, 5, message, 'model_version');
    encodeStringField(writer, 6, message, 'doc_string');
    if (message.graph) {
        encodeSubmessage(writer, 7, message.graph, onnx.GraphProto.encode);
    }
    encodeRepeatedSubmessage(writer, 14, message.metadata_props, onnx.StringStringEntryProto.encode);
    encodeRepeatedSubmessage(writer, 20, message.training_info, onnx.TrainingInfoProto.encode);
    encodeRepeatedSubmessage(writer, 25, message.functions, onnx.FunctionProto.encode);
    encodeRepeatedSubmessage(writer, 26, message.configuration, onnx.DeviceConfigurationProto.encode);
    encodeUnknown(writer, message);
};

onnx.ModelProto.encodeBytes = (message) => {
    const writer = new BinaryWriter();
    onnx.ModelProto.encode(writer, message);
    return writer.finish();
};
// exports the onnx.ModelProto class to be used in other files
export { onnx };
