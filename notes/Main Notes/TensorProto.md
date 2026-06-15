2026-06-10

Tags: [[onnx]] [[ambarella]]
## TensorProto

### Notes
This is a big mouthful of stuff
1. We first have every single data type that could be stored int he tensor
2. There are some weird ones that I've never heard of, like what the hell is float8e4m3fn 
	1. Used to support deep learning stuff
3. At **repeated int64 dims = 1;**
	1. We actually get to defining the tensor
	2. shape of tensor, how many dims it is, 2D, 3D, 4D
4. int 32 data_type = 2;
	1. For big tensors, they store in chunks: specify the segment that is stored in the current TensorProto
	2. message Segment {
	3.  int64 begin = 1;
	4.  int64 end = 2;
	5. }
5. 

```
message TensorProto {
  enum DataType {
    UNDEFINED = 0;
    // Basic types.
    FLOAT = 1;   // float
    UINT8 = 2;   // uint8_t
    INT8 = 3;    // int8_t
    UINT16 = 4;  // uint16_t
    INT16 = 5;   // int16_t
    INT32 = 6;   // int32_t
    INT64 = 7;   // int64_t
    STRING = 8;  // string
    BOOL = 9;    // bool

    // IEEE754 half-precision floating-point format (16 bits wide).
    // This format has 1 sign bit, 5 exponent bits, and 10 mantissa bits.
    FLOAT16 = 10;

    DOUBLE = 11;
    UINT32 = 12;
    UINT64 = 13;
    COMPLEX64 = 14;     // complex with float32 real and imaginary components
    COMPLEX128 = 15;    // complex with float64 real and imaginary components

    // Non-IEEE floating-point format based on IEEE754 single-precision
    // floating-point number truncated to 16 bits.
    // This format has 1 sign bit, 8 exponent bits, and 7 mantissa bits.
    BFLOAT16 = 16;

    // Non-IEEE floating-point format based on papers
    // FP8 Formats for Deep Learning, https://arxiv.org/abs/2209.05433,
    // 8-bit Numerical Formats For Deep Neural Networks, https://arxiv.org/pdf/2206.02915.pdf.
    // Operators supported FP8 are Cast, CastLike, QuantizeLinear, DequantizeLinear.
    // The computation usually happens inside a block quantize / dequantize
    // fused by the runtime.
    FLOAT8E4M3FN = 17;    // float 8, mostly used for coefficients, supports nan, not inf
    FLOAT8E4M3FNUZ = 18;  // float 8, mostly used for coefficients, supports nan, not inf, no negative zero
    FLOAT8E5M2 = 19;      // follows IEEE 754, supports nan, inf, mostly used for gradients
    FLOAT8E5M2FNUZ = 20;  // follows IEEE 754, supports nan, not inf, mostly used for gradients, no negative zero

    // 4-bit integer data types
    UINT4 = 21;  // Unsigned integer in range [0, 15]
    INT4 = 22;   // Signed integer in range [-8, 7], using two's-complement representation

    // 4-bit floating point data types
    FLOAT4E2M1 = 23;

    // E8M0 type used as the scale for microscaling (MX) formats:
    // https://www.opencompute.org/documents/ocp-microscaling-formats-mx-v1-0-spec-final-pdf
    FLOAT8E8M0 = 24;

    // 2-bit integer data type
    UINT2 = 25; // Unsigned integer in range [0, 3]
    INT2 = 26;  // Signed integer in range [-2, 1], using two's complement representation

    // Future extensions go here.
  }

  // The shape of the tensor.
  repeated int64 dims = 1;

  // The data type of the tensor.
  // This field MUST have a valid TensorProto.DataType value
  int32 data_type = 2;

  // For very large tensors, we may want to store them in chunks, in which
  // case the following fields will specify the segment that is stored in
  // the current TensorProto.
  message Segment {
    int64 begin = 1;
    int64 end = 2;
  }
  Segment segment = 3;

  // Tensor content must be organized in row-major order.
  //
  // Depending on the data_type field, exactly one of the fields below with
  // name ending in _data is used to store the elements of the tensor.

  // For float and complex64 values
  // Complex64 tensors are encoded as a single array of floats,
  // with the real components appearing in odd numbered positions,
  // and the corresponding imaginary component appearing in the
  // subsequent even numbered position. (e.g., [1.0 + 2.0i, 3.0 + 4.0i]
  // is encoded as [1.0, 2.0 ,3.0 ,4.0]
  // When this field is present, the data_type field MUST be FLOAT or COMPLEX64.
  repeated float float_data = 4 [packed = true];

  // For int32, uint8, int8, uint16, int16, uint4, int4, uint2, int2, bool, (b)float16, float8, and float4:
  // - (b)float16 and float8 values MUST be converted bit-wise into an unsigned integer
  //   representation before being written to the buffer.
  // - Each pair of uint4, int4, and float4 values MUST be packed as two 4-bit elements into a single byte.
  //   The first element is stored in the 4 least significant bits (LSB),
  //   and the second element is stored in the 4 most significant bits (MSB).
  // - Each group of four uint2, int2 values MUST be packed as four 2-bit elements into a single byte.
  //   The elements are packed from LSB to MSB, with the first element in bits 0-1, second element in bits 2-3,
  //   third element in bits 4-5, and fourth element in bits 6-7.
  //
  // Consequently:
  // - For data types with a bit-width of 8 or greater, each `int32_data` stores one element.
  // - For 4-bit data types, each `int32_data` stores two elements.
  // - For 2-bit data types, each `int32_data` stores four elements.
  //
  // When this field is present, the data_type field MUST be
  // INT32, INT16, INT8, INT4, INT2, UINT16, UINT8, UINT4, UINT2, BOOL, FLOAT16, BFLOAT16, FLOAT8E4M3FN, FLOAT8E4M3FNUZ, FLOAT8E5M2, FLOAT8E5M2FNUZ, FLOAT8E8M0, FLOAT4E2M1
  repeated int32 int32_data = 5 [packed = true];

  // For strings.
  // Each element of string_data is a UTF-8 encoded Unicode
  // string. No trailing null, no leading BOM. The protobuf "string"
  // scalar type is not used to match ML community conventions.
  // When this field is present, the data_type field MUST be STRING
  repeated bytes string_data = 6;

  // For int64.
  // When this field is present, the data_type field MUST be INT64
  repeated int64 int64_data = 7 [packed = true];

  // Optionally, a name for the tensor.
  string name = 8; // namespace Value

  // A human-readable documentation for this tensor. Markdown is allowed.
  string doc_string = 12;

  // Serializations can either use one of the fields above, or use this
  // raw bytes field. The only exception is the string case, where one is
  // required to store the content in the repeated bytes string_data field.
  //
  // When this raw_data field is used to store tensor value, elements MUST
  // be stored in as fixed-width, little-endian order.
  // Floating-point data types MUST be stored in IEEE 754 format.
  // Complex64 elements must be written as two consecutive FLOAT values, real component first.
  // Complex128 elements must be written as two consecutive DOUBLE values, real component first.
  // Boolean type MUST be written one byte per tensor element (00000001 for true, 00000000 for false).
  // uint4 and int4 values must be packed to 4bitx2, the first element is stored in the 4 LSB and the second element is stored in the 4 MSB.
  // uint2 and int2 values must be packed to 2bitx4, with elements packed from LSB to MSB in a single byte as: x0 | (x1 << 2) | (x2 << 4) | (x3 << 6)
  // where x0, x1, x2, x3 are consecutive elements.
  //
  // Note: the advantage of specific field rather than the raw_data field is
  // that in some cases (e.g. int data), protobuf does a better packing via
  // variable length storage, and may lead to smaller binary footprint.
  // When this field is present, the data_type field MUST NOT be STRING or UNDEFINED
  bytes raw_data = 9;

  // Data can be stored inside the protobuf file using type-specific fields or raw_data.
  // Alternatively, raw bytes data can be stored in an external file, using the external_data field.
  // external_data stores key-value pairs describing data location. Recognized keys are:
  // - "location" (required) - POSIX filesystem path relative to the directory where the ONNX
  //                           protobuf model was stored
  // - "offset" (optional) - position of byte at which stored data begins. Integer stored as string.
  //                         Offset values SHOULD be multiples 4096 (page size) to enable mmap support.
  // - "length" (optional) - number of bytes containing data. Integer stored as string.
  // - "checksum" (optional) - SHA1 digest of file specified in under 'location' key.
  repeated StringStringEntryProto external_data = 13;

  // Location of the data for this tensor. MUST be one of:
  // - DEFAULT - data stored inside the protobuf message. Data is stored in raw_data (if set) otherwise in type-specified field.
  // - EXTERNAL - data stored in an external location as described by external_data field.
  enum DataLocation {
    DEFAULT = 0;
    EXTERNAL = 1;
  }

  // If value not set, data is stored in raw_data (if set) otherwise in type-specified field.
  DataLocation data_location = 14;

  // For double
  // Complex128 tensors are encoded as a single array of doubles,
  // with the real components appearing in odd numbered positions,
  // and the corresponding imaginary component appearing in the
  // subsequent even numbered position. (e.g., [1.0 + 2.0i, 3.0 + 4.0i]
  // is encoded as [1.0, 2.0 ,3.0 ,4.0]
  // When this field is present, the data_type field MUST be DOUBLE or COMPLEX128
  repeated double double_data = 10 [packed = true];

  // For uint64 and uint32 values
  // When this field is present, the data_type field MUST be
  // UINT32 or UINT64
  repeated uint64 uint64_data = 11 [packed = true];

  // Named metadata values; keys should be distinct.
  repeated StringStringEntryProto metadata_props = 16;
}
```
### References