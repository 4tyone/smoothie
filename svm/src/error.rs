use std::process::ExitCode;
use thiserror::Error;

/// Exit codes per CLI contracts
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitStatus {
    /// Command completed successfully
    Success = 0,
    /// Unexpected error occurred
    GeneralError = 1,
    /// No .smoothie/ directory at path
    IndexNotFound = 2,
    /// Requested file not in index
    FileNotFound = 3,
    /// Malformed arguments or options
    InvalidArguments = 4,
}

impl From<ExitStatus> for ExitCode {
    fn from(status: ExitStatus) -> Self {
        ExitCode::from(status as u8)
    }
}

/// Application errors with automatic exit code mapping
#[derive(Error, Debug)]
pub enum SmoothieError {
    #[error("Index not found at {0}")]
    IndexNotFound(String),

    #[error("File not found in index: {0}")]
    FileNotFound(String),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),

    #[error("Invalid line reference: {0}")]
    InvalidLineRef(String),

    #[error("Invalid TOC format: {0}")]
    InvalidTocFormat(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("TOML parse error: {0}")]
    TomlParse(#[from] toml::de::Error),

    #[error("Git error: {0}")]
    Git(String),

    #[error("Glob pattern error: {0}")]
    GlobPattern(#[from] glob::PatternError),

    #[error("Glob error: {0}")]
    Glob(#[from] glob::GlobError),

    #[error("Commit not found: {0}")]
    CommitNotFound(String),

    #[error("BC is invalid: {0} provenance-guarantee violation(s)")]
    BcInvalid(usize),

    #[error("{0}")]
    General(String),
}

impl SmoothieError {
    pub fn exit_status(&self) -> ExitStatus {
        match self {
            SmoothieError::IndexNotFound(_) => ExitStatus::IndexNotFound,
            SmoothieError::FileNotFound(_) => ExitStatus::FileNotFound,
            SmoothieError::InvalidArgument(_) => ExitStatus::InvalidArguments,
            SmoothieError::InvalidLineRef(_) => ExitStatus::InvalidArguments,
            SmoothieError::InvalidTocFormat(_) => ExitStatus::InvalidArguments,
            SmoothieError::CommitNotFound(_) => ExitStatus::FileNotFound,
            _ => ExitStatus::GeneralError,
        }
    }
}

pub type Result<T> = std::result::Result<T, SmoothieError>;
