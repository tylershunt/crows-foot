//! Provider API keys, held in the macOS Keychain.

use super::Provider;
use crate::error::{AppError, Result};

const SERVICE: &str = "dev.tylershunt.crows-foot.llm";

fn entry(provider: Provider) -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, account(provider)).map_err(|error| keychain_error(provider, error))
}

fn account(provider: Provider) -> &'static str {
    match provider {
        Provider::Anthropic => "anthropic",
        Provider::Openai => "openai",
    }
}

pub fn store_key(provider: Provider, key: &str) -> Result<()> {
    let key = key.trim();
    if key.is_empty() {
        return Err(AppError::new("The API key is empty."));
    }
    entry(provider)?.set_password(key).map_err(|error| keychain_error(provider, error))
}

pub fn forget_key(provider: Provider) -> Result<()> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(provider, error)),
    }
}

pub fn has_key(provider: Provider) -> Result<bool> {
    match entry(provider)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(keychain_error(provider, error)),
    }
}

pub(super) fn key(provider: Provider) -> Result<String> {
    match entry(provider)?.get_password() {
        Ok(key) => Ok(key),
        Err(keyring::Error::NoEntry) => {
            Err(AppError::new(format!("Add an {} API key in Settings first.", provider.name())))
        }
        Err(error) => Err(keychain_error(provider, error)),
    }
}

fn keychain_error(provider: Provider, error: keyring::Error) -> AppError {
    AppError::new(format!("The Keychain refused the {} key: {error}", provider.name()))
}
