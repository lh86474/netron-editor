2026-06-01
## what is json

[[ambarella]] [[protobuf]]
### Notes

Json: javascript object notation
- Most popular text-based format for storing and moving data across the internet
	- Is language-independent

Objects in {}
- Like a dict in hash map. We have a key followed by colon, value
- Arrays: ordered lists

{
  "layer_id": "conv_1",
  "type": "Convolutional",
  "is_active": true,
  "filters": 64,
  "learning_rate": 0.001,
  "input_nodes": ["input_0", "input_1"],
  "hyperparameters": {
    "stride": 2,
    "padding": "same"
  },
  "biases": null
}

### Rules
1. Keys must be strings
	1. In double quotes
2. Permitted values
	1. string
	2. number
	3. boolean
	4. array
	5. object
	6. null
#### Json vs binary
- Json is very human-readable
- schemaless flexibility
	- We don't need a .proto contract to read a JSON file
### Why JSON fails in ML
- layer_id is repeated as text for every single layer
	- If I have like 1 million nodes, I'm storying characters layer_id a million times
-  string parsing is slow
- No binary data, no native way to store a lot of raw binary weights
### References