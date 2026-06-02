---
title: Home
nav_order: 1
---

# burnrate-copilot

Real-time cost tracking, usage analytics, and workflow tooling for GitHub Copilot CLI. Shows per-session token spend, month-to-date total, context window usage, model, git branch, and Jira — directly in the statusline, updated every turn.

![Statusline](images/Statusline.png)

Layout is fully configurable via `/burnrate:configure`.

---

## Why

GitHub Copilot CLI doesn't show you what you're spending. It tracks your quota and rate limits, but there's no running cost total, no month-to-date figure, and no way to see whether a long session is burning through your budget. This plugin adds all of that — directly in the footer, updated on every turn, stored locally with no external calls.

The goal is behavioral: when cost is visible in real time, you make different decisions. You compact earlier. You switch to a cheaper model for simple tasks. You notice when a session has gone off the rails.

---

## Features

- **Statusline** — per-session cost, MTD spend, context window, model, git branch, Jira ticket; updated every turn
- **`/burnrate:burnrate-cost-summary`** — monthly spend report by project, model, and Jira ticket
- **`/burnrate:burnrate-optimize`** — 30-day usage health score with prioritized cost-reduction recommendations

---

## Sections

| | |
|---|---|
| [User Guide](user/README.md) | Installation, configuration, widget reference |
| [Developer Guide](dev/README.md) | Architecture, data ingestion, cost calculation, quota API, hook scripts |
