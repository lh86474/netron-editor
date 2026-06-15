2026-06-09

Tags: [[ambarella]] [[machine learning]]
## sharding in machine learning

### Notes

- It means to split datasets or model components into smaller manageable parts
	- Those manageable parts are called shards

Shards can be processed in parallel across multiple devices or workers. 
- Crucial for scaling training for models like LLMs, where memory and compute demands exceed the capacity of a single GPU
- data pipeline: ensure each worker processes a unique subset of data, avoiding duplication and improve throughput

Model training: split parameters, gradients, and optimizer states across devices to fit massive models into limited GPU memory
### References