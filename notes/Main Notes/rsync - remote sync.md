2026-06-15

Tags: [[system administration]]
## rsync - remote sync

### Notes

It is usually preinstalled in most Linux distros, windows, and macOS

The syntax
```
# Local to Local:
rsync [OPTION]... [SRC]... DEST

# Local to Remote:
rsync [OPTION]... [SRC]... [USER@]HOST:DEST

# Remote to Local:
rsync [OPTION]... [USER@]HOST:SRC... [DEST]
```

### Common Options

![[Pasted image 20260615160652.png|415]]

It's always a good idea to perform a dry run first because rsync can overwrite files


### References