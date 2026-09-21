//! The GitHub GraphQL calls behind the dashboard.

use crate::error::{AppError, Result};
use crate::query::{self, QueryPlan};
use crate::types::{
    Actor, AppConfig, DashboardResponse, GlobalFilter, Label, PullRequest, Review, SectionConfig,
    SectionResult,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;

const GRAPHQL_ENDPOINT: &str = "https://api.github.com/graphql";

const PR_FRAGMENT: &str = r#"
fragment PullRequestFields on PullRequest {
  id
  number
  title
  url
  isDraft
  state
  createdAt
  updatedAt
  additions
  deletions
  changedFiles
  totalCommentsCount
  isReadByViewer
  reviewDecision
  mergeable
  baseRefName
  headRefName
  repository { nameWithOwner isPrivate defaultBranchRef { name } }
  author { login avatarUrl url }
  labels(first: 10) { nodes { name color } }
  reviewRequests(first: 10) {
    nodes {
      requestedReviewer {
        ... on User { login }
        ... on Team { name }
      }
    }
  }
  latestReviews(first: 10) {
    nodes { state author { login avatarUrl url } }
  }
  commits(last: 1) {
    nodes { commit { statusCheckRollup { state } } }
  }
}"#;

const VIEWER_DOCUMENT: &str = "query { viewer { login avatarUrl url } }";

fn search_document() -> String {
    format!(
        r#"query SectionSearch($query: String!, $limit: Int!) {{
  search(query: $query, type: ISSUE, first: $limit) {{
    issueCount
    nodes {{ ...PullRequestFields }}
  }}
}}
{PR_FRAGMENT}"#
    )
}

/// Resolves each section's searches concurrently.
///
/// A section whose query GitHub rejects, or whose query does not compile, yields
/// a `SectionResult` with `error` set rather than failing the whole dashboard.
pub async fn fetch_dashboard(
    client: &reqwest::Client,
    token: &str,
    config: &AppConfig,
) -> Result<DashboardResponse> {
    let viewer_request = graphql::<ViewerData>(client, token, VIEWER_DOCUMENT, json!({}));
    let section_requests = futures::future::join_all(
        config
            .sections
            .iter()
            .map(|section| fetch_section(client, token, section, &config.global_filters)),
    );

    let (viewer, sections) = futures::join!(viewer_request, section_requests);
    let viewer = viewer?;

    Ok(DashboardResponse { sections, viewer: viewer.viewer })
}

/// One search's answer.
struct Page {
    pull_requests: Vec<PullRequest>,
    /// Matches GitHub holds, which exceeds `pull_requests.len()` past the limit.
    issue_count: i64,
}

async fn fetch_section(
    client: &reqwest::Client,
    token: &str,
    config: &SectionConfig,
    global_filters: &[GlobalFilter],
) -> SectionResult {
    let plan = match query::plan(&config.query, global_filters) {
        Ok(plan) => plan,
        Err(error) => return failed(config, error.to_string()),
    };

    let answers = futures::future::join_all(
        plan.searches.iter().map(|search| fetch_page(client, token, &search.query, config.limit)),
    )
    .await;

    let mut pages = Vec::with_capacity(answers.len());
    for answer in answers {
        match answer {
            Ok(page) => pages.push(page),
            Err(message) => return failed(config, message),
        }
    }

    assemble(config, &plan, pages)
}

async fn fetch_page(
    client: &reqwest::Client,
    token: &str,
    query: &str,
    limit: u32,
) -> std::result::Result<Page, String> {
    let variables = json!({ "query": query, "limit": limit });

    match graphql_allowing_partial::<SearchData>(client, token, &search_document(), variables).await {
        Ok((Some(data), _)) if data.search.is_some() => {
            let search = data.search.expect("checked above");
            Ok(Page {
                pull_requests: search.nodes.iter().filter_map(into_pull_request).collect(),
                issue_count: search.issue_count,
            })
        }
        Ok((_, errors)) => Err(first_message(&errors)),
        Err(error) => Err(error.to_string()),
    }
}

