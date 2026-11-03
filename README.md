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

New reports start with `"draft": true`. Drafts are validated in CI and shown in the pull request preview, but not published. Remove the flag when the report is approved.

## Building locally

Requires Node.js 22 or later; there are no dependencies to install.

```bash
npm test             # tests for the report renderer
npm run build        # builds _site/ with every published (non-draft) report
npm run preview      # same, drafts included
node .agents/skills/oc-engineering-board/scripts/build-report.mjs reports/2026-10/report.json   # one report, written beside its JSON
```

## Publishing

The [build workflow](.github/workflows/pages.yml) runs the tests and builds the site on every pull request. On `main` it pushes `_site/` to the `gh-pages` branch, which GitHub Pages serves, with each report at `/<YYYY-MM>/`.

Every pull request from a branch of this repository also gets a preview of the site, drafts included, at `https://opencollective.github.io/engineering-reports/pr-preview/pr-<number>/` ([preview workflow](.github/workflows/preview.yml), using [pr-preview-action](https://github.com/rossjrw/pr-preview-action)). A bot comment on the pull request links to it, and the preview is removed when the pull request closes. Pull requests from forks get no preview.

Repository settings this needs:

- **Settings → Pages → Source**: Deploy from a branch, `gh-pages`, `/ (root)`. The branch is created by the first preview or `main` deploy.
- **Settings → Actions → General → Workflow permissions**: Read and write permissions.

To change the design of every report, edit `assets/report/style.css` or `build-report.mjs` and run `npm test`.
