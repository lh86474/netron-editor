2026-06-11

Tags: [[other questions in cs]]
## what is YAML

### Notes

YAML (YAML Ain't Markup Language)
- Language of **configuration**
- Strip away all visual clutter that make JSON or XML annoying to read
- No curly braces, square brackets, quotation marks
- Uses spaces to figure out how data is nested

```
server:
  port: 8080
  environment: production
  features:
    - logging
    - metrics
```

king of configuration files
- Docker & Kubernetes: how virtual containers and server clusters should be built and connected
- CI/CD: how to automatically test and deploy code
- config.yaml to store API keys, dark mode default, port number

But, parser is heavy, easy to make whitespace errors
### References