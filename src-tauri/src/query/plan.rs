//! Compiling a query into the searches GitHub runs and the checks kept for the
//! rows they return.

use crate::error::{AppError, Result};
use crate::query::local::Local;
use crate::query::parse::{parse, Expr, Term};
use crate::types::{GlobalFilter, PullRequest};
use chrono::{Duration, NaiveDate, Utc};
use serde::Serialize;

/// More searches than this from one section is a query gone wide by accident.
const MOST_SEARCHES: usize = 8;

/// Qualifiers that hold a search to a corner of GitHub rather than all of it.
const ANCHORS: &[&str] = &[
    "assignee",
    "author",
    "commenter",
    "involves",
    "mentions",
    "org",
    "repo",
    "review-requested",
    "reviewed-by",
    "team",
    "team-review-requested",
    "user",
    "user-review-requested",
];

/// Local qualifiers that search what their reviewer reviewed, and so anchor too.
const REVIEW_RESULTS: &[&str] = &["approved-by", "changes-requested-by", "commented-by"];

/// What a section's query comes to: the searches to run, unioned, and the
/// advice worth showing the user about them.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryPlan {
    pub searches: Vec<Search>,
    pub warnings: Vec<String>,
}

impl QueryPlan {
    /// Whether GitHub's own count of the matches is the section's count.
    pub fn github_counts_alone(&self) -> bool {
        matches!(self.searches.as_slice(), [only] if only.kept_locally.is_empty())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    /// What GitHub is asked.
    pub query: String,
    /// What is then asked of each row GitHub returns.
    pub kept_locally: Vec<Local>,
}

impl Search {
    pub fn holds(&self, pull_request: &PullRequest) -> bool {
        self.kept_locally.iter().all(|check| check.holds(pull_request))
    }
}

/// Compiles a section's query, narrowed by the enabled global filters.
pub fn plan(section_query: &str, global_filters: &[GlobalFilter]) -> Result<QueryPlan> {
    plan_on(section_query, global_filters, Utc::now().date_naive())
}

fn plan_on(section_query: &str, global_filters: &[GlobalFilter], today: NaiveDate) -> Result<QueryPlan> {
    let mut operands = vec![parse(section_query)?];
    for filter in global_filters.iter().filter(|filter| filter.enabled && !filter.query.trim().is_empty()) {
        operands.push(
            parse(&filter.query)
                .map_err(|error| AppError::new(format!("Global filter `{}`: {error}", filter.query)))?,
        );
    }

    let expanded = expand(&Expr::every(operands), today)?;

    let mut searches = Vec::new();
    let mut warnings = Vec::new();
    for disjunct in spread(&expanded, false)? {
        let search = compile(&disjunct)?;
        if !anchored(&disjunct) {
            warnings.push(format!(
                "`{}` is not held to a person, org, or repo, so GitHub searches all of it.",
                search.query
            ));
        }
        searches.push(search);
    }

    Ok(QueryPlan { searches, warnings })
}

/// A term, negated or not, as it sits in a conjunction.
#[derive(Clone, Debug)]
struct Literal {
    negated: bool,
    term: Term,
}

impl Literal {
    fn render(&self) -> String {
        let dash = if self.negated { "-" } else { "" };
        format!("{dash}{}", self.term.render())
    }
}

/// Rewrites the qualifiers that stand for a GitHub search of their own.
fn expand(expression: &Expr, today: NaiveDate) -> Result<Expr> {
    Ok(match expression {
        Expr::Term(term) => shorthand(term, today)?.unwrap_or_else(|| expression.clone()),
        Expr::Not(inner) => expand(inner, today)?.not(),
        Expr::Every(operands) => Expr::Every(expand_each(operands, today)?),
        Expr::Any(operands) => Expr::Any(expand_each(operands, today)?),
    })
}

fn expand_each(operands: &[Expr], today: NaiveDate) -> Result<Vec<Expr>> {
    operands.iter().map(|operand| expand(operand, today)).collect()
}

fn shorthand(term: &Term, today: NaiveDate) -> Result<Option<Expr>> {
    let Some(key) = term.key.as_deref() else { return Ok(None) };

    Ok(Some(match (key, term.value.as_str()) {
        ("review", "re-requested") => Expr::Every(vec![
            Expr::Term(Term::qualifier("review-requested", "@me")),
            Expr::Term(Term::qualifier("reviewed-by", "@me")),
        ]),
        ("checks", value) => Expr::Term(Term::qualifier("status", rollup(value)?)),
        ("idle", value) => Expr::Term(untouched_since(value, today)?),
        _ => return Ok(None),
    }))
}

fn rollup(value: &str) -> Result<&'static str> {
    match value {
        "failing" => Ok("failure"),
        "passing" => Ok("success"),
        "pending" => Ok("pending"),
        _ => Err(AppError::new(format!("`checks:` takes failing, passing, or pending, not `{value}`."))),
    }
}

