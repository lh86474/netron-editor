2026-06-01

Tags: [[ambarella]] [[protobuf]]
## proto3 using other message types

### Notes

```
message SearchResponse {
  repeated Result results = 1;
}

message Result {
  string url = 1;
  string title = 2;
  repeated string snippets = 3;
}

```

I can use Result variables in SearchResponse

### Importing definitions
```
import "myproject/other_protos.proto";

```

I can use definitions from other .proto files by importing them
### References