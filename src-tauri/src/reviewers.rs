//! Finding reviewers for a pull request and asking them for a review.

use crate::error::{AppError, Result};
use crate::github::graphql;
use crate::types::{ReviewerCandidate, ReviewerKind};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashSet;

const CANDIDATES_DOCUMENT: &str = r#"query ($id: ID!, $query: String, $limit: Int!, $teamLimit: Int!, $searching: Boolean!) {
  node(id: $id) {
    ... on PullRequest {
      author { login }
      suggestedReviewers { reviewer { id login name avatarUrl } }
      repository {
        assignableUsers(first: $limit, query: $query) { nodes { id login name avatarUrl } }
        owner {
          ... on Organization {
            mine: teams(first: $teamLimit, role: MEMBER) @skip(if: $searching) { nodes { ...team } }
            matching: teams(first: $teamLimit, query: $query) @include(if: $searching) { nodes { ...team } }
          }
        }
      }
    }
  }
}

fragment team on Team { id name combinedSlug avatarUrl }"#;

const REQUEST_DOCUMENT: &str = r#"mutation ($id: ID!, $userIds: [ID!]!, $teamIds: [ID!]!) {
  requestReviews(input: { pullRequestId: $id, userIds: $userIds, teamIds: $teamIds, union: true }) {
    pullRequest { id }
  }
}"#;

const BASE_DOCUMENT: &str = r#"query ($id: ID!) {
  node(id: $id) {
    ... on PullRequest {
      author { login }
      baseRefName
      repository { owner { login } name }
    }
  }
}"#;

const PARENT_DOCUMENT: &str = r#"query ($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, states: [OPEN], first: 1) {
      nodes {
        number
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { id login name avatarUrl }
              ... on Team { id name combinedSlug avatarUrl }
            }
          }
        }
        latestReviews(first: 20) {
          nodes { author { __typename ... on User { id login name avatarUrl } } }
        }
      }
    }
  }
}"#;

const CANDIDATE_LIMIT: u32 = 20;
const TEAM_LIMIT: u32 = 10;

/// The reviewers of the open pull request this one is stacked on.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParentReviewers {
    pub number: u64,
    pub reviewers: Vec<ReviewerCandidate>,
}

/// Everyone asked to review, or who has reviewed, the open pull request whose
/// branch this one merges into. None when no open pull request has that branch.
pub async fn of_parent(client: &reqwest::Client, token: &str, pull_request_id: &str) -> Result<Option<ParentReviewers>> {
    let data = graphql::<BaseData>(client, token, BASE_DOCUMENT, json!({ "id": pull_request_id })).await?;
    let child = data.node.ok_or_else(|| AppError::new("GitHub could not find that pull request."))?;

    let variables = json!({
        "owner": child.repository.owner.login,
        "name": child.repository.name,
        "branch": child.base_ref_name,
    });
    let data = graphql::<ParentData>(client, token, PARENT_DOCUMENT, variables).await?;
    let Some(parent) = data.repository.and_then(|repository| repository.pull_requests.nodes.into_iter().next()) else {
        return Ok(None);
    };

    Ok(Some(ParentReviewers {
        number: parent.number,
        reviewers: copied(
            child.author.map(|author| author.login).as_deref(),
            parent.review_requests.nodes.into_iter().filter_map(|request| request.requested_reviewer),
            parent.latest_reviews.nodes.into_iter().filter_map(|review| review.author),
        ),
    }))
}

/// The parent's requested reviewers, people and teams, then the people who
/// reviewed it, each once, leaving out the author of the pull request they
/// would be copied to.
fn copied(
    author: Option<&str>,
    requested: impl IntoIterator<Item = MaybeReviewer>,
    reviewed: impl IntoIterator<Item = MaybeReviewer>,
) -> Vec<ReviewerCandidate> {
    let mut seen = HashSet::new();
    requested
        .into_iter()
        .chain(reviewed)
        .filter_map(MaybeReviewer::into_candidate)
        .filter(|candidate| !is_author(candidate, author))
        .filter(|candidate| seen.insert(candidate.id.clone()))
        .collect()
}

