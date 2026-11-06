---
type: regex
pattern: '^(?![\s\S]*(?:created_at))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:(?:DATE\()?created_at\)?)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.167
target:
  source: file
  path: out/page.content.js
---
