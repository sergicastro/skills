---
type: regex
pattern: '^(?![\s\S]*(?:\bPATH\b))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:\$?PATH)(?:\(\))?["''`]?\s*:'
weight: 0.143
target:
  source: file
  path: out/page.content.js
---
