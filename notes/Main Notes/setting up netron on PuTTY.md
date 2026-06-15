2026-06-09

Tags: [[ambarella]] [[netron]]
## setting up netron on PuTTY
### Notes
### Config email and username
 git config --global user.name "Luray He"
 git config --global user.email"c-lhe@ambarella.com"

hostname -I to get the IP (done in PuTTY)

- Go to Cursor
- do remote ssh in command panel

username@ip

Push all of my local branches onto the forked repo that I've created

git fetch all, and make sure to checkout to those branches

### startup
- switch to bash

Activate nvm (node version manager)
```
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
```

Verify that it works
npm -v


1. start server in terminal
	1. npm install --ignore-scripts if needed
	2. npm start
	3. make sure port is forwarded
		1. Go to ports tab in cursor, make sure there is a row wit h8080
	4. cd source
	5. python3 -m http.server 8080
	6. go to http://localhost:8080

npm install --ignore-scripts
- Just to get the Netron web viewer running
- download the js files and ignore all the secondary build steps

### Breaking down python3 -m http.server 8080
- Calls Python 3 interpreter
- -m module flag. 
	- Don't look for a local file: look inside your own internal library of pre-installed nmodules. 
	- http.server: the module that I'm asking Python to run. 
		- lightweight, fully functional web server. 
- 8080: the port number. the IP address like a street address for an apartment building


