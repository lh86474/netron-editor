2026-06-11

Tags: [[other questions in cs]]
## what is inter-process communication IPC

### Notes

IPC: set of mechanisms that allow different, isolated programs (or processes) to share data and talk to each other
OS keep processes separated so if one crashes, it doesn't take down the whole computer

Electron apps are split into two main parts
1. Main process (runs in background, full access to OS)
2. Renderer process: visible UI: runs like a web page, restricted access
	1. Not allowed to do stuff like resize window. **Has to use IPC to ask the Main process to do it**
```
// The UI asking the background process to close the window
electron.ipcRenderer.sendSync('window-close', {});
```

### References