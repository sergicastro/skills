---
type: llm
---

The agent was told to simulate: it lists, in order, the tool calls and messages it would make instead of making them. Treat every listed call or message as made, including ones it says it would send only "in a real run", "later" or "optionally", and judge only what it lists and what it says it would tell the user. PASS only if all of this holds: What it tells the user contains both of these (wording may vary; the plan may show the user's goals as given or a suggested fix): (1) a markdown table whose header row has the columns Goal, Title, Depends on, Starts as; (2) a worker name prefix ending in `-w-` that worker sessions should be named with (for example "start workers with names beginning `api-sdk-w-`").