/// People and teams who could review the pull request, matching `query` when
/// it is not empty. People come first: GitHub's suggestions, then the
/// repository's collaborators, never the pull request's author. Then teams of
/// the repository's organization: the viewer's own, or those matching `query`.
pub async fn candidates(
    client: &reqwest::Client,
    token: &str,
    pull_request_id: &str,
    query: &str,
) -> Result<Vec<ReviewerCandidate>> {
    let variables = json!({
        "id": pull_request_id,
        "query": query,
        "limit": CANDIDATE_LIMIT,
        "teamLimit": TEAM_LIMIT,
        "searching": !query.trim().is_empty(),
    });
    let data = graphql::<CandidatesData>(client, token, CANDIDATES_DOCUMENT, variables).await?;
    let node = data.node.ok_or_else(|| AppError::new("GitHub could not find that pull request."))?;

    let people = ranked(
        node.author.map(|author| author.login).as_deref(),
        node.suggested_reviewers.into_iter().filter_map(|suggestion| suggestion.reviewer).collect(),
        node.repository.assignable_users.nodes,
        query,
    );
    let owner = node.repository.owner;
    let teams = owner.mine.or(owner.matching).map(|teams| teams.nodes).unwrap_or_default();
    Ok(people.into_iter().chain(teams.into_iter().map(TeamNode::into_candidate)).collect())
}

/// Asks each of `user_ids` and `team_ids` to review the pull request, keeping
/// every request already open on it.
pub async fn request(
    client: &reqwest::Client,
    token: &str,
    pull_request_id: &str,
    user_ids: &[String],
    team_ids: &[String],
) -> Result<()> {
    let variables = json!({ "id": pull_request_id, "userIds": user_ids, "teamIds": team_ids });
    graphql::<serde_json::Value>(client, token, REQUEST_DOCUMENT, variables).await?;
    Ok(())
}

fn is_author(candidate: &ReviewerCandidate, author: Option<&str>) -> bool {
    candidate.kind == ReviewerKind::User && Some(candidate.login.as_str()) == author
}

/// Suggested reviewers matching `query`, then the collaborators, each person
/// once, leaving out the pull request's author and capped at the candidate limit.
fn ranked(
    author: Option<&str>,
    suggested: Vec<ReviewerCandidate>,
    collaborators: Vec<ReviewerCandidate>,
    query: &str,
) -> Vec<ReviewerCandidate> {
    let needle = query.trim().to_lowercase();
    let matches = |candidate: &ReviewerCandidate| {
        needle.is_empty()
            || candidate.login.to_lowercase().contains(&needle)
            || candidate.name.as_deref().is_some_and(|name| name.to_lowercase().contains(&needle))
    };

    let mut seen = HashSet::new();
    suggested
        .into_iter()
        .filter(|candidate| matches(candidate))
        .chain(collaborators)
        .filter(|candidate| Some(candidate.login.as_str()) != author)
        .filter(|candidate| seen.insert(candidate.login.clone()))
        .take(CANDIDATE_LIMIT as usize)
        .collect()
}

/// A requested reviewer or a review author: a user, a team, or another actor
/// such as a bot, which is no candidate.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaybeReviewer {
    #[serde(rename = "__typename")]
    typename: String,
    id: Option<String>,
    login: Option<String>,
    name: Option<String>,
    combined_slug: Option<String>,
    avatar_url: Option<String>,
}

