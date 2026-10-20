//! The Corvic API key, held in the macOS Keychain.

use crate::error::{AppError, Result};

const SERVICE: &str = "dev.tylershunt.crows-foot.llm";
const ACCOUNT: &str = "corvic";

fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(keychain_error)
}

pub fn store_key(key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::new("The API key is empty."));
    }
    entry()?.set_password(key).map_err(keychain_error)
}

pub fn forget_key() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(error)),
    }
}

pub fn has_key() -> Result<bool> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(keychain_error(error)),
    }
}

pub(super) fn key() -> Result<String> {
    match entry()?.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => Err(AppError::new("Add a Corvic API key in Settings first.")),
        Err(error) => Err(keychain_error(error)),
    }
}

fn keychain_error(error: keyring::Error) -> AppError {
    AppError::new(format!("The Keychain refused the Corvic API key: {error}"))
}
