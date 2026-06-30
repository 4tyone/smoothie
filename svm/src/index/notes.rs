use crate::error::{SmoothieError, Result};
use crate::index::schema::Index;

impl Index {
    /// Get a note by key
    pub fn get_note(&self, key: &str) -> Result<&String> {
        self.notes
            .get(key)
            .ok_or_else(|| SmoothieError::FileNotFound(format!("Note '{}' not found", key)))
    }

    /// Add or update a note
    pub fn set_note(&mut self, key: String, value: String) {
        self.notes.insert(key, value);
    }

    /// Get all note keys
    pub fn get_all_note_keys(&self) -> Vec<&String> {
        let mut keys: Vec<_> = self.notes.keys().collect();
        keys.sort();
        keys
    }
}