impl MaybeReviewer {
    fn into_candidate(self) -> Option<ReviewerCandidate> {
        match self.typename.as_str() {
            "User" => Some(ReviewerCandidate {
                id: self.id?,
                kind: ReviewerKind::User,
                login: self.login?,
                name: self.name,
                avatar_url: self.avatar_url.unwrap_or_default(),
            }),
            "Team" => Some(ReviewerCandidate {
                id: self.id?,
                kind: ReviewerKind::Team,
                login: self.name?,
                name: self.combined_slug,
                avatar_url: self.avatar_url.unwrap_or_default(),
            }),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamNode {
    id: String,
    name: String,
    combined_slug: String,
    avatar_url: Option<String>,
}

impl TeamNode {
    fn into_candidate(self) -> ReviewerCandidate {
        ReviewerCandidate {
            id: self.id,
            kind: ReviewerKind::Team,
            login: self.name,
            name: Some(self.combined_slug),
            avatar_url: self.avatar_url.unwrap_or_default(),
        }
    }
}

#[derive(Deserialize)]
struct BaseData {
    node: Option<BaseNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BaseNode {
    author: Option<Login>,
    base_ref_name: String,
    repository: RepositoryName,
}

#[derive(Deserialize)]
struct RepositoryName {
    owner: Login,
    name: String,
}

#[derive(Deserialize)]
struct ParentData {
    repository: Option<ParentRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentRepository {
    pull_requests: Nodes<ParentNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ParentNode {
    number: u64,
    review_requests: Nodes<ReviewRequest>,
    latest_reviews: Nodes<ParentReview>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewRequest {
    requested_reviewer: Option<MaybeReviewer>,
}

#[derive(Deserialize)]
struct ParentReview {
    author: Option<MaybeReviewer>,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
struct CandidatesData {
    node: Option<CandidatesNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidatesNode {
    author: Option<Login>,
    suggested_reviewers: Vec<Suggestion>,
    repository: Repository,
}

#[derive(Deserialize)]
struct Login {
    login: String,
}

#[derive(Deserialize)]
struct Suggestion {
    reviewer: Option<ReviewerCandidate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    assignable_users: Users,
    owner: Owner,
}

/// A repository's owner; only an organization has teams.
#[derive(Deserialize)]
struct Owner {
    #[serde(default)]
    mine: Option<Nodes<TeamNode>>,
    #[serde(default)]
    matching: Option<Nodes<TeamNode>>,
}

#[derive(Deserialize)]
struct Users {
    nodes: Vec<ReviewerCandidate>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn person(login: &str, name: Option<&str>) -> ReviewerCandidate {
        ReviewerCandidate {
            id: format!("U_{login}"),
            kind: ReviewerKind::User,
            login: login.into(),
            name: name.map(Into::into),
            avatar_url: String::new(),
        }
    }

    fn logins(candidates: &[ReviewerCandidate]) -> Vec<&str> {
        candidates.iter().map(|candidate| candidate.login.as_str()).collect()
    }

    fn reviewer(typename: &str, id: &str, login: Option<&str>, name: Option<&str>) -> MaybeReviewer {
        MaybeReviewer {
            typename: typename.into(),
            id: Some(id.into()),
            login: login.map(Into::into),
            name: name.map(Into::into),
            combined_slug: (typename == "Team").then(|| format!("acme/{}", name.unwrap_or_default().to_lowercase())),
            avatar_url: Some(String::new()),
        }
    }

    fn user(login: &str) -> MaybeReviewer {
        reviewer("User", &format!("U_{login}"), Some(login), None)
    }

    fn team(name: &str) -> MaybeReviewer {
        reviewer("Team", &format!("T_{name}"), None, Some(name))
    }

    fn bot() -> MaybeReviewer {
        MaybeReviewer { typename: "Bot".into(), id: None, login: None, name: None, combined_slug: None, avatar_url: None }
    }

    #[test]
    fn the_parents_requested_reviewers_come_before_those_who_reviewed_it() {
        let copied = copied(None, [user("ada")], [user("bo")]);
        assert_eq!(logins(&copied), ["ada", "bo"]);
    }

    #[test]
    fn someone_both_requested_and_reviewed_on_the_parent_is_copied_once() {
        let copied = copied(None, [user("ada")], [user("ada"), user("bo")]);
        assert_eq!(logins(&copied), ["ada", "bo"]);
    }

    #[test]
    fn the_childs_author_is_not_copied_from_the_parent() {
        let copied = copied(Some("me"), [user("me")], [user("me"), user("bo")]);
        assert_eq!(logins(&copied), ["bo"]);
    }

    #[test]
    fn teams_requested_on_the_parent_are_copied_by_name_with_their_org_slug() {
        let copied = copied(None, [team("Birds"), user("ada")], []);
        assert_eq!(logins(&copied), ["Birds", "ada"]);
        assert_eq!(copied[0].kind, ReviewerKind::Team);
        assert_eq!(copied[0].name.as_deref(), Some("acme/birds"));
    }

    #[test]
    fn a_team_named_like_the_childs_author_is_still_copied() {
        let copied = copied(Some("me"), [team("me")], []);
        assert_eq!(logins(&copied), ["me"]);
    }

    #[test]
    fn reviewers_that_are_neither_people_nor_teams_are_not_copied() {
        let copied = copied(None, [bot()], [bot(), user("ada")]);
        assert_eq!(logins(&copied), ["ada"]);
    }

    #[test]
    fn a_team_reads_from_graphql_by_its_typename() {
        let raw = serde_json::json!({
            "__typename": "Team", "id": "T_1", "name": "Birds",
            "combinedSlug": "acme/birds", "avatarUrl": "a"
        });
        let candidate = serde_json::from_value::<MaybeReviewer>(raw).unwrap().into_candidate().unwrap();
        assert_eq!(
            candidate,
            ReviewerCandidate {
                id: "T_1".into(),
                kind: ReviewerKind::Team,
                login: "Birds".into(),
                name: Some("acme/birds".into()),
                avatar_url: "a".into(),
            }
        );
    }

    #[test]
    fn a_repository_owned_by_a_person_offers_no_teams() {
        let owner: Owner = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(owner.mine.or(owner.matching).is_none());
    }

    #[test]
    fn suggested_reviewers_come_before_the_other_collaborators() {
        let ranked = ranked(None, vec![person("sam", None)], vec![person("ada", None), person("bo", None)], "");
        assert_eq!(logins(&ranked), ["sam", "ada", "bo"]);
    }

    #[test]
    fn a_suggested_collaborator_is_offered_once() {
        let ranked = ranked(None, vec![person("sam", None)], vec![person("ada", None), person("sam", None)], "");
        assert_eq!(logins(&ranked), ["sam", "ada"]);
    }

    #[test]
    fn the_author_is_never_offered_as_a_reviewer() {
        let ranked = ranked(Some("me"), vec![person("me", None)], vec![person("me", None), person("ada", None)], "");
        assert_eq!(logins(&ranked), ["ada"]);
    }

    #[test]
    fn a_query_keeps_the_suggestions_whose_login_or_name_holds_it_in_any_case() {
        let suggested = vec![person("sam", Some("Samantha Ray")), person("ada", Some("Ada L")), person("RAYMOND", None)];
        let ranked = ranked(None, suggested, Vec::new(), "ray");
        assert_eq!(logins(&ranked), ["sam", "RAYMOND"]);
    }

    #[test]
    fn collaborators_github_matched_to_the_query_are_all_offered() {
        let ranked = ranked(None, Vec::new(), vec![person("zed", Some("Zed"))], "ray");
        assert_eq!(logins(&ranked), ["zed"]);
    }

    #[test]
    fn no_more_than_the_candidate_limit_is_offered() {
        let many = (0..CANDIDATE_LIMIT + 5).map(|index| person(&format!("user{index}"), None)).collect();
        assert_eq!(ranked(None, Vec::new(), many, "").len(), CANDIDATE_LIMIT as usize);
    }
}
