2026-06-01

Tags: [[ambarella]] [[protobuf]]
## proto3 - defining a message type

### Notes

#### Defining a Message Type

- Example, defining a search request message format

#### Why so many messages

This is the .proto file I'll use to define the message type

```
syntax = "proto3";

message SearchRequest {
  string query = 1;
  int32 page_number = 2;
  int32 results_per_page = 3;
}

```

1. First line specifies what protobuf language specification that I'm using

Here, in this example, SearchRequest defines three name/value pairs. 
- Each field has a name and a type

### Specifying filed types
- All fields are going to be **scalar types**
	- we specify it before the name, like int32, string
		- Notice that we have stuff like int32... how interesting!

### Assigning Field Numbers
1. Each field has a logical identifier of **between 1 and 537,870,911**
2. Field numbers 19,000 to 19,999 are **reserved for the Protocol Buffers implementation**
3. This number **cannot be changed once my message type is in use**
4. Should never reused


### Lower field number values take less space in the wire format
- So, use field numbers 1 - 15 **so you use less bytes**
	- I have **7 bits total for my tag data**
		- 3 bits for wire type
		- 4 bits for field number
		- 1st bit (MSB) is used as a stoplight
			- If first bit is 0: stop reading, this is last byte
			- first bit 1: keep reading, there is another byte
- Field numbers 16-2047 take two bytes

### What if you use it again
- developer time lost to debugging (ambiguous)
	- parse / merge error (best scenario)
- Data corruption

### Specifying field cardinality

- It's how many times a specific piece of data is allowed to appear in a single object
	- singular: zero or one. By default, a **field has singular cardinality**
		- At most once
	- Repeated: zero or infinite
		- repeated string inputs = 2;
#### Repeated is for defining stuff like arrays

```
message Tensor {
  repeated int64 dimensions = 1; // e.g., [1, 3, 224, 224]
  repeated float weights = 2;    // A massive array of packed floats
}
```
	- optional: field is set: contain a value that was explicitly set or parsed from wire: will be serialized to the wire. 
		- If unset, return default value
### repeated fields of scalar numeric types use packed encoding by default
[Tag] [Total Byte Length] [10] [20] [30]

Writes the tag exactly once

### Comments
- Just like java

### In .proto files, use as little message types as possible
- Can lead to dependency bloat
	- excessive accumulation of software dependencies that complicate maintenance, increase security vulnerabilities, slow down development process

### Reserving field numbers

- Future developers can reuse the field number
- If we update a message type by entirely deleting a field or commenting it out, it might lead toissues. 

add the deleted number to reserved list

```
message Foo {
  reserved 2, 15, 9 to 11;
}

```
protc will generate errors if future developers try to use this

### Reserving field names
```
message Foo {
  reserved 2, 15, 9 to 11;
  reserved "foo", "bar";
}

```
### References