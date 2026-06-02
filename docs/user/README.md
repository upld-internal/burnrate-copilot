# burnrate-copilot — User Guide

Real-time cost and context display for GitHub Copilot CLI.

![](../images/Statusline.png)

---

## Table of Contents

| Page | Description |
|------|-------------|
| [Quick Start](./quick-start.md) | Installation, requirements, and first steps |
| [Widget Reference](./widgets.md) | Every widget: options, output examples, example configs |

---

## What is burnrate-copilot?

burnrate-copilot is a GitHub Copilot CLI plugin that adds cost visibility and workflow tooling to your Copilot sessions.

**Statusline** — A footer updated on every turn showing session cost, month-to-date spend, context window usage, active model, git branch, and Jira ticket.

**Cost summary** — `/burnrate:burnrate-cost-summary` produces a structured monthly spend report broken down by project, model, and Jira ticket.

**Optimize** — `/burnrate:burnrate-optimize` analyzes 30 days of session records and produces a scored health report with prioritized recommendations for reducing cost.

All data is stored locally. The only outbound call is to GitHub's own billing API to fetch your monthly quota (the same figures shown on your GitHub billing dashboard). See [How costs are calculated](./quick-start.md#how-costs-are-calculated) for details.

---

## How MTD cost works

Month-to-date cost is fetched from GitHub's internal quota API every 5 minutes and cached locally. The displayed value reflects your actual billing for the full month — not just sessions recorded since the plugin was installed.

When the API is unavailable, the display falls back to summing your local session records. Stale values (cache older than 5 minutes) are shown with a `~` prefix.

---

## Quick navigation

- **Installing for the first time** → [Quick Start: Installation](./quick-start.md#installation)
- **Changing what appears in the statusline** → [Quick Start: Configuring widgets](./quick-start.md#configuring-widgets)
- **Full widget reference with all options** → [Widget Reference](./widgets.md)
- **Running the cost summary** → [Quick Start: Skills](./quick-start.md#skills)
- **Jira integration** → [Quick Start: Jira Integration](./quick-start.md#jira-integration)
- **Fallback behavior when something goes wrong** → [Quick Start: Fallback behavior](./quick-start.md#fallback-behavior)
