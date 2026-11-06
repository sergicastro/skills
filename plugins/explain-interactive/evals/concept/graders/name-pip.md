---
type: regex
pattern: '^(?![\s\S]*(?:\bpip\b))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:pip)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.143
target:
  source: file
  path: out/page.content.js
---
