2026-06-11

Tags: [[ambarella]] [[other questions in cs]]
## ISP to NVP pipeline

### Notes

- The Image signal processor (ISP) processes raw sensor data: does [[image correction]], and writes the clean frames to a designated DRAM buffer. 
- To run a NN on that frame, the hardware doesn't duplicate the big image file. Instead, the ISP and NVP exchange buffer ownership. The NVP uses its DMA engines to stream that specific DRAM buffer into its memory to execute the network
### References