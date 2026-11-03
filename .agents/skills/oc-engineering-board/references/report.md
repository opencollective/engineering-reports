# Period report

A report covers one period (usually a calendar month: "the engineering work in October") and is published on GitHub Pages from the [opencollective/engineering-reports](https://github.com/opencollective/engineering-reports) repository, which also holds this skill. Every report has the same structure and design: the content goes into a `report.json`, and `scripts/build-report.mjs` renders it with `assets/report/style.css` into one self-contained HTML file. Edit the shared assets to change the design for all reports, and run `node --test scripts/build-report.test.mjs` from the skill folder after; write content only into `report.json`. When the board gains or renames an Engineering Area, update `AREAS` in the script (it sets each area's order and color).

Readers are the team and fiscal hosts. Write for them: plain language, user-visible impact, no internal jargon.

## 1. Scope

Resolve the period to exact dates (`2026-10-01` to `2026-10-31`; "last month" is relative to today). Then ask the operator two questions in one message, before any research:

- **In progress**: include current work in progress and upcoming priorities, or only work done during the period?
- **Off-board work**: include work merged in the API and frontend repositories that is not on the board?

Record the answers as `scope.inProgress` and `scope.offBoard`. The renderer shows or hides sections from these flags.

Reports live in `reports/<YYYY-MM>/` at the root of the engineering-reports repository (period start month; use `<start>_<end>` for other periods). Only `report.json` is committed; the HTML is built. If the directory already holds a `report.json`, ask whether to update it or start over. Keep raw research data (PR lists, board dumps) out of the repository.

## 2. Off-board research (only when `scope.offBoard`)

Do this before writing anything, so the operator can fix the board first.

1. **Merged PRs**: list everything merged in the period in the API and frontend repositories. Drop dependency bots (`renovate[bot]`, `dependabot[bot]`). Keep other bot authors such as `sentry[bot]` autofixes: their merged PRs are real fixes.

   ```bash
   gh search prs --repo opencollective/opencollective-api --repo opencollective/opencollective-frontend \
     --merged-at 2026-10-01..2026-10-31 --limit 1000 --json url,title,author,closedAt,repository,body \
     | jq '[.[] | select(.author.login | test("^(renovate|dependabot)\\[bot\\]$") | not)]'
   ```

   The search API returns at most 1000 results; split the period if it hits the cap.

2. **Board coverage**: a PR is on the board when it is linked work (the evidence query in `SKILL.md`) of a board item or one of its sub-issues, or when its body references one of them. Read every board item that was active in the period, not only `Done` ones.
3. **Classify** each remaining PR, clustering related PRs by theme first:
   - **Nest**: the work belongs to an active board project. Propose an existing issue to attach as a sub-issue, or a new sub-issue that records the PRs.
   - **New card**: a theme large enough to be a project of its own (one large PR, or many related ones). Propose a board card under the main skill's rules for creating items.
   - **Misc**: small, self-contained fixes and improvements with no clear project. These go in the report's "Misc fixes and improvements" section, not on the board.
   - **Leave out**: chores invisible to users (lint, test-only tweaks, CI bumps, reverted work). Count them, don't list them.
4. **Present the overview**: one table per class, each row with the PR links, a one-line plain description, and the proposed target. Ask the operator to confirm the board changes and the misc list. Apply approved board changes with the main skill's preview-then-apply flow, then re-read the board, since the report is built from it.

Security fixes never get a descriptive line. Fold them into one misc entry such as "Security fixes" linking to no PR, and keep details in the private repository (see "Security work" in `SKILL.md`).

## 3. Gather board data

Read the board (`SKILL.md`, "Read the board") and each item's issue fields. Use parent cards (items without a parent issue) as report items; sub-issues feed their parent's counts and summary.

- **Shipped**: `Done` cards whose Target date (or `closedAt` when unset) falls in the period.
- **In progress** (only with `scope.inProgress`): `In progress` cards, plus `Ongoing` cards that had activity in the period.
- **Next** (only with `scope.inProgress`): `Next` cards.

For each item collect: title, URL, Engineering Area, Start and Target dates, sub-issue progress (`done`/`total`), merged PR count in the period, and the PR authors (GitHub logins, bots excluded).

**Metrics**, all for the period, using the `scope.repos` repositories:

- `prsMerged`: merged PRs, dependency bots excluded.
- `issuesClosed`: issues in `opencollective/opencollective` closed as completed: `gh search issues reason:completed --repo opencollective/opencollective --closed 2026-10-01..2026-10-31 --limit 1000 --json url | jq length`.
- `contributors`: distinct human PR authors.

`Projects shipped` is computed from the `shipped` list. When the previous period's `report.json` exists, copy its metric values as `previous` and its `shipped` length as `shippedPrevious`; otherwise compute them for the previous period of equal length, or omit them.

## 4. Write `report.json`

`assets/report/example.json` shows every field. Shape:

- `period`: `label` ("October 2026"), `start`, `end` (ISO dates).
- `generatedOn`: today's date.
- `scope`: `inProgress`, `offBoard` (booleans), `repos` (the repositories the metrics and off-board research covered).
- `summary`: one to three short paragraphs: what the period was about and the work that mattered most to users. Write it last, from the items.
- `metrics`: `prsMerged`, `issuesClosed`, `contributors`, each `{ "value": n, "previous": n }` (`previous` optional), an optional `shippedPrevious`, and `previousLabel` ("September 2026") when any previous value is set.
- `shipped`, `inProgress`, `next`: board items `{ title, url, area, summary, start, end, subIssues: { done, total }, prs, people }`. Only `title`, `url` and `area` are required. `area` is an Engineering Area option name. `inProgress` and `next` are present exactly when `scope.inProgress` is true.
- `misc`: `{ title, url, kind }` where `kind` is `fix` or `improvement` and `url` is the PR (or omitted for the folded security entry). Present exactly when `scope.offBoard` is true.

Item summaries are one or two sentences on what changed for users, and why it matters. References like `opencollective/opencollective#123` in summaries become links.

## 5. Build, check, publish

```bash
node .agents/skills/oc-engineering-board/scripts/build-report.mjs <dir>/report.json   # writes <dir>/report.html (git-ignored)
```

The script validates the JSON and fails with a list of problems; fix them and rerun. Then read `report.html` back for empty sections and broken text. `npm run preview` builds the whole site, drafts included, into `_site/`.

A report starts with `"draft": true` at the top of `report.json`. Drafts are validated in CI but left off the public site. While a report is a draft, share it for review as a private cloud artifact titled `Engineering report: <period label>` when the session can publish artifacts, otherwise give the operator the file path. Remove the `draft` flag only once the operator approves the report.

Commit `report.json` on a branch and open a pull request in the engineering-reports repository; CI runs the tests and builds the site. Merging to `main` publishes every non-draft report to GitHub Pages at `<site>/<YYYY-MM>/`, with an index of all reports at the site root. To revise a published report, edit `report.json` and open another pull request.
