2026-06-09

Tags: [[ambarella]] [[netron]]
## protobuf.js BinaryWriter

### Notes

BinaryWriter is designed to efficiently construct binary data, definitely for protocols and protocol buffers
- It builds and compresses binary data chunk by chunk

#### Constructor()
- empty array of chunks to hold pieces of binary data
- concat(chunks)
	- glues multiple Uint8ARray chunks together into one solid block
- encodeTag(tag)
	- convert a field tag into uint32 binary format
- toBigInt(value)
	- make into BigInt
	- ensure massive numbers don't break the system
- encodeVarint(value)
	- compresses integer into a "varint"
	- save space by using fewer bytes
- finish()

Finish returns a Uint8Array payload

### Encoding methods

```
   double(value) {
		// 1 byte equals 8 bits, this gives 64 bits of space
        const bytes = new Uint8Array(8);
		// Uint8ARray is for 8-bit integers
		// access bytes.buffer. 
		// .buffer is raw, underlying chunk of computer memory holding those 8 zeros. wrap that raw memory in a DataView
		// DataView is a translator. Lets us look at araw chunk of memory and say, "I know this is 8 separate bytes, but I want you to treat them as asingle , complex 64-bit decimal"
		
        new DataView(bytes.buffer).setFloat64(0, value, true);
		// The .setfloat64 is the actual encoding
		// 0 is the offset
		// value: actual number I pass into the function
		// true: endianess. forces in little-endian format
		// little-endian matters because protocol buffers and ONNX mandate little-endian so that the binary is universally readable
        this.raw(bytes);
		// bytes array is not a list of zeros. it gets 
		// handed off to this.raw()
		raw append it to the main BinaryWRiter queue to be gleud into the final .onnx file

    }
```
