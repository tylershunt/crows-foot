//! The pull requests being held back, and the section that shows them.

use crate::error::Result;
use crate::types::{DashboardResponse, PullRequest, SectionConfig, SectionResult};
use chrono::DateTime;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

/// The one section the app maintains itself. It holds whatever the snooze store
/// is currently hiding from the sections above it, so it is never sent to GitHub
/// and has no entry in the config for you to edit — hence the empty query and
/// limit, which nothing reads.
pub fn snoozed_section() -> SectionConfig {
    SectionConfig {
        id: "snoozed".into(),
        title: "Snoozed".into(),
        query: String::new(),
        limit: 0,
        collapsed: true,
        color: "#71718c".into(),
        counts_toward_badge: false,
    }
}

/// Whether a snooze set at `snoozed_at` still hides a pull request last touched
/// at `updated_at`. Timestamps are parsed rather than compared as text because
/// GitHub omits the milliseconds an ISO timestamp is written with.
pub fn snooze_holds(snoozed_at: &str, updated_at: &str) -> bool {
    match (DateTime::parse_from_rfc3339(snoozed_at), DateTime::parse_from_rfc3339(updated_at)) {
        (Ok(snoozed), Ok(updated)) => updated <= snoozed,
        _ => false,
    }
}

pub struct SnoozeStore {
    connection: Mutex<Connection>,
}

