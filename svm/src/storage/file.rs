use fs2::FileExt;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;

use crate::error::{SmoothieError, Result};
use crate::index::schema::Index;

/// Read index.json with file locking
pub fn read_index(smoothie_dir: &Path) -> Result<Index> {
    let index_path = smoothie_dir.join("index.json");

    if !index_path.exists() {
        return Err(SmoothieError::IndexNotFound(
            smoothie_dir.display().to_string(),
        ));
    }

    let file = File::open(&index_path)?;
    file.lock_shared()?; // Block until lock acquired

    let mut contents = String::new();
    let mut reader = std::io::BufReader::new(&file);
    reader.read_to_string(&mut contents)?;

    // Lock released when file drops
    let index: Index = serde_json::from_str(&contents)?;
    Ok(index)
}

/// Write index.json with file locking
pub fn write_index(smoothie_dir: &Path, index: &Index) -> Result<()> {
    let index_path = smoothie_dir.join("index.json");

    let file = File::create(&index_path)?;
    file.lock_exclusive()?; // Block until lock acquired

    let contents = serde_json::to_string_pretty(index)?;
    let mut writer = std::io::BufWriter::new(&file);
    writer.write_all(contents.as_bytes())?;
    writer.flush()?;

    // Lock released when file drops
    Ok(())
}

/// Find .smoothie directory starting from given path
pub fn find_smoothie_dir(start_path: &Path) -> Result<std::path::PathBuf> {
    let mut current = start_path.canonicalize().map_err(|e| {
        SmoothieError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Cannot resolve path '{}': {}", start_path.display(), e),
        ))
    })?;

    loop {
        let smoothie_dir = current.join(".smoothie");
        if smoothie_dir.is_dir() {
            return Ok(smoothie_dir);
        }

        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => {
                return Err(SmoothieError::IndexNotFound(
                    start_path.display().to_string(),
                ));
            }
        }
    }
}

/// Create .smoothie directory structure
pub fn create_smoothie_dir(corpus_path: &Path) -> Result<std::path::PathBuf> {
    let smoothie_dir = corpus_path.join(".smoothie");
    fs::create_dir_all(&smoothie_dir)?;
    Ok(smoothie_dir)
}
