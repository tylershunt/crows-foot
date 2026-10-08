# Changelog

Each `## x.y.z` section is the release notes GitHub shows for that version. A
release does not build without a section for its version.

Write for someone using the app: what they will see or can now do, one bullet
per change. Name the control or screen it is on. Leave out refactors, tests and
CI unless they change what a user sees.

## 0.11.0

- The update banner, and the update row in Settings, list what changed in each
  version between yours and the one offered.
- Rows stay the same height when a pull request becomes a draft or gains a
  conflict.

## 0.10.1

- The pull request list spans the whole window.
- The top bar stays put when you over-scroll; the list still bounces under it.
- The list's scrollbar shows only while you scroll.
- The top bar is taller, without the logo, and the window controls and the
  wordmark are centred on it.
- The search field fills the top bar's free width.

## 0.10.0

- **Request reviewers…** in a row's menu, on open pull requests you authored,
  picks reviewers from GitHub's suggestions or the repository's collaborators.
- On a pull request stacked on another, the reviewer picker offers **Copy
  reviewers from #N**, for everyone requested on or reviewing the parent.
- Each row shows a copy-link button and a menu. The menu holds Request
  reviewers, Convert to draft or Mark ready for review, and Snooze until
  updated or Wake now.
- Section headers drop their gear; Settings opens from the gear in the top bar.
