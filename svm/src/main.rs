use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

mod bc;
mod cache;
mod cli;
mod credentials;
mod emit;
mod error;
mod index;
mod policy;
mod query;
mod storage;

use cli::{
    bc as bc_cmd, cache as cache_cmd, emit as emit_cmd, glossary, history, hit, init, node, notes,
    query as query_cmd, rollback, skill, sync, validate, write,
};

#[derive(Parser)]
#[command(name = "svm")]
#[command(author, version, about = "SVM — the deterministic Smoothie runtime that consumes a bc.v1 BC", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate a BC against the bc.v1 schema and the provenance-guarantee gates
    Validate {
        /// Path to the bc.json file
        bc_path: PathBuf,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Query and traverse a BC — the SVM's primary surface
    Query {
        #[command(subcommand)]
        command: QueryCommands,
    },

    /// Emit a guardrailed runnable slice (web-app profile only)
    Emit {
        /// What to emit: skill | test
        target: String,

        /// Emit a slice for this outline
        #[arg(long)]
        outline: Option<String>,

        /// Emit a slice for these node ids (repeatable)
        #[arg(long = "node")]
        nodes: Vec<String>,

        /// Execution mode baked into the artifact
        #[arg(long, default_value = "dry-run")]
        mode: String,

        /// Directory to write the artifact into
        #[arg(long)]
        out: Option<PathBuf>,

        /// Print the artifact to stdout instead of writing a file
        #[arg(long)]
        stdout: bool,

        /// Path to the BC (default: discover .smoothie/bc.json)
        #[arg(long)]
        bc: Option<PathBuf>,

        /// Output as JSON
        #[arg(long)]
        json: bool,
    },

    /// Manage a versioned BC (init / history / rollback / show) via the storage port
    Bc {
        #[command(subcommand)]
        command: BcCommands,
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

/// A `--bc` path + `--json` shared by query subcommands.
#[derive(clap::Args)]
struct BcOpts {
    /// Path to the BC (default: discover .smoothie/bc.json)
    #[arg(long, global = true)]
    bc: Option<PathBuf>,
    /// Output as JSON
    #[arg(long, global = true)]
    json: bool,
}

#[derive(Subcommand)]
enum QueryCommands {
    /// Get a node with its facts and receipts
    Node {
        id: String,
        /// Authorize reading a restricted node's content (spec 06 · §2 read restriction)
        #[arg(long)]
        reveal: bool,
        #[command(flatten)]
        opts: BcOpts,
    },
    /// Follow edges from/to a node
    Edges {
        id: String,
        /// Filter by edge kind (contains|transition|enables|depends_on|next|related_to)
        #[arg(long)]
        kind: Option<String>,
        /// Direction: out | in | both
        #[arg(long, default_value = "out")]
        direction: String,
        #[command(flatten)]
        opts: BcOpts,
    },
    /// Resolve a view_id to its nodes and observations
    View {
        view_id: String,
        #[command(flatten)]
        opts: BcOpts,
    },
    /// List the scenes of an outline
    Outline {
        outline_id: String,
        #[command(flatten)]
        opts: BcOpts,
    },
    /// List nodes, optionally filtered by fidelity and/or kind
    Nodes {
        /// Filter by fidelity (confirmed|claimed|guessed|absent)
        #[arg(long)]
        fidelity: Option<String>,
        /// Filter by node kind
        #[arg(long)]
        kind: Option<String>,
        #[command(flatten)]
        opts: BcOpts,
    },
    /// Surface gaps (gap:* notes)
    Gaps {
        #[command(flatten)]
        opts: BcOpts,
    },
    /// Bounded breadth-first traversal from a node
    Traverse {
        from: String,
        /// Follow only this edge kind
        #[arg(long)]
        kind: Option<String>,
        /// Maximum hops
        #[arg(long, default_value = "3")]
        depth: usize,
        #[command(flatten)]
        opts: BcOpts,
    },
}

#[derive(Subcommand)]
enum BcCommands {
    /// Initialize a git-versioned BC store from a bc.json
    Init {
        /// Path to the source bc.json
        bc_path: PathBuf,
        /// Store directory (default: a .smoothie/ next to the BC)
        #[arg(long)]
        dir: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Show the BC's revision history
    History {
        /// Store directory (default: discover .smoothie/)
        #[arg(long)]
        dir: Option<PathBuf>,
        #[arg(short = 'n', long, default_value = "20")]
        limit: usize,
        #[arg(long)]
        json: bool,
    },
    /// Roll the BC back to a prior revision
    Rollback {
        revision: String,
        #[arg(long)]
        dir: Option<PathBuf>,
        #[arg(long)]
        json: bool,
    },
    /// Summarize the current BC (manifest, authorship, counts)
    Show {
        #[arg(long)]
        bc: Option<PathBuf>,
        #[arg(long)]
        json: bool,
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
        Commands::Validate { bc_path, json } => validate::run(&bc_path, json),

        Commands::Query { command } => match command {
            QueryCommands::Node { id, reveal, opts } => {
                query_cmd::node(opts.bc.as_deref(), &id, reveal, opts.json)
            }
            QueryCommands::Edges {
                id,
                kind,
                direction,
                opts,
            } => query_cmd::edges(opts.bc.as_deref(), &id, kind.as_deref(), &direction, opts.json),
            QueryCommands::View { view_id, opts } => {
                query_cmd::view(opts.bc.as_deref(), &view_id, opts.json)
            }
            QueryCommands::Outline { outline_id, opts } => {
                query_cmd::outline(opts.bc.as_deref(), &outline_id, opts.json)
            }
            QueryCommands::Nodes {
                fidelity,
                kind,
                opts,
            } => query_cmd::nodes(
                opts.bc.as_deref(),
                fidelity.as_deref(),
                kind.as_deref(),
                opts.json,
            ),
            QueryCommands::Gaps { opts } => query_cmd::gaps(opts.bc.as_deref(), opts.json),
            QueryCommands::Traverse {
                from,
                kind,
                depth,
                opts,
            } => query_cmd::traverse(opts.bc.as_deref(), &from, kind.as_deref(), depth, opts.json),
        },

        Commands::Emit {
            target,
            outline,
            nodes,
            mode,
            out,
            stdout,
            bc,
            json,
        } => emit_cmd::run(
            bc.as_deref(),
            &target,
            outline.as_deref(),
            &nodes,
            &mode,
            out.as_deref(),
            stdout,
            json,
        ),

        Commands::Bc { command } => match command {
            BcCommands::Init { bc_path, dir, json } => {
                bc_cmd::init(&bc_path, dir.as_deref(), json)
            }
            BcCommands::History { dir, limit, json } => {
                bc_cmd::history(dir.as_deref(), limit, json)
            }
            BcCommands::Rollback { revision, dir, json } => {
                bc_cmd::rollback(&revision, dir.as_deref(), json)
            }
            BcCommands::Show { bc, json } => bc_cmd::show(bc.as_deref(), json),
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
