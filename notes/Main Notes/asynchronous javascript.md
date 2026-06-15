2026-06-03

Tags: [[javascript]]
## asynchronous javascript

### Notes
- Allows my program to handle long-running tasks without blocking the main thread
#### Async and await keywords
- async function returns a promise
- await keyword pauses the execution of the function until the promise is resolved
	- Can only be used inside an async function

Javascript is single threaded, so it can only handle one thing at a time

```
async function myFunction() {
	return "Hello";
}

async function myDisplay() {
	let myPromise = new Promise(function(resolve) {
		resolve("I love you !!");	
	});
	document.getElementById("demo").innerHTML = await myPromise;
}
```

```
async function getUserData() {
  try {
    // The function pauses here until the fetch is complete
    const response = await fetch('https://jsonplaceholder.typicode.com/users/1');
    const user = await response.json();
    console.log(user.name);
  } catch (error) {
    console.error("Oops, an error occurred:", error);
  }
}

getUserData();
```
- Here, the function pauses the function at that specific line, but does not pause the rest of my program



### References