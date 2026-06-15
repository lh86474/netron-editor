2026-06-01

Tags: [[ambarella]] [[protobuf]]
## proto3 enum

### Notes

This must be used **when a field is only allowed predefined values**
- The first value in an enum must always map to 0. 
- 0 is the default fallback
```
enum DataType {
  UNDEFINED = 0;
  FLOAT32 = 1;
  INT8 = 2;      // Often used for quantized DSP models
  FLOAT16 = 3;
}

message Tensor {
  DataType data_type = 1;
}
```

It looks like I don't specify the field type at all

### Prefixing Enum Values

```
enum DeviceTier {
  DEVICE_TIER_UNKNOWN = 0;
  DEVICE_TIER_1 = 1;
  DEVICE_TIER_2 = 2;
}

```

If we have
int 1 tier;
int 1;
- We will crash the compiler
- The actual name of the enum value must be a legal word
```
enum DeviceTier {
  DEVICE_TIER_1 = 1;
}
```
The Protobuf compiler tries to be helpful
- It sees that the parent name is DeviceTier, so it takes off Device_tier_, and what is left is just the number 1

So, we name it as 

**DEVICE_TIER_TIER1** to make sure that when the compiler strips the prefix, the leftover word is TIER1

### References
gemini, docs
[Language Guide (proto 3) | Protocol Buffers Documentation](https://protobuf.dev/programming-guides/proto3/#default)