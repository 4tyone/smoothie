//! Unit tests for range overlap merging (User Story 4)
//!
//! Tests verify:
//! - T042: Range overlap merging logic

use smoothie::LineRef;

/// T042: Test parse single line reference
#[test]
fn test_parse_single_line() {
    let line_ref = LineRef::parse("file.md:42").unwrap();
    assert_eq!(line_ref.file, "file.md");
    assert_eq!(line_ref.start, 42);
    assert_eq!(line_ref.end, 42);
}

/// T042: Test parse range reference
#[test]
fn test_parse_range() {
    let line_ref = LineRef::parse("path/to/file.md:10-50").unwrap();
    assert_eq!(line_ref.file, "path/to/file.md");
    assert_eq!(line_ref.start, 10);
    assert_eq!(line_ref.end, 50);
}

/// T042: Test parse invalid format - missing colon
#[test]
fn test_parse_invalid_no_colon() {
    let result = LineRef::parse("file.md");
    assert!(result.is_err());
}

/// T042: Test parse invalid format - non-numeric line
#[test]
fn test_parse_invalid_non_numeric() {
    let result = LineRef::parse("file.md:abc");
    assert!(result.is_err());
}

/// T042: Test parse invalid format - reversed range
#[test]
fn test_parse_invalid_reversed_range() {
    let result = LineRef::parse("file.md:50-10");
    assert!(result.is_err());
}

/// T042: Test parse invalid format - zero line
#[test]
fn test_parse_invalid_zero_line() {
    let result = LineRef::parse("file.md:0");
    assert!(result.is_err());
}

/// T042: Test overlap calculation - complete overlap
#[test]
fn test_overlap_complete() {
    let ref1 = LineRef::parse("file.md:10-20").unwrap();
    let ref2 = LineRef::parse("file.md:10-20").unwrap();
    let overlap = ref1.overlap_with(&ref2);
    assert!((overlap - 1.0).abs() < 0.01, "Complete overlap should be 1.0");
}

/// T042: Test overlap calculation - no overlap
#[test]
fn test_overlap_none() {
    let ref1 = LineRef::parse("file.md:10-20").unwrap();
    let ref2 = LineRef::parse("file.md:30-40").unwrap();
    let overlap = ref1.overlap_with(&ref2);
    assert!((overlap - 0.0).abs() < 0.01, "No overlap should be 0.0");
}

/// T042: Test overlap calculation - partial overlap
#[test]
fn test_overlap_partial() {
    let ref1 = LineRef::parse("file.md:10-20").unwrap(); // 11 lines
    let ref2 = LineRef::parse("file.md:15-25").unwrap(); // 11 lines
    let overlap = ref1.overlap_with(&ref2);
    // Overlap is lines 15-20 = 6 lines
    // Overlap percentage = 6 / 11 ≈ 0.545
    assert!(overlap > 0.5 && overlap < 0.6, "Partial overlap should be ~0.54, got {}", overlap);
}

/// T042: Test overlap calculation - different files
#[test]
fn test_overlap_different_files() {
    let ref1 = LineRef::parse("file1.md:10-20").unwrap();
    let ref2 = LineRef::parse("file2.md:10-20").unwrap();
    let overlap = ref1.overlap_with(&ref2);
    assert!((overlap - 0.0).abs() < 0.01, "Different files should have 0 overlap");
}

/// T042: Test merge ranges - full overlap
#[test]
fn test_merge_full_overlap() {
    let ref1 = LineRef::parse("file.md:10-20").unwrap();
    let ref2 = LineRef::parse("file.md:10-20").unwrap();
    let merged = ref1.merge_with(&ref2);
    assert_eq!(merged.start, 10);
    assert_eq!(merged.end, 20);
}

/// T042: Test merge ranges - partial overlap
#[test]
fn test_merge_partial_overlap() {
    let ref1 = LineRef::parse("file.md:10-20").unwrap();
    let ref2 = LineRef::parse("file.md:15-30").unwrap();
    let merged = ref1.merge_with(&ref2);
    assert_eq!(merged.start, 10);
    assert_eq!(merged.end, 30);
    assert_eq!(merged.file, "file.md");
}

/// T042: Test merge ranges - one contains other
#[test]
fn test_merge_containment() {
    let ref1 = LineRef::parse("file.md:10-50").unwrap();
    let ref2 = LineRef::parse("file.md:20-30").unwrap();
    let merged = ref1.merge_with(&ref2);
    assert_eq!(merged.start, 10);
    assert_eq!(merged.end, 50);
}

/// T042: Test merge ranges - adjacent
#[test]
fn test_merge_adjacent() {
    let ref1 = LineRef::parse("file.md:10-20").unwrap();
    let ref2 = LineRef::parse("file.md:21-30").unwrap();
    let merged = ref1.merge_with(&ref2);
    assert_eq!(merged.start, 10);
    assert_eq!(merged.end, 30);
}

/// T042: Test LineRef to_string (single line)
#[test]
fn test_line_ref_to_string_single() {
    let line_ref = LineRef {
        file: "file.md".to_string(),
        start: 42,
        end: 42,
    };
    assert_eq!(line_ref.to_string(), "file.md:42");
}

/// T042: Test LineRef to_string (range)
#[test]
fn test_line_ref_to_string_range() {
    let line_ref = LineRef {
        file: "path/file.md".to_string(),
        start: 10,
        end: 50,
    };
    assert_eq!(line_ref.to_string(), "path/file.md:10-50");
}

/// T042: Test LineRef size calculation
#[test]
fn test_line_ref_size() {
    let single = LineRef::parse("file.md:42").unwrap();
    assert_eq!(single.size(), 1);

    let range = LineRef::parse("file.md:10-20").unwrap();
    assert_eq!(range.size(), 11); // 10, 11, 12, ..., 20 = 11 lines
}
