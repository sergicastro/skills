---
type: regex
pattern: '^(?![\s\S]*(?:share_note))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:share_note)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.1
target:
  source: file
  path: out/page.content.js
---
