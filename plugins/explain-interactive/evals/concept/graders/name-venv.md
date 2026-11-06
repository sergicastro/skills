---
type: regex
pattern: '^(?![\s\S]*(?:\.venv\b))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:\.?venv)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.143
target:
  source: file
  path: out/page.content.js
---
