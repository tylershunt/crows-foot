//! The qualifiers GitHub's search cannot answer, which are asked of the rows it
//! returns instead.

use crate::error::{AppError, Result};
use crate::query::parse::Term;
use crate::types::PullRequest;
use serde::{Serialize, Serializer};

/// One local qualifier, negated or not, ready to be asked of a pull request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Local {
    negated: bool,
    term: Term,
    test: Test,
}

impl Local {
    /// The qualifier `term` stands for, or `None` when GitHub owns that key.
    ///
    /// A key that is ours with a value that is not yields the complaint to put
    /// in front of the user.
    pub fn read(term: &Term, negated: bool) -> Option<Result<Self>> {
        let key = term.key.as_deref()?;
        let test = match key {
            "unread" => flag(key, &term.value).map(Test::Unread),
            "conflicts" => flag(key, &term.value).map(Test::Conflicts),
            "stacked" => flag(key, &term.value).map(Test::Stacked),
            "size" => Comparison::read(key, &term.value).map(Test::Size),
            "files" => Comparison::read(key, &term.value).map(Test::Files),
            "reviewers" => Comparison::read(key, &term.value).map(Test::Reviewers),
            "approvals" => Comparison::read(key, &term.value).map(Test::Approvals),
            "approved-by" => Reviewer::read(key, &term.value).map(|by| Test::LatestReview(by, "APPROVED")),
            "changes-requested-by" => {
                Reviewer::read(key, &term.value).map(|by| Test::LatestReview(by, "CHANGES_REQUESTED"))
            }
            "commented-by" => Reviewer::read(key, &term.value).map(|by| Test::LatestReview(by, "COMMENTED")),
            _ => return None,
        };

        Some(test.map(|test| Self { negated, term: term.clone(), test }))
    }

    pub fn holds(&self, pull_request: &PullRequest) -> bool {
        self.test.holds(pull_request) != self.negated
    }

    /// The GitHub search that holds every pull request this qualifier keeps,
    /// when there is one: `approved-by:X` keeps only pull requests X reviewed.
    pub fn implied_search(&self) -> Option<Term> {
        match &self.test {
            Test::LatestReview(_, _) if !self.negated => Some(Term::qualifier("reviewed-by", &self.term.value)),
            _ => None,
        }
    }

    /// The qualifier as the user wrote it.
    pub fn render(&self) -> String {
        let dash = if self.negated { "-" } else { "" };
        format!("{dash}{}", self.term.render())
    }
}

impl Serialize for Local {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.render())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Test {
    Unread(bool),
    Conflicts(bool),
    Stacked(bool),
    /// Lines added and removed together.
    Size(Comparison),
    Files(Comparison),
    /// Reviewers, people and teams alike, with a request still outstanding.
    Reviewers(Comparison),
    /// Reviewers whose latest review approves, which is what GitHub counts too.
    Approvals(Comparison),
    /// The reviewer's latest review is in this state.
    LatestReview(Reviewer, &'static str),
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Reviewer {
    Viewer,
    Login(String),
}

impl Reviewer {
    fn read(key: &str, value: &str) -> Result<Self> {
        if value == "@me" {
            return Ok(Self::Viewer);
        }
        let login = value.strip_prefix('@').unwrap_or(value);
        if login.is_empty() || !login.chars().all(|character| character.is_ascii_alphanumeric() || character == '-') {
            return Err(AppError::new(format!("`{key}:` takes a GitHub login or @me, not `{value}`.")));
        }
        Ok(Self::Login(login.to_string()))
    }

    /// The state of this reviewer's latest review on the pull request, if they left one.
    fn latest_review<'a>(&self, pull_request: &'a PullRequest) -> Option<&'a str> {
        match self {
            Self::Viewer => pull_request.viewer_review_state.as_deref(),
            Self::Login(login) => pull_request
                .latest_reviews
                .iter()
                .find(|review| review.author.as_ref().is_some_and(|author| author.login.eq_ignore_ascii_case(login)))
                .map(|review| review.state.as_str()),
        }
    }
}

