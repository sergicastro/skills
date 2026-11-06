---
type: regex
pattern: '^(?![\s\S]*(?:note_history))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:note_history)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.1
target:
  source: file
  path: out/page.content.js
---
