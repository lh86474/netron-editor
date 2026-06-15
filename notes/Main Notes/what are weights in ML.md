2026-06-02

Tags: [[ambarella]] [[machine learning]] [[onnx]]
## what are weights in ML

### Notes

weights is just industry jargon for slope or multiplier
- Determine how much influence or importance a specific piece of input data should have on the final prediction

In our linear regression example x @ a + c
- We want to predict an outcome based on some data
- our input x might contain three features
	- square footage
	- number of bedrooms
	- age of house
Our weight matrix might assign a negative weight to age because older houses might lose value
- square footage: massive positive weight to price

### About B<1>
- MatMul Node has a weight initializer of <1> 
- Our model only had one input feature:
	- single measurable property
	- Like a characteristic
### References