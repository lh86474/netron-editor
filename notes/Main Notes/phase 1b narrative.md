2026-06-08

Tags: [[ambarella]] [[netron]]

## phase 1b narrative
1. Start Netron and open any model.
2. In devtools console:
### Notes

### 1. "Generalize the editor's clone into a read-model adapter..."

- **The translation:** Make the Photocopy machine act like a Universal Translator.
    
- **Why:** Netron doesn't just read one file type; it reads dozens (ONNX, TensorFlow, PyTorch, etc.). An "adapter" is a piece of code that sits in the middle. No matter what weird file format Netron opens, this adapter translates it into our standard, editable "Photocopy" format.
    
### 2. "...that consumes any Netron model (getter-based fields, array-valued arguments)..."

- **The translation:** Make sure the adapter can handle Netron's weird internal code structure.
    
- **Why:** The people who wrote Netron used specific JavaScript tricks (like "getter" functions, which calculate values on the fly instead of storing them normally). If our Photocopy machine doesn't know how to read these tricks, it will copy empty pages. This instructs the AI to write code that explicitly looks for these edge cases.
    
### 3. "...while keeping Phase 1 tests green,"

- **The translation:** Don't break the stuff we already built.
    
- **Why:** "Green" refers to passing automated tests. As we upgrade the Photocopy machine to handle complex ONNX files, we must make sure it can still pass the basic, simple tests we wrote in Phase 1.
    
### 4. "...verify it against a synthetic ONNX-shaped contract,"

- **The translation:** Test it with a fake, but highly realistic, ONNX file.
    
- **Why:** Before we hook this up to the real app, we want the AI to write a test script using a "synthetic" (fake) model that mimics the exact shape and complexity of an ONNX file. This proves our adapter actually works on hard stuff, not just easy stuff.
    
### 5. "...then wire a non-invasive EditSession into view.View.open()..."

- **The translation:** Carefully plug our new Editor Brain into Netron's "Open File" button without breaking it.
    
- **Why:** `view.View.open()` is the core function in Netron that runs when you drop a file into the app. We need to attach our `EditSession` (the Coordinator that manages the Photocopy and the Notepad) right at this moment. "Non-invasive" means we do it gently—we add a couple of lines of code to trigger our stuff, rather than rewriting Netron's entire loading sequence.
    

### 6. "...with a browser debug global."

- **The translation:** Give us a secret cheat code to look under the hood while we test.
    
- **Why:** When you are building UI tools, it's hard to tell if the hidden data is actually updating correctly. A "browser debug global" means attaching our Editor Brain to the browser window (e.g., `window.__debugEditorState`). This allows us to open the Chrome Developer Console, type that command, and instantly see a readout of all the changes we've made to ensure the code is working behind the scenes.
    

**In Summary:**

The sentence is commanding the AI: _"Upgrade our copy-paste logic to handle Netron's weird file formats, prove it works with a fake complex file, make sure the old tests still pass, plug it gently into Netron's loading screen, and give me a way to check the data in the browser console."_
### References