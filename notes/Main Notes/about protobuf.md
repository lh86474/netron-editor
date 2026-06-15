2026-06-01

Tags: [[ambarella]] [[protobuf]]
## about protobuf

### Notes

Developed by google
- Language-neutral, platform-neutral

### The Process
1. Define a .proto file
	1. .proto file using Protocol Buffer's interface definition language
	2. define message types
		1. The message things are like classes and structs
		2. 
```
syntax = "proto3";

message Person {
  string name = 1;
  int32 id = 2;
  repeated string email = 3;
}
```

2. Compile the .proto file
	1. We use the protobuf compiler (protoc) to generate code in our desired programming language
		1. What's the point of compiling these things?
			1. 
	2. The generated code handle serialization and deserialization of our data
	```
	protoc --proto_path=. --python_out=. your_proto_file.proto
	```
3. Serialize data
	1. We first make instances of the generated classes
	2. We set the data
	3. Then, we use **methods** to serialize the data into a binary format
```
import addressbook_pb2

person = addressbook_pb2.Person()
person.name = "John"
person.id = 123
person.email.append("john@example.com")

# Serialize to bytes
serialized_data = person.SerializeToString()
```

4. Deserialize data
	1. We receive the data over a network or from a storage
		1. We get the serialized bytes
	2. We use **methods to parse the serialized data into an instance of the generated class**
	3. We access the data

```
# Assume serialized_data contains the serialized bytes
person = addressbook_pb2.Person()
person.ParseFromString(serialized_data)

print(f"Name: {person.name}")
print(f"ID: {person.id}")
for email in person.email:
    print(f"Email: {email}")
```
### References