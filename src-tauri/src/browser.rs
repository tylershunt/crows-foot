//! Hands pull request links to the system browser.

use crate::error::{AppError, Result};
use std::process::Command;

const GITHUB: &str = "https://github.com/";

/// Opens every URL in the default browser as its own tab, in the order given.
///
/// The URLs go to the browser in one hand-off. Separate hand-offs race each
/// other, and the browser can drop or reorder the first while it comes to the
/// front.
pub fn open_all(urls: &[String]) -> Result<()> {
    if urls.is_empty() {
        return Ok(());
    }
    let status = Command::new("/usr/bin/open").args(github_links(urls)?).status()?;
    if status.success() {
        Ok(())
    } else {
        Err(AppError::new(format!("The browser did not open the pull requests ({status}).")))
    }
}

/// `urls` unchanged when every one is a GitHub page, the only links the app opens.
fn github_links(urls: &[String]) -> Result<&[String]> {
    match urls.iter().find(|url| !url.starts_with(GITHUB)) {
        Some(url) => Err(AppError::new(format!("Refused to open {url}: only GitHub links open."))),
        None => Ok(urls),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_links_are_passed_on_in_order() {
        let urls = vec!["https://github.com/o/r/pull/2".to_string(), "https://github.com/o/r/pull/1".to_string()];
        assert_eq!(github_links(&urls).unwrap(), urls.as_slice());
    }

    #[test]
    fn a_link_off_github_refuses_the_whole_batch() {
        let urls = vec!["https://github.com/o/r/pull/1".to_string(), "file:///etc/passwd".to_string()];
        assert!(github_links(&urls).is_err());
    }

    #[test]
    fn a_lookalike_host_is_not_github() {
        let urls = vec!["https://github.com.evil.example/o/r/pull/1".to_string()];
        assert!(github_links(&urls).is_err());
    }
}
