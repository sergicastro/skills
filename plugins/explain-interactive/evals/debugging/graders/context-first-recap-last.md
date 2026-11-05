---
type: llm
focus:
  source: file
  path: out/page.content.js
---
This is an explainer page's content file (a JavaScript file declaring META, STEPS and more). PASS only if both hold: (1) the first element of STEPS is a Context step: it has a `context` field (an object with question, setting, why, prereqs, example); (2) the last element of STEPS is a Recap: its title is "Recap" (or starts with it) and it has no `context` field. FAIL if the file is missing or empty.