/// `idle:>1w` is "untouched for longer than a week", which GitHub can answer
/// once the week is counted back from today, since it dates rather than ages.
fn untouched_since(value: &str, today: NaiveDate) -> Result<Term> {
    let complaint = || {
        AppError::new(format!(
            "`idle:` takes a span of days or weeks after > or <, like idle:>7d, not `{value}`."
        ))
    };

    let (longer, span) = match (value.strip_prefix('>'), value.strip_prefix('<')) {
        (Some(span), _) => (true, span),
        (_, Some(span)) => (false, span),
        _ => return Err(complaint()),
    };

    let (count, per) = match (span.strip_suffix('d'), span.strip_suffix('w')) {
        (Some(count), _) => (count, 1),
        (_, Some(count)) => (count, 7),
        _ => return Err(complaint()),
    };
    let days = count.parse::<i64>().map_err(|_| complaint())? * per;

    let edge = (today - Duration::days(days)).format("%Y-%m-%d");
    Ok(Term::qualifier("updated", &format!("{}{edge}", if longer { "<" } else { ">" })))
}

/// The disjunctive normal form of `expression`: the ways it can be satisfied,
/// each a conjunction of literals.
fn spread(expression: &Expr, negated: bool) -> Result<Vec<Vec<Literal>>> {
    match expression {
        Expr::Term(term) => Ok(vec![vec![Literal { negated, term: term.clone() }]]),
        Expr::Not(inner) => spread(inner, !negated),
        Expr::Every(operands) if negated => union(operands, negated),
        Expr::Every(operands) => product(operands, negated),
        Expr::Any(operands) if negated => product(operands, negated),
        Expr::Any(operands) => union(operands, negated),
    }
}

/// The branches of every operand, side by side: satisfying any one of them
/// satisfies the whole.
fn union(operands: &[Expr], negated: bool) -> Result<Vec<Vec<Literal>>> {
    let mut branches = Vec::new();
    for operand in operands {
        branches.extend(spread(operand, negated)?);
    }

    within_reason(branches)
}

/// Every way of picking one branch from each operand, which is how a
/// conjunction over disjunctions spreads out.
fn product(operands: &[Expr], negated: bool) -> Result<Vec<Vec<Literal>>> {
    let mut combined = vec![Vec::new()];

    for operand in operands {
        let branches = spread(operand, negated)?;
        let mut widened = Vec::with_capacity(combined.len() * branches.len());
        for start in &combined {
            for branch in &branches {
                let mut merged = start.clone();
                merged.extend(branch.iter().cloned());
                widened.push(merged);
            }
        }
        combined = within_reason(widened)?;
    }

    Ok(combined)
}

fn within_reason(branches: Vec<Vec<Literal>>) -> Result<Vec<Vec<Literal>>> {
    if branches.len() > MOST_SEARCHES {
        return Err(AppError::new(format!(
            "This query spreads into more than {MOST_SEARCHES} searches. Narrow it, or split it across sections."
        )));
    }

    Ok(branches)
}

/// Splits one conjunction into the search GitHub runs and the checks left over.
fn compile(disjunct: &[Literal]) -> Result<Search> {
    let mut query: Vec<String> = Vec::new();
    let mut kept_locally: Vec<Local> = Vec::new();

    for literal in disjunct {
        match Local::read(&literal.term, literal.negated) {
            Some(local) => {
                let local = local?;
                if let Some(implied) = local.implied_search() {
                    keep(&mut query, implied.render(), String::clone);
                }
                keep(&mut kept_locally, local, Local::render);
            }
            None => keep(&mut query, literal.render(), String::clone),
        }
    }

    if query.is_empty() {
        return Err(AppError::new(format!(
            "`{}` gives GitHub nothing to search for. Every branch of an `or` needs a qualifier GitHub understands.",
            rendered(disjunct)
        )));
    }

    Ok(Search { query: query.join(" "), kept_locally })
}