impl Test {
    fn holds(&self, pull_request: &PullRequest) -> bool {
        match self {
            Self::Unread(wanted) => pull_request.is_read != *wanted,
            Self::Conflicts(wanted) => (pull_request.mergeable == "CONFLICTING") == *wanted,
            Self::Stacked(wanted) => pull_request.targets_non_default_branch == *wanted,
            Self::Size(against) => against.holds(pull_request.additions + pull_request.deletions),
            Self::Files(against) => against.holds(pull_request.changed_files),
            Self::Reviewers(against) => against.holds(pull_request.requested_reviewers.len() as i64),
            Self::Approvals(against) => against.holds(approvals(pull_request)),
            Self::LatestReview(reviewer, state) => reviewer.latest_review(pull_request) == Some(*state),
        }
    }
}

/// A reviewer who approved and then asked for changes counts once, against, so
/// this reads only the latest review each reviewer left.
fn approvals(pull_request: &PullRequest) -> i64 {
    pull_request.latest_reviews.iter().filter(|review| review.state == "APPROVED").count() as i64
}

fn flag(key: &str, value: &str) -> Result<bool> {
    match value {
        "yes" | "true" => Ok(true),
        "no" | "false" => Ok(false),
        _ => Err(AppError::new(format!("`{key}:` takes yes or no, not `{value}`."))),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Comparison {
    operator: Operator,
    against: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operator {
    Exactly,
    Above,
    AtLeast,
    Below,
    AtMost,
}

impl Comparison {
    fn read(key: &str, value: &str) -> Result<Self> {
        let (operator, digits) = match value {
            _ if value.starts_with(">=") => (Operator::AtLeast, &value[2..]),
            _ if value.starts_with("<=") => (Operator::AtMost, &value[2..]),
            _ if value.starts_with('>') => (Operator::Above, &value[1..]),
            _ if value.starts_with('<') => (Operator::Below, &value[1..]),
            _ => (Operator::Exactly, value),
        };

        let against = digits.parse().map_err(|_| {
            AppError::new(format!("`{key}:` takes a number, optionally after >, >=, <, or <=, not `{value}`."))
        })?;

        Ok(Self { operator, against })
    }

    fn holds(&self, count: i64) -> bool {
        match self.operator {
            Operator::Exactly => count == self.against,
            Operator::Above => count > self.against,
            Operator::AtLeast => count >= self.against,
            Operator::Below => count < self.against,
            Operator::AtMost => count <= self.against,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local(source: &str) -> Local {
        let negated = source.starts_with('-');
        let term = crate::query::parse::parse(source.trim_start_matches('-')).unwrap();
        match term {
            crate::query::parse::Expr::Term(term) => Local::read(&term, negated).unwrap().unwrap(),
            other => panic!("`{source}` parsed as {other:?}"),
        }
    }

    fn pull_request() -> PullRequest {
        PullRequest {
            id: "PR_1".into(),
            number: 1,
            title: "Teach the crow to count".into(),
            url: "https://github.com/o/r/pull/1".into(),
            repo: "o/r".into(),
            is_private: false,
            is_draft: false,
            base_ref: "main".into(),
            head_ref: "crow".into(),
            targets_non_default_branch: false,
            state: "OPEN".into(),
            created_at: "2026-08-01T00:00:00Z".into(),
            updated_at: "2026-08-02T00:00:00Z".into(),
            additions: 400,
            deletions: 120,
            changed_files: 12,
            comment_count: 3,
            is_read: true,
            check_state: "SUCCESS".into(),
            review_decision: "REVIEW_REQUIRED".into(),
            mergeable: "MERGEABLE".into(),
            author: None,
            labels: Vec::new(),
            requested_reviewers: vec!["birds".into(), "hunt".into()],
            latest_reviews: Vec::new(),
            viewer_review_state: None,
        }
    }

    fn reviewed(login: &str, state: &str) -> crate::types::Review {
        crate::types::Review {
            state: state.into(),
            author: Some(crate::types::Actor { login: login.into(), avatar_url: String::new(), url: String::new() }),
        }
    }

    #[test]
    fn a_reviewers_result_is_read_from_their_latest_review() {
        let mut pull_request = pull_request();
        pull_request.latest_reviews = vec![reviewed("Alice", "APPROVED"), reviewed("bob", "CHANGES_REQUESTED")];

        assert!(local("approved-by:alice").holds(&pull_request));
        assert!(local("changes-requested-by:bob").holds(&pull_request));
        assert!(!local("approved-by:bob").holds(&pull_request));
        assert!(!local("commented-by:alice").holds(&pull_request));
        assert!(!local("approved-by:carol").holds(&pull_request));
        assert!(local("-approved-by:carol").holds(&pull_request));
    }

    #[test]
    fn at_me_reads_the_viewers_own_latest_review() {
        let mut pull_request = pull_request();
        assert!(!local("approved-by:@me").holds(&pull_request));

        pull_request.viewer_review_state = Some("APPROVED".into());
        assert!(local("approved-by:@me").holds(&pull_request));
        assert!(!local("changes-requested-by:@me").holds(&pull_request));
    }

    #[test]
    fn a_reviewers_result_is_searched_among_what_they_reviewed_unless_negated() {
        assert_eq!(local("approved-by:alice").implied_search(), Some(Term::qualifier("reviewed-by", "alice")));
        assert_eq!(local("commented-by:@me").implied_search(), Some(Term::qualifier("reviewed-by", "@me")));
        assert_eq!(local("-approved-by:alice").implied_search(), None);
        assert_eq!(local("size:>5").implied_search(), None);
    }

    #[test]
    fn github_keeps_the_keys_that_are_not_ours() {
        assert!(Local::read(&Term::qualifier("is", "open"), false).is_none());
        assert!(Local::read(&Term::text("crow"), false).is_none());
    }

    #[test]
    fn unread_asks_whether_the_viewer_has_looked() {
        let mut pull_request = pull_request();

        assert!(local("unread:no").holds(&pull_request));
        assert!(!local("unread:yes").holds(&pull_request));

        pull_request.is_read = false;
        assert!(local("unread:yes").holds(&pull_request));
    }

    #[test]
    fn conflicts_asks_whether_the_branch_still_merges() {
        let mut pull_request = pull_request();
        assert!(local("conflicts:no").holds(&pull_request));

        pull_request.mergeable = "CONFLICTING".into();
        assert!(local("conflicts:yes").holds(&pull_request));
    }

    #[test]
    fn stacked_asks_whether_it_merges_into_another_branch() {
        let mut pull_request = pull_request();
        assert!(!local("stacked:yes").holds(&pull_request));

        pull_request.targets_non_default_branch = true;
        assert!(local("stacked:yes").holds(&pull_request));
    }

    #[test]
    fn size_counts_the_lines_moved_either_way() {
        let pull_request = pull_request();

        assert!(local("size:>500").holds(&pull_request));
        assert!(local("size:520").holds(&pull_request));
        assert!(local("size:<521").holds(&pull_request));
        assert!(!local("size:>=521").holds(&pull_request));
    }

    #[test]
    fn files_and_reviewers_count_what_they_name() {
        let pull_request = pull_request();

        assert!(local("files:12").holds(&pull_request));
        assert!(local("reviewers:>1").holds(&pull_request));
        assert!(!local("reviewers:0").holds(&pull_request));
    }

    #[test]
    fn approvals_count_the_reviewers_whose_latest_review_approves() {
        let review = |state: &str| crate::types::Review { state: state.into(), author: None };
        let mut pull_request = pull_request();

        assert!(local("approvals:0").holds(&pull_request));

        pull_request.latest_reviews =
            vec![review("APPROVED"), review("CHANGES_REQUESTED"), review("APPROVED")];

        assert!(local("approvals:2").holds(&pull_request));
        assert!(local("approvals:>=2").holds(&pull_request));
        assert!(!local("approvals:>2").holds(&pull_request));
    }

    #[test]
    fn a_negated_qualifier_holds_where_the_qualifier_does_not() {
        let pull_request = pull_request();

        assert!(local("-reviewers:0").holds(&pull_request));
        assert!(!local("-files:12").holds(&pull_request));
    }

    #[test]
    fn a_local_qualifier_renders_as_it_was_written() {
        assert_eq!(local("size:>500").render(), "size:>500");
        assert_eq!(local("-unread:yes").render(), "-unread:yes");
    }

    #[test]
    fn a_value_the_qualifier_cannot_take_is_refused_with_a_reason() {
        let complaint = |source: &str, value: &str| {
            let key = source.split(':').next().expect("a key");
            Local::read(&Term::qualifier(key, value), false).unwrap().unwrap_err().to_string()
        };

        assert_eq!(complaint("unread", "maybe"), "`unread:` takes yes or no, not `maybe`.");
        assert_eq!(complaint("approved-by", "org/team"), "`approved-by:` takes a GitHub login or @me, not `org/team`.");
        assert_eq!(
            complaint("size", "big"),
            "`size:` takes a number, optionally after >, >=, <, or <=, not `big`."
        );
    }
}
