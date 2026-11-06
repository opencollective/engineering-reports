# Engineering reports

Periodic reports on what the Open Collective engineering team shipped and is working on, built from the [Engineering Board](https://github.com/orgs/opencollective/projects/21). They are written for the team and for fiscal hosts.

This repository holds both the reports and the tooling that produces them:

| Path | What it is |
|---|---|
| `reports/<YYYY-MM>/report.json` | One report per period: the content only, with screenshots it uses in `images/` beside it. |
| `.agents/skills/oc-engineering-board/` | The agent skill that maintains the board and writes reports (`SKILL.md`, `references/report.md`). |
| `.agents/skills/oc-engineering-board/scripts/build-report.mjs` | Validates a `report.json` and renders it into one self-contained HTML page (screenshots inlined). |
| `.agents/skills/oc-engineering-board/assets/report/` | Shared design (`style.css`) and a complete example (`example.json`). |
| `scripts/build-site.mjs` | Builds the GitHub Pages site: every non-draft report plus an index. |

`.claude/skills` links to `.agents/skills`, so Claude Code picks up the skill when it runs in this repository.

## Writing a report

Ask an agent with the skill for a period, for example "generate a report for November". It follows [`references/report.md`](.agents/skills/oc-engineering-board/references/report.md): it asks two scope questions, researches the board and the merged pull requests, proposes board changes for approval, then writes `reports/<YYYY-MM>/report.json`.

New reports start with `"draft": false`, so merging their pull request publishes them. Reports with `"draft": true` are validated in CI but not published; use it only to keep a report off the site.

## Building locally

Requires Node.js 22 or later; there are no dependencies to install.

```bash
npm test             # tests for the report renderer
npm run build        # builds _site/ with every published (non-draft) report
npm run preview      # same, drafts included
node .agents/skills/oc-engineering-board/scripts/build-report.mjs reports/2026-10/report.json   # one report, written beside its JSON
```

## Publishing

The [workflow](.github/workflows/pages.yml) runs the tests and builds the site on every pull request. On `main` it deploys `_site/` to GitHub Pages, with each report at `/<YYYY-MM>/`. Pages must be set to deploy from **GitHub Actions** (Settings → Pages → Source).

To change the design of every report, edit `assets/report/style.css` or `build-report.mjs` and run `npm test`.
