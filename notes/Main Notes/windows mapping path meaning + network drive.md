2026-06-09

Tags: [[ambarella]]
## windows mapping path meaning

### Notes

Varun's statement confused me 
```
"\\ambfs\cv2work\ is windows mapping path for /cv2/work/ in ubuntu"
```
Those are the same physical files, but translated through two different operating systems
IN corporate environments, common to have files on Linux server while developers access them from Windows laptops

#### Windows side

```
\\ambfs\cv2work\
```
This is called a UNC (Universal Naming Convention) path. 

Windows **uses backslashes and a format to talk to network drives**
```
\\ServerName\ShareName format
```

ambfs is the hostname of the file server on my company's network
cv2work is the share name: the label the server broadcasts to the network to represent that specific folder

### Ubuntu side
- Linux uses forward slashes and a single, unified file tree that starts from the root /
- absolute path to where those files actually exists

### The bridge
- Ubuntu server runs a background service (usually called Samba)
- configured to look at the /cv2/work/ directory and broadcast it out to the Windows network under the alias cv2work
Any change I make to a file on my Windows machine using the 
```
\\ambfs\... instantly happens to the /cv2/work/... path on the Ubuntu side
```


### Network drive

- A hard drive that lives in a central server, but made accessible over a network as if it were plugged directly into my own computer
- A localized, private version of Google Drive or Dropbox

Normally, when I save a file to my C: drive, it is written to the physical memory chip inside my laptop. If my laptop breaks, the file is gone

With a network drive, the files **live on a massive, secure server, like company's Ubuntu machine**

- Through software like Samba, that server broadcasts access to those files over company Wi-Fi or ethernet cables

### How the Mapping works
- Windows allows us to map these network locations
- We take a UNC path and assign it a letter on my computer, like the Z: drive
- It's just like a USB thumb drive plugged into my laptop. 
- Window is instantly beaming those changes across the nework to the Ubuntu server

If my coworker and I need to edit the same Netron project, we don't email ZIP files back and forth: just open the network drive

### How to use this

If you just want to quickly browse the files or drag-and-drop something, you can treat it like a website URL for your local network.

1. Open **Windows File Explorer** (press the `Windows Key + E`).
    
2. Click directly into the **address bar** at the top (where it usually says "This PC" or "Home").
    
3. Delete whatever is there, paste `\\ambfs\cv2work\` and hit **Enter**.
    
###  Map a Network Drive (The Best Way)

If you are going to be working with these files daily, you can map the path to a drive letter (like `Z:`). This tricks your Windows computer into treating that Ubuntu folder exactly like a physical hard drive or a USB thumb drive plugged into your laptop.

1. Open **File Explorer** and click on **This PC** in the left sidebar.
    
2. Look at the top menu ribbon and click **Map network drive** (you might need to click the three dots `...` or "See more" if you are on Windows 11).
    
3. A window will pop up:
    
    - **Drive:** Pick any available letter you like (e.g., `Z:` or `U:`).
        
    - **Folder:** Paste in `\\ambfs\cv2work\`.
        
    - Ensure **Reconnect at sign-in** is checked so it survives a reboot.
        
4. Click **Finish**.
    

Now, whenever you open File Explorer, you will see a new `Z:` drive sitting right next to your regular `C:` drive. You can open files directly from it using any standard Windows program, or even drag that folder straight into Cursor!