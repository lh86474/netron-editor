2026-06-08

Tags: [[ambarella]] [[netron]]
## graph-pane.js

### Notes
- manager for half split-screen layout

Before, Netron assumed that there was only one screen and one graph
- split-screen: need a wrapper to keep the two sides isolated from each other: wrapper is GraphPane

The Stage for each side: the rules
- left is readOnly, right is for editing

Identity: holdsthe paneID so that when shapes are drawn: internal SVG IDs are namespaced like modified-arrowhead
### Namespace

- zone or context for a common name: a label or a prefix that keeps names organized so they don't collide or overwrite each other, like using last names if two people have the same first name


### References