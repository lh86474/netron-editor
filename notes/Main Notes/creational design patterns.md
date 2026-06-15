2026-06-04

Tags: [[ambarella]] [[software engineering]] [[software architecture]]

## creational design patterns

### Notes

### What are they?
- They focus on the process of object creation or problems related to object creation. 
- Make a system independent of how its objects are created, composed, and represented. 
- Give a lot of flexibility

#### Characteristics
1. Keep information about the specific classes used in the system hidden
2. Hide the details of how instances of these classes are created and assembled
#### Example
- We want to make different types of toys like Car, Doll, or Robot
- Instead of creating each toy yourself, we ask the factory to make it for you
- Program doesn't care about how the toy is made - it just gets the toy ready to use

## Types of Creational Design Pattern
1. Singleton Method Design Pattern
	1. a class only has one instance: provide a global point of access to it. 
2. Abstract factory method design pattern
	1. another layer of abstraction over factory pattern. 
	2. work around a super-factory which creates other factories
3. Factory Method Design Pattern
	1. A class **can't anticipate** the class of objects it must create
	2. wants its subclass to specify the objects it creates
	3. delegate responsibility to one of helper subclasses to localize knowledge of which helper subclass is the delegate

### References

[Creational Design Patterns - GeeksforGeeks](https://www.geeksforgeeks.org/system-design/creational-design-pattern/)