impl SnoozeStore {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Self::prepared(connection)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::prepared(Connection::open_in_memory()?)
    }

    fn prepared(connection: Connection) -> Result<Self> {
        connection.execute(
            "CREATE TABLE IF NOT EXISTS snoozes (pull_request_id TEXT PRIMARY KEY, snoozed_at TEXT NOT NULL)",
            [],
        )?;
        Ok(Self { connection: Mutex::new(connection) })
    }

    /// Hides a pull request until it is updated after `at`.
    pub fn snooze(&self, pull_request_id: &str, at: &str) -> Result<()> {
        self.locked().execute(
            "INSERT INTO snoozes (pull_request_id, snoozed_at) VALUES (?1, ?2)
             ON CONFLICT(pull_request_id) DO UPDATE SET snoozed_at = excluded.snoozed_at",
            (pull_request_id, at),
        )?;
        Ok(())
    }

    /// When each currently snoozed pull request was snoozed, keyed by node id.
    pub fn snoozed_at(&self) -> Result<HashMap<String, String>> {
        let connection = self.locked();
        let mut statement = connection.prepare("SELECT pull_request_id, snoozed_at FROM snoozes")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<rusqlite::Result<HashMap<String, String>>>()?)
    }

    pub fn wake(&self, pull_request_ids: &[String]) -> Result<()> {
        let mut connection = self.locked();
        let transaction = connection.transaction()?;
        for id in pull_request_ids {
            transaction.execute("DELETE FROM snoozes WHERE pull_request_id = ?1", [id])?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.connection.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Moves the pull requests the store is still hiding out of the sections that
/// matched them and into a trailing `Snoozed` section, and forgets the snoozes
/// their pull requests have since outlived.
///
/// A pull request is only listed as snoozed while some section's query still
/// returns it; one that has fallen out of every query is hidden from a dashboard
/// that would not have shown it anyway.
pub fn with_snoozed_section(
    dashboard: DashboardResponse,
    store: &SnoozeStore,
) -> Result<DashboardResponse> {
    let snoozed_at = store.snoozed_at()?;
    let mut lapsed = Vec::new();
    let mut held: Vec<(PullRequest, SectionConfig)> = Vec::new();

    let mut awake = dashboard;
    for section in &mut awake.sections {
        let matched = section.pull_requests.len();
        let mut kept = Vec::with_capacity(matched);

        for pull_request in std::mem::take(&mut section.pull_requests) {
            match snoozed_at.get(&pull_request.id) {
                Some(at) if snooze_holds(at, &pull_request.updated_at) => {
                    // A pull request several sections matched belongs to the first that shows it.
                    if !held.iter().any(|(other, _)| other.id == pull_request.id) {
                        held.push((pull_request, section.config.clone()));
                    }
                }
                Some(_) => {
                    lapsed.push(pull_request.id.clone());
                    kept.push(pull_request);
                }
                None => kept.push(pull_request),
            }
        }

        // The withheld matches a section reports must shed what is being held back.
        section.total_count -= (matched - kept.len()) as i64;
        section.pull_requests = kept;
    }

    store.wake(&lapsed)?;

    held.sort_by(|(left, _), (right, _)| updated(right).cmp(&updated(left)));
    awake.sections.push(SectionResult {
        config: snoozed_section(),
        error: None,
        total_count: held.len() as i64,
        count_is_partial: false,
        home_sections: Some(
            held.iter().map(|(pull_request, home)| (pull_request.id.clone(), home.clone())).collect(),
        ),
        pull_requests: held.into_iter().map(|(pull_request, _)| pull_request).collect(),
    });

    Ok(awake)
}

fn updated(pull_request: &PullRequest) -> Option<DateTime<chrono::FixedOffset>> {
    DateTime::parse_from_rfc3339(&pull_request.updated_at).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Actor;

    fn pull_request(id: &str, updated_at: &str) -> PullRequest {
        PullRequest {
            id: id.into(),
            number: 1,
            title: String::new(),
            url: String::new(),
            repo: String::new(),
            is_private: false,
            is_draft: false,
            base_ref: String::new(),
            head_ref: String::new(),
            targets_non_default_branch: false,
            state: "OPEN".into(),
            created_at: updated_at.into(),
            updated_at: updated_at.into(),
            additions: 0,
            deletions: 0,
            changed_files: 0,
            comment_count: 0,
            is_read: true,
            check_state: "NONE".into(),
            review_decision: "NONE".into(),
            mergeable: "MERGEABLE".into(),
            author: None,
            labels: Vec::new(),
            requested_reviewers: Vec::new(),
            latest_reviews: Vec::new(),
        }
    }

    fn section(id: &str, rows: &[(&str, &str)], total_count: Option<i64>) -> SectionResult {
        SectionResult {
            config: SectionConfig {
                id: id.into(),
                title: id.into(),
                query: String::new(),
                limit: 50,
                collapsed: false,
                color: "#000000".into(),
                counts_toward_badge: false,
            },
            error: None,
            total_count: total_count.unwrap_or(rows.len() as i64),
            count_is_partial: false,
            pull_requests: rows.iter().map(|(id, at)| pull_request(id, at)).collect(),
            home_sections: None,
        }
    }

    fn dashboard(rows: &[(&str, &str)], total_count: Option<i64>) -> DashboardResponse {
        DashboardResponse {
            viewer: Actor { login: "someone".into(), avatar_url: String::new(), url: String::new() },
            sections: vec![section("s", rows, total_count)],
        }
    }

    fn shown(response: &DashboardResponse) -> Vec<&str> {
        response.sections[0].pull_requests.iter().map(|pr| pr.id.as_str()).collect()
    }

    fn snoozed_list(response: &DashboardResponse) -> Vec<&str> {
        let last = response.sections.last().expect("a dashboard always has a snoozed section");
        assert_eq!(last.config.id, snoozed_section().id, "the snoozed section is always last");
        last.pull_requests.iter().map(|pr| pr.id.as_str()).collect()
    }

    #[test]
    fn a_snoozed_pull_request_is_withheld_while_its_last_update_predates_the_snooze() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("quiet", "2026-08-19T12:00:00.000Z").unwrap();

        let rows = [("quiet", "2026-08-19T09:00:00Z"), ("loud", "2026-08-19T09:00:00Z")];
        let response = with_snoozed_section(dashboard(&rows, None), &store).unwrap();

        assert_eq!(shown(&response), ["loud"]);
    }

    #[test]
    fn a_snooze_lapses_and_is_forgotten_once_the_pull_request_is_updated_after_it() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T12:00:00.000Z").unwrap();

        let response =
            with_snoozed_section(dashboard(&[("pr", "2026-08-19T12:30:00Z")], None), &store).unwrap();

        assert_eq!(shown(&response), ["pr"]);
        assert!(store.snoozed_at().unwrap().is_empty());
    }

    #[test]
    fn an_update_at_the_very_instant_of_the_snooze_does_not_wake_the_pull_request() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T12:00:00.000Z").unwrap();

        let response =
            with_snoozed_section(dashboard(&[("pr", "2026-08-19T12:00:00Z")], None), &store).unwrap();

        assert!(shown(&response).is_empty());
    }

    #[test]
    fn a_sections_total_sheds_the_pull_requests_it_withholds() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("a", "2026-08-19T12:00:00.000Z").unwrap();

        let rows = [("a", "2026-08-19T09:00:00Z"), ("b", "2026-08-19T09:00:00Z")];
        let response = with_snoozed_section(dashboard(&rows, Some(10)), &store).unwrap();

        assert_eq!(response.sections[0].total_count, 9);
    }

    #[test]
    fn a_withheld_pull_request_is_listed_in_the_trailing_snoozed_section() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("quiet", "2026-08-19T12:00:00.000Z").unwrap();

        let rows = [("quiet", "2026-08-19T09:00:00Z"), ("loud", "2026-08-19T09:00:00Z")];
        let response = with_snoozed_section(dashboard(&rows, None), &store).unwrap();

        assert_eq!(snoozed_list(&response), ["quiet"]);
    }

    #[test]
    fn the_snoozed_section_is_present_and_empty_when_nothing_is_snoozed() {
        let store = SnoozeStore::open_in_memory().unwrap();

        let response =
            with_snoozed_section(dashboard(&[("pr", "2026-08-19T09:00:00Z")], None), &store).unwrap();

        assert!(snoozed_list(&response).is_empty());
        assert_eq!(response.sections.last().unwrap().total_count, 0);
    }

    #[test]
    fn a_pull_request_snoozed_out_of_two_sections_is_listed_once() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T12:00:00.000Z").unwrap();
        let mut two = dashboard(&[("pr", "2026-08-19T09:00:00Z")], None);
        two.sections.push(section("other", &[("pr", "2026-08-19T09:00:00Z")], None));

        let response = with_snoozed_section(two, &store).unwrap();

        assert_eq!(snoozed_list(&response), ["pr"]);
    }

    #[test]
    fn each_snoozed_row_remembers_the_section_that_would_be_showing_it() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T12:00:00.000Z").unwrap();

        let response =
            with_snoozed_section(dashboard(&[("pr", "2026-08-19T09:00:00Z")], None), &store).unwrap();

        let homes = response.sections.last().unwrap().home_sections.as_ref().unwrap();
        assert_eq!(homes["pr"].id, "s");
    }

    #[test]
    fn a_pull_request_several_sections_matched_belongs_to_the_first_that_shows_it() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T12:00:00.000Z").unwrap();
        let mut two = dashboard(&[("pr", "2026-08-19T09:00:00Z")], None);
        two.sections.insert(0, section("first", &[("pr", "2026-08-19T09:00:00Z")], None));

        let response = with_snoozed_section(two, &store).unwrap();

        let homes = response.sections.last().unwrap().home_sections.as_ref().unwrap();
        assert_eq!(homes["pr"].id, "first");
    }

    #[test]
    fn the_snoozed_section_lists_the_most_recently_updated_pull_request_first() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("older", "2026-08-19T12:00:00.000Z").unwrap();
        store.snooze("newer", "2026-08-19T12:00:00.000Z").unwrap();

        let rows = [("older", "2026-08-18T09:00:00Z"), ("newer", "2026-08-19T09:00:00Z")];
        let response = with_snoozed_section(dashboard(&rows, None), &store).unwrap();

        assert_eq!(snoozed_list(&response), ["newer", "older"]);
    }

    #[test]
    fn a_woken_pull_request_leaves_the_snoozed_section_as_it_returns_to_its_own() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T12:00:00.000Z").unwrap();

        let response =
            with_snoozed_section(dashboard(&[("pr", "2026-08-19T12:30:00Z")], None), &store).unwrap();

        assert_eq!(shown(&response), ["pr"]);
        assert!(snoozed_list(&response).is_empty());
    }

    #[test]
    fn snoozing_the_same_pull_request_twice_replaces_the_earlier_snooze() {
        let store = SnoozeStore::open_in_memory().unwrap();
        store.snooze("pr", "2026-08-19T09:00:00.000Z").unwrap();
        store.snooze("pr", "2026-08-19T15:00:00.000Z").unwrap();

        let response =
            with_snoozed_section(dashboard(&[("pr", "2026-08-19T12:00:00Z")], None), &store).unwrap();

        assert!(shown(&response).is_empty());
    }
}
