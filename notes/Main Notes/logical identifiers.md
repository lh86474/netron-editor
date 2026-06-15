2026-06-01

Tags: [[ambarella]] [[protobuf]]
## logical identifiers

### Notes

Usually, programs use memory addresses and offsets to find a specific variable

#### But when it is serialized into text (Like JSON)
- It uses **string keys to identify variables**
	- The computer has to read every single character to figure out what the value means
```
{
  "layer_type": "Dense",
  "filters": 128
}
```

### Protobuf way
- Binary formats use a predefined contract (the schema) to assign a logical identifier
- The logical identifier is an integer

```
message Layer {
  string layer_type = 1;
  int32 filters = 2;
}
```

- When Protobuf serializes the data, it disregards "layer_type or filters", but writes a tiny binary Tag that says
	- The next piece of data belongs to Field 1, and it's a string

- What are the fields?
	- **The fields are unique identifiers**
	- tag 1 represents layer_type
	- tag 2 represents filters

This is just like ordering at a restaurant
I might have something like
item: spicy garlic chicken

But, I could do
item: 42
- As in item 42. When I order, I can just write down 42. 42 is the logical identifier

The chef looks at 42, cross-references it with the menu (the menu is like the .proto file), and then it knows to cook the spicy garlic chicken. The chef saved a lot of reading time, I saved ink and paper

The visualizer **sees the tag**, doesn't know what field 1 means, but cross-references the .proto schema. It sees that 1 corresponds to layer_type, and understands exactly what to do with the string

Let's say I have string name = 1;
This makes the whole system click into place
- The parser reads tag 1: it knows it's reading **the name of the attribute**
	- It looks at the very next tag, it gets a 2, oh it must be a float
	- it gets 8 from repeated int64 ints = 8. Oh, the value this value is a list of integers
	
### References