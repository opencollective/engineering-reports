# October 2026: open items before publishing

The draft was built on 2026-11-03 from a session that could read the board only through GitHub issue search: the Status column was not visible and no board changes could be applied.

- **Up next is empty and left out.** The Status column wasn't readable, so no card could be identified as `Next`. Add `next` if some cards have that status.
- **Ongoing** holds #8984 (Servers and dependencies up to date) and #8994 (Review security tickets), as the operator named them. #8984 lists the 11 PRs from its body merged in October. #8994's sub-issues live in the private security repository and could not be read, so the card shows no count for October; the "Security fixes" misc entry moved into its summary.
- **Pull requests merged** covers the five service repositories (API 82, frontend 62, REST 13, PDF 11, images 10; September 70/58/8/2/7). Other repositories with merged PRs in October are not counted: token-bot 37, contributors-svg 14, opencollective-watch 12, documentation 6, monorepo 5, renovate-config 4, discover 2, graphql-docs-v2 2, monerium-bot 2, stripe-bot 2, opencollective-tools 1. Confirm whether contributors-svg and opencollective-watch count as services.
- **No screenshots.** Of the PRs behind shipped items and misc entries, only opencollective-frontend#12614 (CSV preview) has screenshots, hosted on gist.githubusercontent.com, which this session's network policy blocked. Save them into `images/` by hand to include them.
- **#9053** (added to In progress by the operator) has a Start date of Nov 5, after the period, so the report shows none.
- **In progress is inferred** from open cards with activity in October, not from their Status.
- **Areas guessed for cards with none set:** #9026 Internationalization improvements → Improvements; #8977 Connect services to Sentry → Reliability & monitoring.
- **Issues closed** has no September comparison: most of October's 118 come from filling in the board, which would make the jump misleading.
- **Board data to check:** #8998 has a Target date (2026-08-21) before its Start date (2026-09-01), so it is left out of October's shipped list; #8935 closed on Oct 19 but has a Target date of Oct 30; #8997, #8975 and #9001 are open with Target dates that have passed.
- **Proposed board changes awaiting approval:**
  - New card "Tax form improvements for hosts" (Compliance) for opencollective-api#12035, #12375, #12396, #12398, #12403, #12405 and opencollective-frontend#12354, #12480, #12628. These are listed under misc until the card exists.
  - Possible new card for the Open Source Collective application flow (opencollective-api#12381, opencollective-frontend#12615).
  - Nest opencollective-api#11964 under #9008; opencollective-api#12276 and opencollective-frontend#12519 under #8824; opencollective-api#11335 and opencollective-frontend#11810 under #8998; opencollective-api#12370 and opencollective-frontend#12604, #12612 under #8935; opencollective-api#12371 and opencollective-frontend#12340 under #8977 (uncertain).
