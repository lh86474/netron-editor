2026-06-01

[[ambarella]] [[protobuf]]
## what is a schema, what is .proto

### Notes

#### What is a data blueprint
- 
#### Schema is a broad concept of a data blueprint
- .proto is the **specific file used by Protocol Buffers to write the blueprint down**
- Has the structure, what object 
	- The how: format of data
	- username must be text
	- age must be a whole number
- The rules
	- some things must be mandatory
		- Like op_type
- The relationships (connections)
	- map how different pieces of data relate to one another

### What is a .proto
- the .proto is a **plain text file that contains the schema specifically for Protocol Buffers**
	- Written in Interface Definition Language (IDL)

#### Tells us how the engineers designed the binary data structure
- 
### Example
In C, **struct is a blueprint**
- Java is a blueprint

#### Example of what is inside .proto
```
syntax = "proto3";

// This is the schema for a single Neural Network Node
message NodeProto {
  string name = 1;              // The logical ID is 1, expects text
  string op_type = 2;           // The logical ID is 2, expects text
  repeated string input = 3;    // The logical ID is 3, expects an array of text
  repeated string output = 4;   // The logical ID is 4, expects an array of text
}
```

### References