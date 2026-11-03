# Period report

A report covers one period (usually a calendar month: "the engineering work in October") and is published on GitHub Pages from the [opencollective/engineering-reports](https://github.com/opencollective/engineering-reports) repository, which also holds this skill. Every report has the same structure and design: the content goes into a `report.json` (plus optional screenshots beside it), and `scripts/build-report.mjs` renders it with `assets/report/style.css` into one self-contained HTML file. Edit the shared assets to change the design for all reports, and run `node --test scripts/build-report.test.mjs` from the skill folder after; write content only into `report.json` and its `images/`. When the board gains or renames an Engineering Area, update `AREAS` in the script (it sets each area's order and color); when a new service repository appears in the pull request breakdown, give it a short name in `REPO_LABELS`.

Readers are the team and fiscal hosts. Write for them: plain language, user-visible impact, no internal jargon. Every GitHub handle in the report links to its profile: the renderer does this for `people` and for `@login` in any text field.

## 1. Scope

Resolve the period to exact dates (`2026-10-01` to `2026-10-31`; "last month" is relative to today). Then ask the operator two questions in one message, before any research:

- **In progress**: include current work in progress and upcoming priorities, or only work done during the period?
- **Off-board work**: include work merged in the API and frontend repositories that is not on the board?

Record the answers as `scope.inProgress` and `scope.offBoard`. The renderer shows or hides sections from these flags.

Reports live in `reports/<YYYY-MM>/` at the root of the engineering-reports repository (period start month; use `<start>_<end>` for other periods). Only `report.json` and its `images/` are committed; the HTML is built. If the directory already holds a `report.json`, ask whether to update it or start over. Keep raw research data (PR lists, board dumps) out of the repository.

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

Give each misc entry a `topic` (a product area readers recognize: "Expenses & payouts", "Contributions", "Tax forms", "Hosting", "Accounts", "Dashboard & search", "API, integrations & emails"). The report groups the list by topic.

Security fixes never get a descriptive line. Mention them in the summary of the ongoing security card (`ongoing`, below) and keep details in the private repository (see "Security work" in `SKILL.md`). Without such a card, fold them into one misc entry such as "Security fixes" linking to no PR.

## 3. Gather board data

Read the board (`SKILL.md`, "Read the board") and each item's issue fields. Use parent cards (items without a parent issue) as report items; sub-issues feed their parent's counts and summary.

- **Shipped**: `Done` cards whose Target date (or `closedAt` when unset) falls in the period.
- **In progress** (only with `scope.inProgress`): `In progress` cards.
- **Ongoing**: `Ongoing` cards (continuous work such as security report handling or keeping servers and dependencies up to date) that had activity in the period. Their sub-issues and PR lists span years, so overall progress means nothing: collect only the sub-issues closed and the PRs merged **during the period**, and report those as the item's `done` list. For security cards, never list titles or links: say in the summary that reports were handled and fixes deployed. Sub-issues from the private security repository are not readable from most sessions; leave counts out rather than guessing.
- **Next** (only with `scope.inProgress`): `Next` cards.

A section with no items is left out of the report, header link included; omit the key or leave the array empty.

For each item collect: title, URL, Engineering Area, Start and Target dates, sub-issue progress (`done`/`total`), merged PR count in the period, and the PR authors (GitHub logins, bots excluded).

**Screenshots**: for shipped items (and in-progress items with something visible), read the bodies of their PRs merged in the period. When one has a screenshot that clearly shows the feature, use it: download it into `reports/<YYYY-MM>/images/` (PNG, JPEG or WebP, at most 1600 px wide and 400 KB; resize with ImageMagick or Pillow) and reference it from the item's `images`. Skip terminal output, code, debugging views, anything security related, and anything showing real personal data (names, emails, addresses, tax or bank details of real users; staging data is fine). PR images are usually on `github.com/user-attachments`, sometimes on `gist.githubusercontent.com`, which some sessions cannot reach: name the PR to the operator instead of routing around the block.

**Metrics**, all for the period:

- `prsMerged.byRepo`: merged PRs per service repository, dependency bots excluded: at least `opencollective-api`, `opencollective-frontend`, `opencollective-pdf`, `opencollective-rest` and `opencollective-images`, plus any other service that had merged PRs. Use one search over the organization and group by repository (`-author:app/renovate -author:app/dependabot`, 100 per page) rather than one search per repository, which hits GitHub's secondary rate limit. The report shows the total and one bar per repository; short names come from `REPO_LABELS` in the script.
- `issuesClosed`: issues in `opencollective/opencollective` closed as completed: `gh search issues reason:completed --repo opencollective/opencollective --closed 2026-10-01..2026-10-31 --limit 1000 --json url | jq length`.

When the previous period's `report.json` exists, copy its metric values as `previous`; otherwise compute them for the previous period of equal length, or omit them. Contributor counts and the number of projects shipped are not reported.

## 4. Write `report.json`

`assets/report/example.json` shows every field. Shape:

- `period`: `label` ("October 2026"), `start`, `end` (ISO dates).
- `generatedOn`: today's date.
- `scope`: `inProgress`, `offBoard` (booleans), `repos` (the repositories the metrics and off-board research covered).
- `summary`: the Highlights, three to five bullet points, one short line each (under 180 characters): the work that mattered most to users, stated plainly with no lead-in. Write it last, from the items.
- `metrics`: `prsMerged: { byRepo: [{ repo, value, previous }] }`, `issuesClosed: { value, previous }` (`previous` optional), and `previousLabel` ("September 2026") when any previous value is set.
- `shipped`, `inProgress`, `next`: board items `{ title, url, area, summary, start, end, subIssues: { done, total }, prs, people, images }`. Only `title`, `url` and `area` are required. `area` is an Engineering Area option name. `images` is a list of `{ src, alt, caption }` with `src` relative to `report.json`; the renderer inlines them and they open full size on click. `inProgress` and `next` may be present only when `scope.inProgress` is true.
- `ongoing`: board items as above, without `subIssues`, plus `done`: what was finished during the period, each `{ title, url }`, or `{ title, links: [url, url] }` for one change made in several repositories.
- `misc`: `{ title, url, kind, topic }` where `kind` is `fix` or `improvement` and `url` is the PR (or omitted for a folded security entry). Present exactly when `scope.offBoard` is true.

Item summaries are one or two sentences on what changed for users, and why it matters. Say when a feature is limited to some users (a team preview, a beta) and what comes next. References like `opencollective/opencollective#123` and `@login` in summaries become links.

Sections with several areas get quick filters by Engineering Area, and the misc list gets fix/improvement filters; the renderer adds them, nothing to write.

## 5. Build, check, publish

```bash
node .agents/skills/oc-engineering-board/scripts/build-report.mjs <dir>/report.json   # writes <dir>/report.html (git-ignored)
```

The script validates the JSON and fails with a list of problems; fix them and rerun. Then read `report.html` back for empty sections and broken text. `npm run preview` builds the whole site, drafts included, into `_site/`.

A report starts with `"draft": true` at the top of `report.json`. Drafts are validated in CI but left off the public site. While a report is a draft, share it for review as a private cloud artifact titled `Engineering report: <period label>` when the session can publish artifacts, otherwise give the operator the file path. Remove the `draft` flag only once the operator approves the report.

Commit `report.json` on a branch and open a pull request in the engineering-reports repository; CI runs the tests and builds the site. Merging to `main` publishes every non-draft report to GitHub Pages at `<site>/<YYYY-MM>/`, with an index of all reports at the site root. To revise a published report, edit `report.json` and open another pull request.
