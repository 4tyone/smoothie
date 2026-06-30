use crate::error::{SmoothieError, Result};
use crate::index::schema::{GlossaryEntry, Index};

impl Index {
    /// Get a glossary entry by term
    pub fn get_glossary_entry(&self, term: &str) -> Result<&GlossaryEntry> {
        self.glossary.get(term).ok_or_else(|| {
            SmoothieError::FileNotFound(format!("Glossary term '{}' not found", term))
        })
    }

    /// Add or update a glossary entry
    pub fn set_glossary_entry(&mut self, term: String, entry: GlossaryEntry) {
        self.glossary.insert(term, entry);
    }

    /// Get all glossary terms
    pub fn get_all_glossary_terms(&self) -> Vec<&String> {
        let mut terms: Vec<_> = self.glossary.keys().collect();
        terms.sort();
        terms
    }
}
