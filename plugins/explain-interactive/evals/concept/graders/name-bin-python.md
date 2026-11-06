---
type: regex
pattern: '^(?![\s\S]*(?:bin/python))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:\.venv/)?bin/python3?)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.143
target:
  source: file
  path: out/page.content.js
---
