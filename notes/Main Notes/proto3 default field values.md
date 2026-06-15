2026-06-01

Tags: 
## proto3 default field values

### Notes
- For strings, the default value is the empty string.
- For bytes, the default value is empty bytes.
- For bools, the default value is false.
- For numeric types, the default value is zero.
- For message fields, the field is not set. Its exact value is language-dependent. See the [generated code guide](https://protobuf.dev/reference/) for details.
- For enums, the default value is the **first defined enum value**, which must be 0. See [Enum Default Value](https://protobuf.dev/programming-guides/proto3/#enum-default).

The default value for repeated fields is empty (generally an empty list in the appropriate language).

The default value for map fields is empty (generally an empty map in the appropriate language).

[Language Guide (proto 3) | Protocol Buffers Documentation](https://protobuf.dev/programming-guides/proto3/#default)