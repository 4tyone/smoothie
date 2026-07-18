use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

mod cache;
mod cli;
mod credentials;
mod error;
mod index;
mod ontology;
mod storage;

use cli::{
    cache as cache_cmd, feedback, glossary, history, hit, init, node, notes,
    ontology as ontology_cmd, rollback, skill, sync, validate, write,
};

#[derive(Parser)]
#[command(name = "svm")]
#[command(author, version, about = "SVM — the deterministic Smoothie runtime that reads an ontology.v1 ontology", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate an ontology against ontology.v1 and the gates G1-G7 (spec 01 §8)
    Validate {
        /// Path to the ontology.json file
        ontology_path: PathBuf,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Query a typed ontology (spec 06) — the ontology reader's primary surface
    Ontology {
        #[command(subcommand)]
        command: OntologyCommands,
    },

    /// Record consumer-to-producer feedback (spec 08 §5) — gated on the next build
    Feedback {
        #[command(subcommand)]
        command: FeedbackCommands,
    },

    /// Print or install the SVM skill (SKILL.md)
    Skill {
        /// Install SKILL.md into this directory instead of printing it
        #[arg(long)]
        install: Option<PathBuf>,
    },

    /// Initialize a metadata index from a corpus directory
    Init {
        /// Path to directory containing documents
        corpus_path: PathBuf,

        /// Glob pattern for files to index
        #[arg(long, default_value = "**/*.md")]
        pattern: String,

        /// Patterns to ignore (comma-separated)
        #[arg(long, default_value = ".git,node_modules,.smoothie")]
        ignore: String,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Get metadata for a specific file
    Node {
        /// File path relative to corpus root
        file: String,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// View hot content (most frequently accessed)
    Cache {
        /// Number of entries to show
        #[arg(short = 'n', long, default_value = "20")]
        limit: usize,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Record a content access
    Hit {
        /// File with line reference (file.md:line or file.md:start-end)
        #[arg(name = "ref")]
        reference: String,

        /// Brief description of what this content is about
        description: String,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Write enrichment metadata
    Write {
        #[command(subcommand)]
        command: WriteCommands,
    },

    /// Synchronize index with corpus changes
    Sync {
        /// Show changes without applying
        #[arg(long)]
        dry_run: bool,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Show enrichment history
    History {
        /// Number of commits to show
        #[arg(short = 'n', long, default_value = "20")]
        limit: usize,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Revert index to a previous state
    Rollback {
        /// Commit hash to rollback to
        commit: String,

        /// Show what would be reverted
        #[arg(long)]
        dry_run: bool,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// View glossary or look up a term
    Glossary {
        /// Specific term to look up (omit for all)
        term: Option<String>,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// View notes or look up a specific note
    Notes {
        /// Specific key to look up (omit for all)
        key: Option<String>,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },
}

/// A `--ont` path + `--json` shared by ontology subcommands.
#[derive(clap::Args)]
struct OntOpts {
    /// Path to the ontology (default: discover .smoothie/ontology.json)
    #[arg(long)]
    ont: Option<PathBuf>,
    /// Output as JSON
    #[arg(long)]
    json: bool,
}

#[derive(Subcommand)]
enum OntologyCommands {
    /// List entity types with their entity counts
    Types {
        #[command(flatten)]
        opts: OntOpts,
    },
    /// List entities, optionally filtered by type (id or name) or interface (§10)
    Entities {
        #[arg(long = "type")]
        type_filter: Option<String>,
        #[arg(long = "interface")]
        interface_filter: Option<String>,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// List interfaces and the entity types that implement them (§10)
    Interfaces {
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Get an entity with its grounded properties, aliases, and receipts (resolution
    /// union applied; restricted values withheld unless --reveal)
    Entity {
        id: String,
        /// Authorize reading restricted values (spec 06 §6)
        #[arg(long)]
        reveal: bool,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// The facts grounding an entity, with receipts
    Facts {
        id: String,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Links touching an entity, with receipts
    Links {
        id: String,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Bounded traversal from an entity over typed links
    Traverse {
        from: String,
        #[arg(long, default_value = "3")]
        depth: usize,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// The resolution role of an entity (canonical / member / independent)
    Resolve {
        id: String,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Search entities by label or alias (case-insensitive)
    Search {
        term: String,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Surface gaps (orphan entities and notes)
    Gaps {
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Summarize the ontology (manifest, version, counts)
    Show {
        #[command(flatten)]
        opts: OntOpts,
    },
    /// List logic units (the verb layer, spec 10)
    LogicUnits {
        #[command(flatten)]
        opts: OntOpts,
    },
    /// The conformance report — de jure vs de facto vs espoused per step (spec 10 §2)
    Conformance {
        #[arg(long = "logic-unit")]
        logic_unit: Option<String>,
        #[command(flatten)]
        opts: OntOpts,
    },
    /// Drift of each executable logic unit from its promoted baseline (spec 10 §6)
    Drift {
        #[command(flatten)]
        opts: OntOpts,
    },
}

#[derive(Subcommand)]
enum FeedbackCommands {
    /// Record an observation (never auto-applied)
    Note { target: String, text: String },
    /// A structured improvement ask (split / re-describe / retype)
    Request { target: String, kind: String, detail: String },
    /// Ask the producer to research whether two entities connect
    LinkResearch {
        a: String,
        b: String,
        #[arg(long)]
        why: Option<String>,
    },
    /// Propose an entity resolution (runs through the spec-04 gate on the next build)
    ProposeMerge {
        a: String,
        b: String,
        #[arg(long)]
        why: Option<String>,
    },
    /// Contest an existing resolution
    DisputeMerge { resolution_id: String },
    /// Propose a missing typed link (enters as guessed/consumer; must satisfy G1/G3)
    AddLink {
        from: String,
        to: String,
        #[arg(long = "type")]
        link_type: String,
        #[arg(long)]
        why: String,
        /// Cited evidence fact ids (repeatable) — required to ground the link
        #[arg(long = "fact")]
        facts: Vec<String>,
    },
}

#[derive(Subcommand)]
enum WriteCommands {
    /// Write a summary for a file
    Summary {
        /// File path relative to corpus root
        file: String,
        /// Summary text
        summary: String,
    },

    /// Write table of contents for a file
    Toc {
        /// File path relative to corpus root
        file: String,
        /// TOC entries, one per line: depth:line:title
        toc: String,
    },

    /// Write an edge (relationship) between files
    Edge {
        /// Source file:lines reference
        source_ref: String,
        /// Target file:lines reference
        target_ref: String,
        /// Description of relationship
        relation: String,
    },

    /// Add a keyword to a file
    Keyword {
        /// File path relative to corpus root
        file: String,
        /// Keyword to add
        keyword: String,
    },

    /// Add or update a glossary term
    Glossary {
        /// The glossary term
        term: String,
        /// Definition of the term
        definition: String,
        /// Comma-separated file:lines references
        #[arg(long)]
        refs: String,
    },

    /// Add or update a note
    Note {
        /// Note key
        key: String,
        /// Note value
        value: String,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Validate { ontology_path, json } => validate::run(&ontology_path, json),

        Commands::Ontology { command } => match command {
            OntologyCommands::Types { opts } => ontology_cmd::types(opts.ont.as_deref(), opts.json),
            OntologyCommands::Entities { type_filter, interface_filter, opts } => {
                ontology_cmd::entities(opts.ont.as_deref(), type_filter.as_deref(), interface_filter.as_deref(), opts.json)
            }
            OntologyCommands::Interfaces { opts } => ontology_cmd::interfaces(opts.ont.as_deref(), opts.json),
            OntologyCommands::Entity { id, reveal, opts } => {
                ontology_cmd::entity(opts.ont.as_deref(), &id, reveal, opts.json)
            }
            OntologyCommands::Facts { id, opts } => ontology_cmd::facts(opts.ont.as_deref(), &id, opts.json),
            OntologyCommands::Links { id, opts } => ontology_cmd::links(opts.ont.as_deref(), &id, opts.json),
            OntologyCommands::Traverse { from, depth, opts } => {
                ontology_cmd::traverse(opts.ont.as_deref(), &from, depth, opts.json)
            }
            OntologyCommands::Resolve { id, opts } => ontology_cmd::resolve(opts.ont.as_deref(), &id, opts.json),
            OntologyCommands::Search { term, opts } => ontology_cmd::search(opts.ont.as_deref(), &term, opts.json),
            OntologyCommands::Gaps { opts } => ontology_cmd::gaps(opts.ont.as_deref(), opts.json),
            OntologyCommands::Show { opts } => ontology_cmd::show(opts.ont.as_deref(), opts.json),
            OntologyCommands::LogicUnits { opts } => ontology_cmd::logic_units(opts.ont.as_deref(), opts.json),
            OntologyCommands::Conformance { logic_unit, opts } => ontology_cmd::conformance(opts.ont.as_deref(), logic_unit.as_deref(), opts.json),
            OntologyCommands::Drift { opts } => ontology_cmd::drift(opts.ont.as_deref(), opts.json),
        },

        Commands::Feedback { command } => match command {
            FeedbackCommands::Note { target, text } => feedback::note(&target, &text),
            FeedbackCommands::Request { target, kind, detail } => feedback::request(&target, &kind, &detail),
            FeedbackCommands::LinkResearch { a, b, why } => feedback::link_research(&a, &b, why.as_deref()),
            FeedbackCommands::ProposeMerge { a, b, why } => feedback::propose_merge(&a, &b, why.as_deref()),
            FeedbackCommands::DisputeMerge { resolution_id } => feedback::dispute_merge(&resolution_id),
            FeedbackCommands::AddLink { from, to, link_type, why, facts } => feedback::add_link(&from, &to, &link_type, &why, &facts),
        },

        Commands::Skill { install } => skill::run(install.as_deref()),

        Commands::Init {
            corpus_path,
            pattern,
            ignore,
            json,
        } => init::run(&corpus_path, &pattern, &ignore, json),

        Commands::Node { file, json } => node::run(&file, json),

        Commands::Cache { limit, json } => cache_cmd::run(limit, json),

        Commands::Hit {
            reference,
            description,
            json,
        } => hit::run(&reference, &description, json),

        Commands::Write { command } => match command {
            WriteCommands::Summary { file, summary } => write::run_summary(&file, &summary),
            WriteCommands::Toc { file, toc } => write::run_toc(&file, &toc),
            WriteCommands::Edge {
                source_ref,
                target_ref,
                relation,
            } => write::run_edge(&source_ref, &target_ref, &relation),
            WriteCommands::Keyword { file, keyword } => write::run_keyword(&file, &keyword),
            WriteCommands::Glossary {
                term,
                definition,
                refs,
            } => write::run_glossary(&term, &definition, &refs),
            WriteCommands::Note { key, value } => write::run_note(&key, &value),
        },

        Commands::Sync { dry_run, json } => sync::run(dry_run, json),

        Commands::History { limit, json } => history::run(limit, json),

        Commands::Rollback {
            commit,
            dry_run,
            json,
        } => rollback::run(&commit, dry_run, json),

        Commands::Glossary { term, json } => glossary::run(term.as_deref(), json),

        Commands::Notes { key, json } => notes::run(key.as_deref(), json),
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {}", e);
            e.exit_status().into()
        }
    }
}
