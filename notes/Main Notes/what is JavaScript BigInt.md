2026-06-08

Tags: [[ambarella]] [[netron]]
## what is Javascript BigInt

### Notes

BigInt is a primitive data type in JavaScript that allows the representation of integers larger than the maximum safe integer limit of Number
- Good with dealing with large numbers beyond the Number range. 
- The limit is 53 bits

Can't mix BigInt with other types: potential loss of precision

### Creating BigInt
- Can append n to end of integer literal or by calling the BigInt() function

const bigIntFromNumber = BigInt(123);
const bigIntValue = 1n;


### References