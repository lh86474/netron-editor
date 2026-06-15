2026-06-01

Tags: 
## proto3 nested types

```
message SearchResponse {
  message Result {
    string url = 1;
    string title = 2;
    repeated string snippets = 3;
  }
  repeated Result results = 1;
}

```

It's just messages that are nested

To use the message type outside of the parent message type, we refer it to as parent.type

```
message SomeOtherMessage {
  SearchResponse.Result result = 1;
}

```

### Notes

### References