---
# demo-w-c's REQUEST gets its own `request` call, then a SendMessage to demo-w-c carrying an ASSIGN or NONE_READY
type: regex
pattern: 'request\s+demo\s+demo-w-c\b[\s\S]*?SendMessage[\s\S]{0,80}?\bdemo-w-c\b[\s\S]*?\[orch v1 (?:ASSIGN|NONE_READY)\]'
target: last_message
---
