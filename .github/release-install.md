### Installing

One universal download for Apple Silicon and Intel Macs.

Open the `.dmg` and drag Crow's Foot to Applications. The app is ad-hoc signed
but not notarized, so the first launch needs **right-click → Open**, or
**System Settings → Privacy & Security → Open Anyway**. Every launch after that
is an ordinary one.

Later versions install from inside the app. Crow's Foot reads the token the
[`gh` CLI](https://cli.github.com) already stores, so run `gh auth login` before
the first launch if you have not already.
