---
type: regex
pattern: '^(?![\s\S]*(?:<code>events</code>|\bevents\s+table))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:events(?:\s+table)?)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.167
target:
  source: file
  path: out/page.content.js
---
