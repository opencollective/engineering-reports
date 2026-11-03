# Agent instructions

This repository holds Open Collective's engineering reports and the `oc-engineering-board` skill that produces them (`.agents/skills/oc-engineering-board/`). Read the skill's `SKILL.md` before touching the board or a report.

- Report content goes only in `reports/<YYYY-MM>/report.json`. Never commit built HTML, `_site/`, or raw research data.
- New reports carry `"draft": true`; only the operator decides when to remove it.
- After changing the renderer, the stylesheet or the example, run `npm test` and `npm run preview`.
- Reports and the site are readable by fiscal hosts: never put security vulnerability details in them (see "Security work" in `SKILL.md`).
- Changes go through a pull request; merging to `main` publishes the site.
