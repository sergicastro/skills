---
type: regex
pattern: '^(?![\s\S]*(?:test_report_groups_by_day))|(?:CAST|GLOSSARY)\s*=\s*\{(?:(?!\n\})[\s\S])*?(?<=[{,\n][\t ]*)["''`]?(?:test_report_groups_by_day)(?:\(\))?["''`]?\s*:'
flags: i
weight: 0.167
target:
  source: file
  path: out/page.content.js
---
