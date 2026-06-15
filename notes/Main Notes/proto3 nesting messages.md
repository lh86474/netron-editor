2026-06-01

Tags: 
## proto3 nesting messages

Complex, nested relationships

```
message Graph {
  // Using another message as an array
  repeated Node nodes = 1; 
  
  // A nested message definition
  message Metadata {
    string author = 1;
    int32 version = 2;
  }
  
  Metadata info = 2;
}
```
### Mutually Exclusive Fields: oneof

```
message TensorData {
  oneof payload {
    bytes raw_data = 1;
    string file_path = 2;
  }
}
```
- Protobuf equivalent of a C union!
- Tells the compiler: object will contain exactly one of these fields: if set one, clear the others. 
- Very useful for saving memory!


### Notes
### References