mod config;
mod error;
mod github;
mod query;
mod snooze;
mod token;
mod types;

use config::ConfigStore;
use error::Result;
use serde_json::Value;
use snooze::{with_snoozed_section, SnoozeStore};
use std::path::{Path, PathBuf};
use tauri::Manager;
use token::TokenCache;
use types::{ConfigResponse, DashboardResponse};

struct Crow {
    config: ConfigStore,
    snoozes: SnoozeStore,
    tokens: TokenCache,
    http: reqwest::Client,
}

#[tauri::command]
fn get_config(crow: tauri::State<'_, Crow>) -> Result<ConfigResponse> {
    Ok(crow.config.respond(crow.config.read()?))
}

#[tauri::command]
fn save_config(crow: tauri::State<'_, Crow>, config: Value) -> Result<ConfigResponse> {
    Ok(crow.config.respond(crow.config.write(&config)?))
}

#[tauri::command]
fn reset_config(crow: tauri::State<'_, Crow>) -> Result<ConfigResponse> {
    let defaults = serde_json::to_value(config::default_config()).expect("config serializes");
    Ok(crow.config.respond(crow.config.write(&defaults)?))
}

/// What `query` would run as, narrowed by `global_filters`, for a settings panel
/// showing the user their query before it is saved.
#[tauri::command]
fn explain_query(query: String, global_filters: Vec<types::GlobalFilter>) -> Result<query::QueryPlan> {
    crate::query::plan(&query, &global_filters)
}

#[tauri::command]
async fn get_dashboard(crow: tauri::State<'_, Crow>) -> Result<DashboardResponse> {
    let config = crow.config.read()?;

    let dashboard = match fetch(&crow, &config).await {
        Err(error) if error.stale_credential => {
            crow.tokens.forget().await;
            fetch(&crow, &config).await
        }
        outcome => outcome,
    }?;

    with_snoozed_section(dashboard, &crow.snoozes)
}

async fn fetch(crow: &Crow, config: &types::AppConfig) -> Result<DashboardResponse> {
    github::fetch_dashboard(&crow.http, &crow.tokens.resolve().await?, config).await
}

#[tauri::command]
fn snooze(crow: tauri::State<'_, Crow>, pull_request_id: String) -> Result<()> {
    crow.snoozes.snooze(&pull_request_id, &chrono::Utc::now().to_rfc3339())
}

#[tauri::command]
fn wake(crow: tauri::State<'_, Crow>, pull_request_id: String) -> Result<()> {
    crow.snoozes.wake(&[pull_request_id])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            inherit_from_crows_eye(&data)?;
            app.manage(Crow {
                config: ConfigStore::new(beside(&data, "CROWS_FOOT_CONFIG", "config.json")),
                snoozes: SnoozeStore::open(&beside(&data, "CROWS_FOOT_SNOOZE_DB", "snoozes.db"))?,
                tokens: TokenCache::default(),
                http: reqwest::Client::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            reset_config,
            explain_query,
            get_dashboard,
            snooze,
            wake
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn beside(data: &Path, overridden_by: &str, name: &str) -> PathBuf {
    std::env::var(overridden_by).map_or_else(|_| data.join(name), PathBuf::from)
}

/// macOS names an app's directory after its identifier, so the app answered to
/// Crow's Eye when it wrote the sections and snoozes a user already has. Copies
/// them across, leaving the originals to whatever still reads them.
fn inherit_from_crows_eye(data: &Path) -> std::io::Result<()> {
    let previous = data.with_file_name("dev.tylershunt.crows-eye");
    if !previous.is_dir() {
        return Ok(());
    }

    std::fs::create_dir_all(data)?;
    carry(&previous, data, &["config.json"])?;
    carry(&previous, data, &["snoozes.db", "snoozes.db-wal", "snoozes.db-shm"])
}

/// Copies `files` from `previous` to `data` only when the first of them is
/// missing there, so a database and its write-ahead log arrive as one or not at
/// all, and so a file the user has since edited is never overwritten.
fn carry(previous: &Path, data: &Path, files: &[&str]) -> std::io::Result<()> {
    if data.join(files[0]).exists() {
        return Ok(());
    }

    for name in files {
        if previous.join(name).exists() {
            std::fs::copy(previous.join(name), data.join(name))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directories(named: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("crows-foot-{named}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let previous = root.join("dev.tylershunt.crows-eye");
        std::fs::create_dir_all(&previous).unwrap();
        std::fs::write(previous.join("config.json"), "{}").unwrap();
        std::fs::write(previous.join("snoozes.db"), "sqlite").unwrap();
        (previous, root.join("dev.tylershunt.crows-foot"))
    }

    #[test]
    fn the_renamed_app_starts_with_what_the_old_one_stored() {
        let (_, data) = directories("inherits");

        inherit_from_crows_eye(&data).unwrap();

        assert_eq!(std::fs::read_to_string(data.join("config.json")).unwrap(), "{}");
        assert_eq!(std::fs::read_to_string(data.join("snoozes.db")).unwrap(), "sqlite");
    }

    #[test]
    fn what_the_renamed_app_has_already_written_stands() {
        let (_, data) = directories("keeps");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("config.json"), "mine").unwrap();

        inherit_from_crows_eye(&data).unwrap();

        assert_eq!(std::fs::read_to_string(data.join("config.json")).unwrap(), "mine");
    }
}
