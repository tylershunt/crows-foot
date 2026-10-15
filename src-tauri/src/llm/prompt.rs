//! What a model is told about the query language, and asked.

use super::Turn;
use crate::error::{AppError, Result};
use serde::Deserialize;
use serde_json::{json, Value};

/// How many queries a model may write before one that compiles is given up on.
pub const ATTEMPTS: usize = 3;

/// A conversation about one section's query.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// The conversation so far, ending with the user's latest message. A
    /// model's turn is the JSON of the draft it wrote.
    pub messages: Vec<Turn>,
    /// The section's query when the conversation began, which the first
    /// message revises when it is set.
    pub current_query: Option<String>,
}

pub fn system() -> String {
    format!(
        "You write the query for one section of Crow's Foot, a desktop dashboard of GitHub pull requests. \
The user describes the pull requests a section should hold; you answer with the query, a section title of \
at most four words, and a summary. The user may follow up asking for changes; each answer is a complete \
query revising your last one.\n\n{VOICE}\n\n{LANGUAGE}"
    )
}

/// How the summary, shown to the user as the reply, reads.
const VOICE: &str = r#"# The summary

The summary is your whole reply in the chat. Keep it snappy:
- At most 15 words. A fragment is fine.
- Say what the query finds or what changed, and nothing else.
- Name an assumption only when you made one: "Assumed your own PRs."
- No greetings, no "I", no "this query", no restating the request, no hedging, no exclamation marks.
- Use qualifier names in backticks only when a word would be unclear.

Good: "Your open PRs, failing CI, no review yet."
Good: "Dropped drafts. Added `-is:draft`."
Bad: "I've updated the query so that it now excludes draft pull requests, as you requested.""#;

const LANGUAGE: &str = r#"# The query language

Anything GitHub's issue and pull request search understands means the same thing here and is sent to GitHub
untouched. The signed-in user is `@me`. Start every query with `is:open is:pr archived:false` unless the user
asks for closed or merged pull requests (`is:merged`, `is:closed`).

Useful GitHub qualifiers: `author:`, `assignee:`, `mentions:`, `involves:`, `commenter:`, `review-requested:`
(the user or a team they are on), `user-review-requested:@me` (the user personally), `team-review-requested:org/team`,
`reviewed-by:`, `review:approved`, `review:changes-requested`, `review:none`, `is:draft`, `-is:draft`,
`org:`, `repo:owner/name`, `label:`, `-label:`, `base:`, `head:`, `updated:>2026-01-01`, `created:<2026-01-01`,
`comments:>10`, `language:`, `-author:app/dependabot`.

Booleans: a space means AND. `or` and `not` join and negate whole expressions, `-` negates one term, and
parentheses group. Example: `is:open is:pr (review-requested:@me or assignee:@me) -author:@me`.

Shorthands this app expands before searching:
- `review:re-requested`: the user reviewed and was asked again.
- `checks:failing`, `checks:passing`, `checks:pending`: the CI rollup.
- `idle:>1w`, `idle:<2d`: untouched for longer or shorter than a span (d, w, m for months, y).

Qualifiers GitHub cannot answer, checked against the pull requests a search returns:
- `unread:yes` or `no`: activity the user has not seen.
- `conflicts:yes` or `no`: merge conflicts.
- `stacked:yes` or `no`: merges into a branch other than the repository's default.
- `reviewers:N`: review requests still outstanding.
- `approvals:N`: reviewers whose latest review approves.
- `size:N`: lines added plus deleted.
- `files:N`: files changed.
A count may lead with `>`, `>=`, `<`, or `<=`, such as `size:>500` or `approvals:>=2`.

Rules the query must keep:
- Every `or` branch needs a qualifier that narrows GitHub's search to the user's corner of GitHub:
  one of author, assignee, commenter, involves, mentions, org, repo, review-requested, reviewed-by, team,
  team-review-requested, user, or user-review-requested. `author:@me or conflicts:yes` is refused.
- A query may spread into at most eight searches once its `or`s are multiplied out.
- Write only the query: no backticks, no explanation inside it."#;

/// The conversation to send, its first message framed with the section's query.
pub fn conversation(request: &Request) -> Result<Vec<Turn>> {
    match (request.messages.first(), request.messages.last()) {
        (Some(first), Some(last)) if !first.from_model && !last.from_model => {}
        _ => return Err(AppError::new("A conversation starts and ends with a message from you.")),
    }
    let mut turns = request.messages.clone();
    turns[0].text = ask(&turns[0].text, request.current_query.as_deref());
    Ok(turns)
}

fn ask(description: &str, current_query: Option<&str>) -> String {
    match current_query.map(str::trim).filter(|query| !query.is_empty()) {
        Some(current) => format!(
            "The section's query is now:\n{current}\n\nRevise it to match this description:\n{}",
            description.trim()
        ),
        None => format!("Write a section query for this description:\n{}", description.trim()),
    }
}

pub fn retry(error: &str) -> String {
    format!("That query does not compile: {error}\nWrite it again so that it compiles.")
}

/// The JSON object a model answers with, in a shape both providers accept as strict.
pub fn draft_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "title": { "type": "string", "description": "A section title of at most four words." },
            "query": { "type": "string", "description": "The section query." },
            "summary": { "type": "string", "description": "A snappy reply of at most 15 words: what the query finds or what changed." },
        },
        "required": ["title", "query", "summary"],
        "additionalProperties": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(from_model: bool, text: &str) -> Turn {
        Turn { from_model, text: text.into() }
    }

    #[test]
    fn a_description_alone_asks_for_a_new_query() {
        let request = Request { messages: vec![said(false, "my stale prs")], current_query: Some("  ".into()) };
        assert_eq!(conversation(&request).unwrap()[0].text, "Write a section query for this description:\nmy stale prs");
    }

    #[test]
    fn the_first_message_revises_the_current_query_and_follow_ups_pass_unchanged() {
        let request = Request {
            messages: vec![said(false, "only in corvic"), said(true, "{}"), said(false, "drop drafts")],
            current_query: Some("author:@me".into()),
        };
        let turns = conversation(&request).unwrap();
        assert!(turns[0].text.starts_with("The section's query is now:\nauthor:@me\n"));
        assert_eq!(turns[2].text, "drop drafts");
    }

    #[test]
    fn a_conversation_must_end_with_the_user() {
        let request = Request { messages: vec![said(false, "mine"), said(true, "{}")], current_query: None };
        assert!(conversation(&request).is_err());
        assert!(conversation(&Request { messages: vec![], current_query: None }).is_err());
    }
}
