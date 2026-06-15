2026-06-09

Tags: [[ambarella]] [[system administration]]
## forwarding a port meaning

### Notes

Ambarella's Ubuntu server is like a big, secure office building
- IP Address is the street address of the building
- Ports are the office doors inside the building

python3 -m http.server 8080: I put Netron inside "Office 8080"

Normally, if I wanted to enter, my Windows laptop would just walk up to the building and go to door 8080
- But, the building has a firewall (massive security fence). I will get blocked

### Solution: port forwarding
- This is where cursor's ports tab comes in
- cursor is already inside the building: it is allowed to bypass the fence. I tell cursor to forward port 8080: ask it to dig a private tunnel from my laptop into the office 8080 on the server

### Steps
- Cursor opens a fake door on your local Windows laptop and calls it **`localhost:8080`**.
    
- When you type `http://localhost:8080` into your web browser, your browser thinks it is talking to a web server running on your physical laptop.
    
- Instead, Cursor intercepts that traffic, sucks it down the secure SSH tunnel, and instantly pops it out on the Ubuntu server at the real port 8080.
    
- The Python server hands over the Netron files, and Cursor shoots them back down the tunnel to your screen.