/// Gathers the plan's answers into the section: one pull request per id, sifted
/// by the checks GitHub could not make.
fn assemble(config: &SectionConfig, plan: &QueryPlan, pages: Vec<Page>) -> SectionResult {
    let github_counts_alone = plan.github_counts_alone();
    let capped = pages.iter().any(|page| page.issue_count > page.pull_requests.len() as i64);
    let counted: i64 = pages.iter().map(|page| page.issue_count).sum();

    let mut seen = HashSet::new();
    let mut kept = Vec::new();
    for (search, page) in plan.searches.iter().zip(pages) {
        for pull_request in page.pull_requests {
            if search.holds(&pull_request) && seen.insert(pull_request.id.clone()) {
                kept.push(pull_request);
            }
        }
    }

    // GitHub ranks each search's matches on its own, and two such rankings have
    // no order between them, so a union takes the order the dashboard reads by.
    if plan.searches.len() > 1 {
        kept.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    }

    let total_count = if github_counts_alone { counted } else { kept.len() as i64 };
    kept.truncate(config.limit as usize);

    SectionResult {
        config: config.clone(),
        pull_requests: kept,
        total_count,
        count_is_partial: capped && !github_counts_alone,
        error: None,
        home_sections: None,
    }
}

fn failed(config: &SectionConfig, message: String) -> SectionResult {
    SectionResult {
        config: config.clone(),
        pull_requests: Vec::new(),
        total_count: 0,
        count_is_partial: false,
        error: Some(message),
        home_sections: None,
    }
}

fn first_message(errors: &[GraphQLError]) -> String {
    errors
        .first()
        .map(|error| error.message.clone())
        .unwrap_or_else(|| "GitHub returned no results.".to_string())
}

/// Search over `type: ISSUE` also matches issues, which arrive as nodes carrying
/// none of the pull request fields.
fn into_pull_request(node: &Value) -> Option<PullRequest> {
    let raw: RawPullRequest = serde_json::from_value(node.clone()).ok()?;

    Some(PullRequest {
        targets_non_default_branch: raw
            .repository
            .default_branch_ref
            .as_ref()
            .is_some_and(|default| default.name != raw.base_ref_name),
        id: raw.id,
        number: raw.number,
        title: raw.title,
        url: raw.url,
        repo: raw.repository.name_with_owner,
        is_private: raw.repository.is_private,
        is_draft: raw.is_draft,
        base_ref: raw.base_ref_name,
        head_ref: raw.head_ref_name,
        state: raw.state,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
        additions: raw.additions,
        deletions: raw.deletions,
        changed_files: raw.changed_files,
        comment_count: raw.total_comments_count.unwrap_or(0),
        is_read: raw.is_read_by_viewer.unwrap_or(true),
        check_state: raw
            .commits
            .nodes
            .first()
            .and_then(|node| node.commit.status_check_rollup.as_ref())
            .map_or_else(|| "NONE".to_string(), |rollup| rollup.state.clone()),
        review_decision: raw.review_decision.unwrap_or_else(|| "NONE".to_string()),
        mergeable: raw.mergeable,
        author: raw.author,
        labels: raw.labels.nodes,
        requested_reviewers: raw
            .review_requests
            .nodes
            .into_iter()
            .filter_map(|node| node.requested_reviewer)
            .filter_map(|reviewer| reviewer.login.or(reviewer.name))
            .collect(),
        latest_reviews: raw.latest_reviews.map(|reviews| reviews.nodes).unwrap_or_default(),
    })
}

async fn graphql<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    document: &str,
    variables: Value,
) -> Result<T> {
    match graphql_allowing_partial::<T>(client, token, document, variables).await? {
        (_, errors) if !errors.is_empty() => Err(AppError::new(first_message(&errors))),
        (Some(data), _) => Ok(data),
        (None, _) => Err(AppError::new("GitHub returned no data.")),
    }
}

