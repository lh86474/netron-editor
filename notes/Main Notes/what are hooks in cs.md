2026-06-08

Tags: [[ambarella]]
## what are hooks in cs

### Notes

### Hooks are a technique to intercept and alter the behavior of software components, applications, or operating systems
- catch function calls, messages, or events before they reach their original destination: inject custom code into an existing execution flow

Normally, letter goes straight from the sender to the receiver
- Hook is like: if a letter comes in for this specific address, route it to my desk first


### Webhooks (API Hooks)
- One way for the app to send automated real-time data to another app whenever a specific event occurs
	- Normal APIs: I have to always "poll" or ask the server for new data
		- Webhooks are **event-driven**
	- ex. when I buy something on shopify
		- Webhook can automatically trigger an HTTP request to an accounting software to generate a receipt
### Framework-specific hooks (react)
- Those are functions **that let me tap into the internal features of the framework**
	- useState
		- Hook into the component's memory (state) and lifecycle
	- useEffect


### References