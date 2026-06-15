2026-06-09

Tags: [[ambarella]] 
## backing up obsidian in github

### Notes

git init in obsidian folder
git add .
git commit -m"initial backup"
git remote set-url origin (insert HTTP)
- Using ssh will not work since Ambarella corporate firewall will block it

git push -u origin main

### Everyday
Make sure to do
git add .
git commit -m"date's notes"
git push
### References