async fn graphql_allowing_partial<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    token: &str,
    document: &str,
    variables: Value,
) -> Result<(Option<T>, Vec<GraphQLError>)> {
    let response = client
        .post(GRAPHQL_ENDPOINT)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "crows-foot")
        .json(&json!({ "query": document, "variables": variables }))
        .send()
        .await
        .map_err(|error| AppError::new(format!("Could not reach GitHub: {error}")))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::stale_credential(
            "GitHub rejected the token. Run `gh auth login` to refresh it.",
        ));
    }
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::new(format!("GitHub responded {status}: {}", truncate(&body, 300))));
    }

    let envelope: Envelope<T> = response
        .json()
        .await
        .map_err(|error| AppError::new(format!("GitHub sent a response we could not read: {error}")))?;

    Ok((envelope.data, envelope.errors.unwrap_or_default()))
}

fn truncate(text: &str, limit: usize) -> &str {
    match text.char_indices().nth(limit) {
        Some((index, _)) => &text[..index],
        None => text,
    }
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQLError>>,
}

#[derive(Deserialize)]
struct GraphQLError {
    message: String,
}

#[derive(Deserialize)]
struct ViewerData {
    viewer: Actor,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchData {
    search: Option<SearchResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    issue_count: i64,
    nodes: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPullRequest {
    id: String,
    number: u64,
    title: String,
    url: String,
    is_draft: bool,
    state: String,
    created_at: String,
    updated_at: String,
    additions: i64,
    deletions: i64,
    changed_files: i64,
    total_comments_count: Option<i64>,
    is_read_by_viewer: Option<bool>,
    review_decision: Option<String>,
    mergeable: String,
    base_ref_name: String,
    head_ref_name: String,
    repository: RawRepository,
    author: Option<Actor>,
    labels: Nodes<Label>,
    review_requests: Nodes<RawReviewRequest>,
    latest_reviews: Option<Nodes<Review>>,
    commits: Nodes<RawCommitNode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRepository {
    name_with_owner: String,
    is_private: bool,
    default_branch_ref: Option<RawRef>,
}

#[derive(Deserialize)]
struct RawRef {
    name: String,
}

#[derive(Deserialize)]
struct Nodes<T> {
    nodes: Vec<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawReviewRequest {
    requested_reviewer: Option<RawReviewer>,
}

#[derive(Deserialize)]
struct RawReviewer {
    login: Option<String>,
    name: Option<String>,
}

#[derive(Deserialize)]
struct RawCommitNode {
    commit: RawCommit,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCommit {
    status_check_rollup: Option<RawRollup>,
}

#[derive(Deserialize)]
struct RawRollup {
    state: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node() -> Value {
        json!({
            "id": "PR_1", "number": 7, "title": "Teach the crow to count", "url": "https://example.test/7",
            "isDraft": false, "state": "OPEN", "createdAt": "2026-08-01T00:00:00Z",
            "updatedAt": "2026-08-02T00:00:00Z", "additions": 3, "deletions": 1, "changedFiles": 2,
            "totalCommentsCount": null, "isReadByViewer": null, "reviewDecision": null,
            "mergeable": "MERGEABLE", "baseRefName": "main", "headRefName": "feature",
            "repository": { "nameWithOwner": "acme/rocket", "isPrivate": false, "defaultBranchRef": { "name": "main" } },
            "author": { "login": "wile", "avatarUrl": "a", "url": "u" },
            "labels": { "nodes": [] },
            "reviewRequests": { "nodes": [{ "requestedReviewer": { "name": "birds" } }, { "requestedReviewer": null }] },
            "latestReviews": null,
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": null } }] },
        })
    }

    #[test]
    fn an_issue_among_the_results_is_not_a_pull_request() {
        assert!(into_pull_request(&json!({})).is_none());
    }

    #[test]
    fn a_pull_request_with_nothing_reported_reads_as_seen_and_unchecked() {
        let pull_request = into_pull_request(&node()).unwrap();

        assert!(pull_request.is_read);
        assert_eq!(pull_request.check_state, "NONE");
        assert_eq!(pull_request.review_decision, "NONE");
        assert_eq!(pull_request.comment_count, 0);
    }

    #[test]
    fn a_team_review_request_is_named_by_team() {
        assert_eq!(into_pull_request(&node()).unwrap().requested_reviewers, vec!["birds"]);
    }

    #[test]
    fn a_pull_request_onto_the_default_branch_is_not_stacked() {
        assert!(!into_pull_request(&node()).unwrap().targets_non_default_branch);
    }

    #[test]
    fn a_pull_request_onto_another_branch_is_stacked() {
        let mut stacked = node();
        stacked["baseRefName"] = json!("parent-branch");

        assert!(into_pull_request(&stacked).unwrap().targets_non_default_branch);
    }

    fn row(id: &str, updated_at: &str) -> Value {
        let mut raw = node();
        raw["id"] = json!(id);
        raw["updatedAt"] = json!(updated_at);
        raw
    }

    fn page(rows: &[Value], issue_count: i64) -> Page {
        Page { pull_requests: rows.iter().filter_map(into_pull_request).collect(), issue_count }
    }

    fn section(query: &str, limit: u32) -> SectionConfig {
        SectionConfig {
            id: query.into(),
            title: "Mine".into(),
            query: query.into(),
            limit,
            collapsed: false,
            color: "#000000".into(),
            counts_toward_badge: false,
        }
    }

    fn ids(result: &SectionResult) -> Vec<&str> {
        result.pull_requests.iter().map(|pull_request| pull_request.id.as_str()).collect()
    }

    #[test]
    fn one_search_is_reported_the_way_github_counted_it() {
        let config = section("is:open author:@me", 50);
        let plan = query::plan(&config.query, &[]).unwrap();

        let result = assemble(&config, &plan, vec![page(&[row("a", "2026-08-01T00:00:00Z")], 137)]);

        assert_eq!(ids(&result), ["a"]);
        assert_eq!(result.total_count, 137);
        assert!(!result.count_is_partial);
    }

    #[test]
    fn a_pull_request_matched_by_two_branches_is_listed_once() {
        let config = section("author:@me or mentions:@me", 50);
        let plan = query::plan(&config.query, &[]).unwrap();
        let shared = row("a", "2026-08-01T00:00:00Z");

        let result = assemble(
            &config,
            &plan,
            vec![
                page(std::slice::from_ref(&shared), 1),
                page(&[shared, row("b", "2026-08-03T00:00:00Z")], 2),
            ],
        );

        assert_eq!(ids(&result), ["b", "a"]);
        assert_eq!(result.total_count, 2);
    }

    #[test]
    fn a_union_is_ordered_by_what_moved_last() {
        let config = section("author:@me or mentions:@me", 50);
        let plan = query::plan(&config.query, &[]).unwrap();

        let result = assemble(
            &config,
            &plan,
            vec![
                page(&[row("old", "2026-01-01T00:00:00Z"), row("new", "2026-08-20T00:00:00Z")], 2),
                page(&[row("middle", "2026-05-05T00:00:00Z")], 1),
            ],
        );

        assert_eq!(ids(&result), ["new", "middle", "old"]);
    }

    #[test]
    fn a_local_qualifier_sifts_the_rows_and_the_count_with_them() {
        let config = section("author:@me unread:yes", 50);
        let plan = query::plan(&config.query, &[]).unwrap();
        let mut unread = row("unread", "2026-08-01T00:00:00Z");
        unread["isReadByViewer"] = json!(false);

        let result = assemble(&config, &plan, vec![page(&[unread, row("read", "2026-08-02T00:00:00Z")], 2)]);

        assert_eq!(ids(&result), ["unread"]);
        assert_eq!(result.total_count, 1);
    }

    #[test]
    fn a_count_is_partial_only_where_a_sifted_search_was_capped() {
        let config = section("author:@me unread:yes", 50);
        let plan = query::plan(&config.query, &[]).unwrap();
        let rows = [row("a", "2026-08-01T00:00:00Z")];

        assert!(!assemble(&config, &plan, vec![page(&rows, 1)]).count_is_partial);
        assert!(assemble(&config, &plan, vec![page(&rows, 200)]).count_is_partial);
    }

    #[test]
    fn a_section_shows_no_more_than_its_limit_but_counts_what_it_found() {
        let config = section("author:@me or mentions:@me", 1);
        let plan = query::plan(&config.query, &[]).unwrap();

        let result = assemble(
            &config,
            &plan,
            vec![page(&[row("a", "2026-08-01T00:00:00Z")], 1), page(&[row("b", "2026-08-02T00:00:00Z")], 1)],
        );

        assert_eq!(ids(&result), ["b"]);
        assert_eq!(result.total_count, 2);
    }

    /// Run with `cargo test -- --ignored` and a GitHub credential to hand.
    #[tokio::test]
    #[ignore = "calls GitHub"]
    async fn a_live_search_names_the_viewer_and_fails_no_section() {
        let config = crate::types::AppConfig {
            sections: vec![
                section("is:open is:pr author:@me archived:false", 5),
                section("is:open is:pr (author:@me or review-requested:@me) -stacked:yes", 20),
            ],
            global_filters: Vec::new(),
            refresh_interval_seconds: 120,
        };

        let dashboard = live(&config).await;

        assert!(!dashboard.viewer.login.is_empty());
        for section in &dashboard.sections {
            assert_eq!(section.error, None, "for `{}`", section.config.query);
        }
    }

    /// Run with `cargo test -- --ignored` and a GitHub credential to hand.
    #[tokio::test]
    #[ignore = "calls GitHub"]
    async fn a_live_union_holds_one_row_per_pull_request_and_every_local_check() {
        let branches = section("is:open is:pr (author:@me or review-requested:@me) archived:false", 50);
        let config = crate::types::AppConfig {
            sections: vec![
                branches.clone(),
                SectionConfig { query: format!("{} -stacked:yes", branches.query), ..branches },
            ],
            global_filters: Vec::new(),
            refresh_interval_seconds: 120,
        };

        let dashboard = live(&config).await;
        let [both, on_the_default_branch] = &dashboard.sections[..2] else { panic!("two sections") };

        let mut ids: Vec<&str> = both.pull_requests.iter().map(|row| row.id.as_str()).collect();
        let found = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), found, "a pull request matched by both branches was listed twice");

        assert!(on_the_default_branch.pull_requests.iter().all(|row| !row.targets_non_default_branch));
        assert!(on_the_default_branch.total_count <= both.total_count);
    }

    /// Run with `cargo test -- --ignored` and a GitHub credential to hand.
    #[tokio::test]
    #[ignore = "calls GitHub"]
    async fn a_live_section_counts_approvals_off_the_reviews_github_returns() {
        let involved = "is:open is:pr involves:@me archived:false";
        let config = crate::types::AppConfig {
            sections: vec![
                section(&format!("{involved} approvals:>=1"), 30),
                section(&format!("{involved} approvals:0"), 30),
            ],
            global_filters: Vec::new(),
            refresh_interval_seconds: 120,
        };

        let dashboard = live(&config).await;
        let [approved, untouched] = &dashboard.sections[..2] else { panic!("two sections") };
        let approves = |row: &PullRequest| row.latest_reviews.iter().any(|it| it.state == "APPROVED");

        assert!(approved.pull_requests.iter().all(approves));
        assert!(!untouched.pull_requests.iter().any(approves));
    }

    async fn live(config: &crate::types::AppConfig) -> DashboardResponse {
        let token = crate::token::TokenCache::default().resolve().await.unwrap();
        fetch_dashboard(&reqwest::Client::new(), &token, config).await.unwrap()
    }
}
