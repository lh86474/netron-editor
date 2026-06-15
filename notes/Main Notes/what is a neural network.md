2026-06-04

Tags: [[neural networks]] [[machine learning]] [[deep learning]]

## what is a neural network

### Notes
- Neural networks were inspired by brains
A neuron is a thing that holds a number
### Example

- Let's say that we have a 28 x 28 picture
- I **want the computer to guess what number is in the 28x28 picture**
- 28 x 28 = 784, so we have 784 neurons
- Each neuron holds a number that represents the grayscale value of the corresponding pixel
- **The number is called Activation**
- Each Neuron is lit up when it is white

![[Pasted image 20260604165838.png]]


Those 784 numbers make up our **first layer of our network**

![[Pasted image 20260604165940.png]]

The last layer will be the layer that decides the output. 
- The Activation of the neurons in the last layer is how much a system thinks that the image corresponds to each digit. 


### Hidden layers
- They are the layers between the input and output layer
	- In the example, 2 layers, 16 neurons
	- an **arbitrary choice**
	- There is a lot of room to experiment and everything in practice

#### Each layer determines the activation for the next layer
**The heart of the network comes down to how these activations from one layer bring about activations to the next layer**

## Why the layers
- Let's think: When we recognize digits, we break down the digits into parts
- Let's say a 9: It has a top loop on the top and a vertical line on the bottom. 

The hope is that any loopy part sets off 

### How to learn the small loopy things
- We learn the edges that make it up, tiny edges
- Each neuron in the second layer is all of the little edges
- And hopefully, in the third layer, light up the bigger subcomponents like the loop and the lines
- And finally, hopefully it sets off the activation for the last layer to get the correct digit

### What parameters should the model have
- We assign a weight to each one of these connections
- The weights are just numbers
- Take all of the activation and compute weighted sum
	- Weights being organized into a little grid of their own
	- green pixels: positive
	- red: negative
### We want activations to be between 0 and 1
- That's why we pump the number into a function that squishes th enumber
	- Sigmoid: very negative gets close to 0, more positive = more close to 1

### Bias 
- What if we only want to active when weighted sum > 10
- We would subtract 10 from the weighted sum. That additional number is the bias. 
- Bias tells us how high weighted sum has to be to be activated

- Each neuron has a specific bias. 

### Learning: finding a valid setting for finding the right weights and biases
- tweak the numbers so 2nd layer gets the edges
- tweak the 3rd so it finds the loops and vertical lines


### Actual function (sigmoid) is too hard to write down

A more notationally compact way to represent the biases, weights, activations

### Activations from one layer as a vector

### All weights as a matrix, each row connects to one layer and a particular neuron in the next layer
[[how data in nns are represented in matrices]]


![[Pasted image 20260604171429.png]]

Weighted sum corresponds to one of the terms in the matrix vector product that we have 


![[Pasted image 20260604171633.png]]

We put all of the biases in the layer into a vector


![[Pasted image 20260604171657.png]]


In a tight and little expression, we communicate full transition of activations from one layer to another
- Ignore the diagram, it's quite misleading actually
- The matrix, the bias thing acts basically as a way to calculate what's going to be on the next layer, the activation on the next layer
- So, the diagram shouldn't just be the neurons going to one neuron on the next layer, but going to all of the neurons on the next layer. 

Makes code much simpler and faster: libraries optimize the heck out of matrix multiplication

### Neuron is like a function
- Takes the output of the neurons from previous layer and spits out a number between 0 and 1
### Neural networks is a very complicated function
- A big big function that takes in lots of input

### References

[But what is a neural network? | Deep learning chapter 1](https://www.youtube.com/watch?v=aircAruvnKk&t=501s)