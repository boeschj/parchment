# Archived runs, re-scored under the browser rubric

- Generated: 2026-07-14T04:53:20.898Z
- Suites replayed: `2026-07-12T22-28-37-337Z`, `2026-07-12T22-32-01-708Z`
- Model calls made: **0** (every artifact is reconstructed from its archived transcript)

## The integrity number

The old validator passed **24/24** of these runs. It only counted component
types — never props, data, bindings, or a painted pixel.

Re-rendered in a real browser and judged on whether the DATA reached the screen:

- **1/24** still pass.
- **23/24** do not.

## Per scenario

| Scenario | Runs | Pass (browser rubric) | Fail |
|---|---|---|---|
| architecture-diagram | 3 | 0 | 3 |
| csv-data-table | 3 | 1 | 2 |
| incident-report | 3 | 0 | 3 |
| live-log-dashboard | 5 | 0 | 5 |
| status-dashboard | 5 | 0 | 5 |
| validated-form | 5 | 0 | 5 |

## Every run

| Scenario | Model | Rep | Old validator | Browser rubric | Today's validation issues | Why it fails now |
|---|---|---|---|---|---|---|
| validated-form | sonnet | 1 | pass | **FAIL** | 11 | the form has the 3 fields with the right input types and a submit button: no input labelled "name" was rendered. Rendered inputs: [(unlabelled):text, (unlabelled):email, (unlabelled):password]<br>the form has the 3 fields with the right input types and a submit button: no input labelled "email" was rendered. Rendered inputs: [(unlabelled):text, (unlabelled):email, (unlabelled):password]<br>the form has the 3 fields with the right input types and a submit button: no input labelled "password" was rendered. Rendered inputs: [(unlabelled):text, (unlabelled):email, (unlabelled):password] |
| live-log-dashboard | sonnet | 1 | pass | **FAIL** | 8 | page logged 4 console error(s); first: TypeError: Cannot read properties of undefined (reading 'reduce')<br>the error-rate chart plots its 5 seeded points: 0 chart(s) actually plotted >= 5 data points, expected >= 1. Observed per-svg data-point counts: [no <svg> rendered at all]<br>all 3 seeded log lines are rendered as table rows: no <table> was rendered at all |
| status-dashboard | sonnet | 1 | pass | **FAIL** | 13 | page logged 4 console error(s); first: TypeError: Cannot read properties of undefined (reading 'reduce')<br>both charts plot their 7-day series and label the days: 0 chart(s) actually plotted >= 5 data points, expected >= 2. Observed per-svg data-point counts: [no <svg> rendered at all]<br>both charts plot their 7-day series and label the days: the chart(s) never painted these axis labels from the source data: "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" |
| incident-report | sonnet | 1 | pass | **FAIL** | 9 | page logged 4 console error(s); first: TypeError: Cannot read properties of undefined (reading 'split')<br>the verdict, the root cause, and every timeline timestamp are rendered: missing from the rendered page: "Checkout API returned 500s", "connection pool", "14:02", "14:10", "14:12", "14:14" |
| architecture-diagram | sonnet | 1 | pass | **FAIL** | 2 | error text rendered on the page: "Cannot read propert"<br>one svg diagram carries all 3 node labels and connects them: no <svg> diagram was rendered |
| csv-data-table | sonnet | 1 | pass | **FAIL** | 2 | content is near-empty: 0 non-whitespace characters painted, expected >= 25<br>page logged 2 console error(s); first: TypeError: Cannot read properties of undefined (reading 'length')<br>every CSV row is rendered as a table row with all its values: no <table> was rendered at all |
| architecture-diagram | sonnet | 2 | pass | **FAIL** | 2 | error text rendered on the page: "Cannot read propert"<br>one svg diagram carries all 3 node labels and connects them: no <svg> diagram was rendered |
| csv-data-table | sonnet | 2 | pass | **pass** | 0 | — |
| csv-data-table | sonnet | 3 | pass | **FAIL** | 2 | content is near-empty: 17 non-whitespace characters painted, expected >= 25<br>page logged 2 console error(s); first: TypeError: Cannot read properties of undefined (reading 'length')<br>every CSV row is rendered as a table row with all its values: no <table> was rendered at all |
| architecture-diagram | sonnet | 3 | pass | **FAIL** | 2 | error text rendered on the page: "Cannot read propert"<br>one svg diagram carries all 3 node labels and connects them: no <svg> diagram was rendered |
| status-dashboard | sonnet | 2 | pass | **FAIL** | 5 | both charts plot their 7-day series and label the days: 0 chart(s) actually plotted >= 5 data points, expected >= 2. Observed per-svg data-point counts: [no <svg> rendered at all]<br>both charts plot their 7-day series and label the days: the chart(s) never painted these axis labels from the source data: "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" |
| validated-form | sonnet | 3 | pass | **FAIL** | 11 | the form has the 3 fields with the right input types and a submit button: no input labelled "name" was rendered. Rendered inputs: [Jane Doe:text, jane@example.com:email, At least 8 characters:password]<br>the form has the 3 fields with the right input types and a submit button: no input labelled "email" was rendered. Rendered inputs: [Jane Doe:text, jane@example.com:email, At least 8 characters:password]<br>the form has the 3 fields with the right input types and a submit button: no input labelled "password" was rendered. Rendered inputs: [Jane Doe:text, jane@example.com:email, At least 8 characters:password] |
| incident-report | sonnet | 2 | pass | **FAIL** | 6 | page logged 2 console error(s); first: TypeError: Cannot read properties of undefined (reading 'split')<br>the verdict, the root cause, and every timeline timestamp are rendered: missing from the rendered page: "Checkout API returned 500s", "connection pool" |
| live-log-dashboard | sonnet | 2 | pass | **FAIL** | 8 | page logged 4 console error(s); first: TypeError: Cannot read properties of undefined (reading 'reduce')<br>the error-rate chart plots its 5 seeded points: 0 chart(s) actually plotted >= 5 data points, expected >= 1. Observed per-svg data-point counts: [no <svg> rendered at all]<br>all 3 seeded log lines are rendered as table rows: no <table> was rendered at all |
| live-log-dashboard | sonnet | 3 | pass | **FAIL** | 9 | page logged 4 console error(s); first: TypeError: Cannot read properties of undefined (reading 'reduce')<br>the error-rate chart plots its 5 seeded points: 0 chart(s) actually plotted >= 5 data points, expected >= 1. Observed per-svg data-point counts: [no <svg> rendered at all]<br>all 3 seeded log lines are rendered as table rows: no <table> was rendered at all |
| incident-report | sonnet | 3 | pass | **FAIL** | 7 | page logged 4 console error(s); first: TypeError: Cannot read properties of undefined (reading 'split')<br>the verdict, the root cause, and every timeline timestamp are rendered: missing from the rendered page: "Checkout API returned 500s", "14:02", "14:10", "14:12", "14:14" |
| validated-form | sonnet | 2 | pass | **FAIL** | 8 | the form has the 3 fields with the right input types and a submit button: no input labelled "name" was rendered. Rendered inputs: [(unlabelled):text, (unlabelled):email, (unlabelled):password]<br>the form has the 3 fields with the right input types and a submit button: no input labelled "email" was rendered. Rendered inputs: [(unlabelled):text, (unlabelled):email, (unlabelled):password]<br>the form has the 3 fields with the right input types and a submit button: no input labelled "password" was rendered. Rendered inputs: [(unlabelled):text, (unlabelled):email, (unlabelled):password] |
| status-dashboard | sonnet | 3 | pass | **FAIL** | 9 | both charts plot their 7-day series and label the days: 0 chart(s) actually plotted >= 5 data points, expected >= 2. Observed per-svg data-point counts: [no <svg> rendered at all]<br>both charts plot their 7-day series and label the days: the chart(s) never painted these axis labels from the source data: "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" |
| live-log-dashboard | opus | 2 | pass | **FAIL** | 6 | the error-rate chart plots its 5 seeded points: 0 chart(s) actually plotted >= 5 data points, expected >= 1. Observed per-svg data-point counts: [no <svg> rendered at all] |
| status-dashboard | opus | 1 | pass | **FAIL** | 12 | both charts plot their 7-day series and label the days: 0 chart(s) actually plotted >= 5 data points, expected >= 2. Observed per-svg data-point counts: [no <svg> rendered at all]<br>both charts plot their 7-day series and label the days: the chart(s) never painted these axis labels from the source data: "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" |
| validated-form | opus | 1 | pass | **FAIL** | 6 | the form refuses an empty name and a 3-character password: the form ACCEPTED invalid input for name="", password="abc" — after pressing "Sign up" those fields did not fail native validity, was not marked aria-invalid, and drew no error message |
| validated-form | opus | 2 | pass | **FAIL** | 6 | the form refuses an empty name and a 3-character password: the form ACCEPTED invalid input for name="", password="abc" — after pressing "Sign up" those fields did not fail native validity, was not marked aria-invalid, and drew no error message |
| status-dashboard | opus | 2 | pass | **FAIL** | 10 | both charts plot their 7-day series and label the days: 0 chart(s) actually plotted >= 5 data points, expected >= 2. Observed per-svg data-point counts: [no <svg> rendered at all]<br>both charts plot their 7-day series and label the days: the chart(s) never painted these axis labels from the source data: "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" |
| live-log-dashboard | opus | 1 | pass | **FAIL** | 6 | the error-rate chart plots its 5 seeded points: 0 chart(s) actually plotted >= 5 data points, expected >= 1. Observed per-svg data-point counts: [no <svg> rendered at all] |

The **today's validation issues** column is informational: it is what the CURRENT (since hardened) spec
validation says about the spec the model wrote back then. It plays no part in the rubric verdict — the
browser does. A run can have zero validation issues and still paint an empty chart, which is the entire
reason this rubric exists.
