# Crow's Foot

A desktop dashboard for the GitHub pull requests that need your attention,
grouped into sections you configure. Each section is a query in a language that
takes GitHub's issue search whole and adds what it is missing: `or`, `not`,
parentheses, and qualifiers GitHub has no answer for, such as "I reviewed this
and they asked again".

Crow's Foot is a [Tauri](https://tauri.app) app: a React interface over a Rust
core that talks to GitHub. Everything stays on your machine, and the built app
has no runtime of its own to install.

## Download

Grab the `.dmg` from [the latest
release](https://github.com/tylershunt/crows-foot/releases/latest) — one
universal build for Apple Silicon and Intel — and drag Crow's Foot to
Applications. Later versions install from inside the app.

It is ad-hoc signed but not notarized, so macOS asks about it once: open it the
first time with right-click → **Open**, or **System Settings → Privacy &
Security → Open Anyway**. Every launch after that is an ordinary one.

## Requirements

To run the app:

- The [`gh` CLI](https://cli.github.com), authenticated: `gh auth login`

Crow's Foot borrows the token `gh` already stores, so there is nothing else to set
up and no secret to paste anywhere. To use a different credential, set
`GITHUB_TOKEN` (or `GH_TOKEN`) and it takes precedence. The token needs the
`repo` scope to see private pull requests and `read:org` for team review
requests.

To build it, add [Node 20 or newer](https://nodejs.org) and a
[Rust toolchain](https://rustup.rs).

## Running

```bash
npm install
npm run dev     # the app, with the interface hot-reloading
npm run build   # Crow's Foot.app and a .dmg, in src-tauri/target/release/bundle
```

A packaged build signs an updater payload. Set `TAURI_SIGNING_PRIVATE_KEY` to
the private key (or a path to it) before `npm run build`.

`npm test` runs both suites: the interface's tests under Node's test runner and
the core's under `cargo test`. The tests that call GitHub are ignored by
default; `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` runs
them against your own credential.

Pushing a `v*` tag builds the universal `.dmg` on CI and publishes it as a
release, once `codesign` confirms the bundle is sealed. The same release holds
`latest.json` and a `.app.tar.gz`, which a running copy reads to update itself.

### Where things live

| Variable               | Default                  | Purpose               |
| ---------------------- | ------------------------ | --------------------- |
| `CROWS_FOOT_CONFIG`    | `<app data>/config.json` | Sections and filters  |
| `CROWS_FOOT_SNOOZE_DB` | `<app data>/snoozes.db`  | Snoozed pull requests |
| `CROWS_FOOT_WEB_PORT`  | 5273                     | Vite dev server       |

`<app data>` is `~/Library/Application Support/dev.tylershunt.crows-foot` on
macOS.

## Configuring sections

Click the gear at the right of the top bar, or the gear on any section header to jump
straight to that section. You can rename sections, edit their query, reorder
them, set a per-section result limit and accent color, and choose whether a
section starts collapsed and whether it counts on the dock badge. A section
whose query currently matches nothing starts collapsed on its own, so empty
sections stay out of the way until they have something in them.

Changes are written to `config.json` in the app's data directory, which Settings
prints at the top and which you can also edit by hand. It is created on first
run from the defaults in `src-tauri/src/config.rs`.

The defaults are:

| Section              | Query                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| Needs your review    | `is:open is:pr archived:false -is:draft (user-review-requested:@me or (review-requested:@me -user-review-requested:@me -reviewed-by:@me))` |
| Changes requested    | `is:open is:pr author:@me review:changes-requested archived:false`                               |
| Ready to merge       | `is:open is:pr author:@me review:approved -is:draft archived:false`                              |
| Waiting on reviewers | `is:open is:pr author:@me -review:approved -review:changes-requested -is:draft archived:false`   |
| Mentions you         | `is:open is:pr mentions:@me -author:@me archived:false`                                          |
| Your drafts          | `is:open is:pr author:@me is:draft archived:false`                                               |
| Recently merged      | `is:pr author:@me is:merged archived:false`                                                      |

All but the first are ordinary GitHub searches. *Needs your review* asks for two
kinds of request at once, because GitHub tells them apart:
`user-review-requested:@me` is a request made of you, while
`review-requested:@me` also counts requests made of a team you belong to. A
request is cleared the moment you submit a review, so an open one of your own
always wants something from you; a team's request can outlive your review, and
the second branch drops those rather than asking you twice.

Useful things to add: `org:your-org` to scope to one organization, `repo:o/r`
for a single repo, `label:urgent`, `team-review-requested:org/team`, or
`updated:>2026-01-01`.

Under each query, Settings shows what it compiles to: every search that will be
sent to GitHub, as a link that runs it on github.com, and whatever the query
asks of the results afterwards. That is the fastest way to check a query does
what you meant.

## The query language

Anything GitHub's issue search understands means the same thing here and is sent
to GitHub untouched, so nothing you already know stops working. On top of it:

**Booleans.** A space still means *and*, as it does on GitHub. `or` and `not`
join and negate whole expressions, `-` still negates a single term, and
parentheses group. Quote a word (`"or"`) to search for it rather than mean it.

```
is:open is:pr (review-requested:@me or assignee:@me) -author:@me
```

**Shorthands** for searches GitHub can run but has no single word for:

| Qualifier                             | Runs as                                     |
| ------------------------------------- | ------------------------------------------- |
| `review:re-requested`                 | `review-requested:@me reviewed-by:@me`      |
| `checks:failing`, `passing`, `pending`| `status:failure`, `success`, `pending`      |
| `idle:>1w`, `idle:<2d`                | `updated:<` or `updated:>` that date        |

**Qualifiers GitHub cannot answer**, which are asked of the pull requests a
search brings back: `unread:yes`, `conflicts:yes`, `stacked:yes` (merges into a
branch that is not the default), `reviewers:0` (review requests still
outstanding), `approvals:>=2` (reviewers whose latest review approves),
`size:>500` (lines moved either way), and `files:>20`. Each takes `yes`/`no` or
a count, and a count may lead with `>`, `>=`, `<`, or `<=`.

`approvals:` counts, where GitHub's own `review:approved` only says whether a
pull request cleared review as a whole, so `approvals:1 review:approved` finds
what one person waved through.

A query with an `or` in it becomes several GitHub searches, run at once and
unioned by pull request, ordered by what moved last. Two rules follow from that,
and Settings reports both against the query as you type:

- Every branch needs something GitHub can search for. `author:@me or
  conflicts:yes` is refused, because its second branch would mean reading all of
  GitHub to answer.
- A query that spreads into more than eight searches is refused as well.

A section's count is GitHub's own so long as GitHub answered the whole query. If
a local qualifier had to sift a search that came back capped by the section's
limit, the count is what was found among those and is shown as `19+`.

## Global filters

Global filters are queries ANDed into *every* section's query, so one rule can
narrow the whole dashboard. They live at the top of Settings, are written in the
same language as a section, and can only remove pull requests from a section,
never add them.

The usual use is exclusions:

| Filter                    | Effect                                  |
| ------------------------- | --------------------------------------- |
| `-author:app/dependabot`  | Hide Dependabot pull requests everywhere |
| `-author:app/renovate`    | Hide Renovate pull requests everywhere   |
| `org:your-org`            | Restrict the whole dashboard to one org  |
| `-repo:owner/noisy-repo`  | Drop one repo from every section         |
| `-label:wip`              | Hide anything labelled `wip`             |

Each filter has a checkbox, so you can switch one off temporarily without
deleting it. Disabled filters are ignored entirely.

When any global filter is active, a chip appears in the top bar showing how many
are applied; hovering it lists them and clicking it opens Settings. This exists
so that pull requests are never missing for invisible reasons. In Settings, the
**Runs as** line under each section is the combined query, so a filter's effect
on that section is there to read.

Two things worth knowing. A global filter applies to *every* section including
`Recently merged`, so scope filters like `org:` affect your history view as
well. And a global filter that contradicts a section's own query (for example a
global `-is:draft` against the `Your drafts` section, which asks for
`is:draft`) produces a self-contradictory search; GitHub does not error on
these, it just returns something you probably did not intend.

## What each row shows

Left to right: a black dot ringed in violet when the pull request has activity
you have not seen, the pull request state, the author's avatar, the title, and
then the repo,
number, author, and diff size. Titles too long for the window get a tooltip
with the full text. On the right: labels, comment count, reviewer
avatars (a green ring approved, a red ring requested changes, a gray ring
commented, and gray initials still owe a review), the overall review decision, the CI check rollup, and how long ago the
pull request was last updated.

Clicking a row opens it in your browser, where you are already signed in to
GitHub. Every link in the app leaves for the browser this way; the window itself
only ever shows the dashboard.

## Burning down a section

The flame on a section header opens every pull request in that section as its
own browser tab, in the order shown. Filter the section down first if you want a
smaller pile.

## The dock badge

Each section carries an **On the dock badge** switch in Settings, and the badge
on the app's icon is the total held by the sections that have it on. Out of the
box that is *Needs your review* and *Changes requested*; with none of them on,
the icon wears no badge at all.

It counts what a section holds rather than what is on screen, so a section
capped by its limit still contributes every match, and typing in the filter box
narrows the view without pretending the rest of the pile went away. Snoozed pull
requests are already out of their sections by the time the badge is added up, so
they do not count until they wake. A badged section whose count is partial (see
[the query language](#the-query-language)) contributes the part it is sure of.

## Snoozing

Hovering a row reveals a sleeping face at its right edge. Pressing it snoozes
that pull request: it leaves every section, and the burn down, at once. Section
counts drop with it, so `N more match this filter` keeps meaning what it says.

A snooze lasts until the pull request is next touched. Any activity with a
timestamp after the moment you snoozed brings it back on the following refresh,
so a snooze cannot outlive the thing it was hiding from you.

Whatever is currently hidden collects in a **Snoozed** section that the app
maintains at the bottom of the list, marked with the same sleeping face rather
than a crow's foot. It is not in your config, so it has no filter to edit, and
it starts collapsed. Each row there leads with the crow's foot of the section
that would be showing it, in that section's color, so you can see what you are
holding off without opening anything; hovering names the section. Rows offer an
alarm clock in place of the sleeping face: pressing it wakes that pull request
immediately and returns it to the sections it belongs to.

A pull request only appears here while some section's query still returns
it — one that has fallen out of every query is not shown, since the dashboard
would not have shown it anyway.

Snoozes live in `snoozes.db`, a SQLite file beside your config, keyed by the
pull request's GitHub node id. Deleting the file un-snoozes everything.

## Stacks

Pull requests stacked on one another are moved next to each other and joined by
a bar in the stack's own color, drawn in the gutter left of the unread marker. Rows are not indented; instead each one names the
pull request it sits on, as `on #1234`. Hovering that gives the parent's title.

A stack's color comes from a fixed palette, chosen by the number of the pull
request at the bottom of the stack, so a stack that spreads across sections —
one member approved, another still waiting — wears one color in all of them.
The palette holds eight hues, so two stacks whose bottom numbers are a multiple
of eight apart share a color; consecutive ones never do.

Naming the parent rather than indenting means sibling branches read correctly:
two pull requests that both build on `#1234` each say `on #1234`, which says
they are siblings, where indentation would have implied one sat on the other.

A stack is detected structurally: a pull request is stacked on another when it
merges into that one's branch in the same repository. That is how Graphite,
`gh`, and hand-built stacks all express the relationship, so no extra tooling
or token is involved.

Only the members a section's own query returned are joined as one bar. When
the parent or a child is in another section, that end of the bar is left open,
and a member sitting in a section by itself still carries the open piece. A
pull request built on a branch whose pull request is not on the dashboard is
marked with a stack icon alone, in its stack's color; hover it to see the
branch it builds on.

## Keyboard shortcuts

| Key   | Action                          |
| ----- | ------------------------------- |
| `/`   | Focus the filter box            |
| `r`   | Refresh                         |
| `Esc` | Close the settings panel        |

The filter box narrows the pull requests already on screen; it does not re-query
GitHub. Change a section's query when you want different results.

## Refreshing

The dashboard refetches on the interval set in Settings (120 seconds by
default), whenever the window regains focus, and when you press `r`.

## Updating

A packaged build checks GitHub's latest release when it opens. If a newer one
is published, a banner offers to install it and restart. Settings can ask the
same question on demand.

## Theme

Each section is marked by a crow's track in its accent color on the section header. The color is per-section and set in Settings.

The palette follows a crow: `ink` for the cool near-black neutrals, `sheen` for
the violet iridescence on the wing, `plume` for its teal edge, and `glint` for
the gold catchlight in the eye. These are defined in `src/index.css` and are
ordinary Tailwind color scales, so `bg-ink-900` and `text-sheen-400` work the
way you would expect. Light and dark modes are both supported; the switch is
in Settings.

The wordmark is set in Great Vibes (loaded from Google Fonts, falling back to
Snell Roundhand and Apple Chancery) with the iridescence clipped into the
letterforms. To use a different script face, change `--font-script` in
`src/index.css` and the stylesheet link in `index.html`.

## License

[MIT](LICENSE).
