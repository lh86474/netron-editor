2026-06-15

Tags: [[system administration]]
## scp secure copy protocol

### Notes

This is used when I need to copy files or from a remote server over SSH, scp does the job with a single command. 
1. relies on SSH
2. The colon is how scp distinguishes between local and remote paths. 
3. read permission on the source and write permission on the destination
4. overwrites files without warning when the source and destination share the same name
5. 
### Syntax
```
scp [OPTIONS] [[user@]host:]source [[user@]host:]destination
```

common options
```
- `-P` — Remote host SSH port (uppercase P)
- `-p` — Preserve modification time, access time, and mode
- `-r` — Copy directories recursively
- `-C` — Compress data during transfer
- `-q` — Suppress the progress meter and non-error messages
- `-i` — Path to the SSH private key (identity file)
- `-l` — Limit bandwidth in Kbit/s
- `-o` — Pass an SSH option (e.g., `-o StrictHostKeyChecking=no`)
- `-3` — Route traffic between two remote hosts through the local machine
- `-O` — Force the legacy SCP protocol instead of SFTP
```
### Example
1. Copy a local file to a remote system

```
scp file.txt remote_username@10.10.0.2:/remote/directory
```
### References

[scp Command in Linux: Secure File Transfer Examples | Linuxize](https://linuxize.com/post/how-to-use-scp-command-to-securely-transfer-files/)