/// Adds `addition` unless the same text is already there, since a global filter
/// often repeats a term the section already has.
fn keep<T>(kept: &mut Vec<T>, addition: T, render: impl Fn(&T) -> String) {
    let rendering = render(&addition);
    if !kept.iter().any(|held| render(held) == rendering) {
        kept.push(addition);
    }
}

fn rendered(disjunct: &[Literal]) -> String {
    disjunct.iter().map(Literal::render).collect::<Vec<_>>().join(" ")
}

fn anchored(disjunct: &[Literal]) -> bool {
    disjunct.iter().any(|literal| {
        !literal.negated
            && literal.term.key.as_deref().is_some_and(|key| ANCHORS.contains(&key) || REVIEW_RESULTS.contains(&key))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on(query: &str) -> QueryPlan {
        plan_on(query, &[], NaiveDate::from_ymd_opt(2026, 8, 21).expect("a date")).unwrap()
    }

    fn searches(query: &str) -> Vec<String> {
        on(query).searches.into_iter().map(|search| search.query).collect()
    }

    fn refusal(query: &str) -> String {
        plan(query, &[]).unwrap_err().to_string()
    }

    fn filter(query: &str, enabled: bool) -> GlobalFilter {
        GlobalFilter { id: query.into(), query: query.into(), enabled }
    }

    #[test]
    fn a_query_github_could_run_itself_reaches_it_unchanged() {
        for query in [
            "is:open is:pr review-requested:@me archived:false",
            "is:open is:pr author:@me review:changes-requested archived:false",
            "is:open is:pr author:@me -review:approved -review:changes-requested -is:draft archived:false",
            "is:open is:pr mentions:@me -author:@me archived:false",
            "is:pr author:@me is:merged archived:false",
        ] {
            assert_eq!(searches(query), [query]);
            assert!(on(query).github_counts_alone(), "`{query}` gained a local pass");
        }
    }

    #[test]
    fn every_query_the_app_ships_with_is_one_github_can_answer() {
        for section in crate::config::default_config().sections {
            let plan = on(&section.query);

            assert!(
                plan.searches.iter().all(|search| search.kept_locally.is_empty()),
                "{} leans on a local pass",
                section.id
            );
            assert!(plan.warnings.is_empty(), "{} warns: {:?}", section.id, plan.warnings);
        }
    }

    #[test]
    fn each_branch_of_an_or_becomes_its_own_search() {
        assert_eq!(
            searches("is:open author:@me or is:open mentions:@me"),
            ["is:open author:@me", "is:open mentions:@me"]
        );
    }

    #[test]
    fn a_conjunction_over_disjunctions_spreads_into_every_pairing() {
        assert_eq!(
            searches("(author:@me or mentions:@me) (is:open or is:merged)"),
            ["author:@me is:open", "author:@me is:merged", "mentions:@me is:open", "mentions:@me is:merged"]
        );
    }

    #[test]
    fn a_group_within_a_branch_keeps_that_branch_whole() {
        assert_eq!(
            searches("is:open (user-review-requested:@me or (review-requested:@me -reviewed-by:@me))"),
            [
                "is:open user-review-requested:@me",
                "is:open review-requested:@me -reviewed-by:@me",
            ]
        );
    }

    #[test]
    fn a_negated_disjunction_becomes_one_search_denying_both() {
        assert_eq!(searches("author:@me -(is:draft or is:merged)"), ["author:@me -is:draft -is:merged"]);
    }

    #[test]
    fn a_negated_conjunction_becomes_a_search_for_each_way_it_can_fail() {
        assert_eq!(searches("author:@me -(is:draft is:merged)"), ["author:@me -is:draft", "author:@me -is:merged"]);
    }

    #[test]
    fn a_query_that_spreads_past_the_cap_is_refused() {
        let wide = "(a:1 or b:2) (c:3 or d:4) (e:5 or f:6) (g:7 or h:8)";

        assert_eq!(
            refusal(wide),
            "This query spreads into more than 8 searches. Narrow it, or split it across sections."
        );
    }

    #[test]
    fn a_global_filter_narrows_every_branch() {
        let plan = plan_on(
            "author:@me or mentions:@me",
            &[filter("org:acme", true), filter("is:merged", false)],
            NaiveDate::from_ymd_opt(2026, 8, 21).expect("a date"),
        )
        .unwrap();

        let queries: Vec<String> = plan.searches.into_iter().map(|search| search.query).collect();
        assert_eq!(queries, ["author:@me org:acme", "mentions:@me org:acme"]);
    }

    #[test]
    fn a_global_filter_may_branch_of_its_own() {
        let plan = plan_on(
            "author:@me",
            &[filter("org:acme or org:birds", true)],
            NaiveDate::from_ymd_opt(2026, 8, 21).expect("a date"),
        )
        .unwrap();

        let queries: Vec<String> = plan.searches.into_iter().map(|search| search.query).collect();
        assert_eq!(queries, ["author:@me org:acme", "author:@me org:birds"]);
    }

    #[test]
    fn a_term_repeated_by_a_global_filter_is_sent_once() {
        assert_eq!(
            plan_on("is:open author:@me", &[filter("is:open", true)], NaiveDate::default()).unwrap().searches[0]
                .query,
            "is:open author:@me"
        );
    }

    #[test]
    fn a_local_qualifier_is_held_back_from_the_search() {
        let plan = on("is:open review-requested:@me unread:yes -size:>500");

        assert_eq!(plan.searches[0].query, "is:open review-requested:@me");
        assert_eq!(
            plan.searches[0].kept_locally.iter().map(Local::render).collect::<Vec<_>>(),
            ["unread:yes", "-size:>500"]
        );
        assert!(!plan.github_counts_alone());
    }

    #[test]
    fn a_reviewers_result_searches_what_they_reviewed_and_keeps_the_result_locally() {
        let plan = on("is:pr approved-by:alice");
        assert_eq!(plan.searches[0].query, "is:pr reviewed-by:alice");
        assert_eq!(plan.searches[0].kept_locally.iter().map(Local::render).collect::<Vec<_>>(), ["approved-by:alice"]);
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn a_reviewers_result_anchors_its_own_branch_of_an_or() {
        assert_eq!(
            searches("is:pr (author:@me or changes-requested-by:bob)"),
            ["is:pr author:@me", "is:pr reviewed-by:bob"]
        );
    }

    #[test]
    fn a_denied_reviewers_result_is_checked_locally_alone() {
        let plan = on("author:@me -approved-by:alice");
        assert_eq!(plan.searches[0].query, "author:@me");
        assert_eq!(plan.searches[0].kept_locally.iter().map(Local::render).collect::<Vec<_>>(), ["-approved-by:alice"]);
    }

    #[test]
    fn a_branch_of_only_local_qualifiers_is_refused() {
        assert_eq!(
            refusal("author:@me or conflicts:yes"),
            "`conflicts:yes` gives GitHub nothing to search for. Every branch of an `or` needs a qualifier GitHub understands."
        );
    }

    #[test]
    fn a_re_requested_review_is_a_search_github_can_run() {
        assert_eq!(searches("is:open is:pr review:re-requested"), ["is:open is:pr review-requested:@me reviewed-by:@me"]);
    }

    #[test]
    fn a_review_state_github_owns_is_left_to_github() {
        assert_eq!(searches("review:changes-requested"), ["review:changes-requested"]);
    }

    #[test]
    fn a_check_rollup_becomes_githubs_own_word_for_it() {
        assert_eq!(searches("author:@me checks:failing"), ["author:@me status:failure"]);
        assert_eq!(refusal("checks:red"), "`checks:` takes failing, passing, or pending, not `red`.");
    }

    #[test]
    fn an_age_becomes_the_date_it_falls_on() {
        assert_eq!(searches("author:@me idle:>1w"), ["author:@me updated:<2026-08-14"]);
        assert_eq!(searches("author:@me idle:<2d"), ["author:@me updated:>2026-08-19"]);
        assert_eq!(
            refusal("idle:7"),
            "`idle:` takes a span of days or weeks after > or <, like idle:>7d, not `7`."
        );
    }

    #[test]
    fn a_negated_shorthand_spreads_the_way_its_expansion_does() {
        assert_eq!(
            searches("is:open -review:re-requested"),
            ["is:open -review-requested:@me", "is:open -reviewed-by:@me"]
        );
    }

    #[test]
    fn a_search_loose_on_all_of_github_is_warned_about_but_still_run() {
        let plan = on("is:open is:pr is:draft");

        assert_eq!(plan.searches.len(), 1);
        assert_eq!(
            plan.warnings,
            ["`is:open is:pr is:draft` is not held to a person, org, or repo, so GitHub searches all of it."]
        );
    }

    #[test]
    fn a_query_that_does_not_parse_says_so() {
        assert_eq!(refusal("(is:open"), "The query has a `(` that is never closed.");
    }
}
