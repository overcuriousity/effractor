#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Code {
    // What only a text can get wrong; `effractor-format` reports these.
    Syntax,
    Unsupported,
    Version,
    UnknownKey,
    MissingKey,
    DuplicateKey,
    MisplacedKey,
    WrongType,
    InvalidId,
    Expression,
    // What a model can get wrong; `validate` reports these.
    UnknownTop,
    UnknownChild,
    UnknownAsset,
    UnknownEffectNode,
    Cycle,
    EmptyGate,
    DuplicateChild,
    VoteRange,
    ParamDomain,
    DistributionRole,
    FractionRange,
    NoMagnitude,
    EffectOnGate,
    OverlappingEffects,
    Unreachable,
    ProfileAttribute,
    // What an architecture can get wrong; `validate_architecture` reports these.
    Incomplete,
    UnknownReference,
    AssociationType,
    Cardinality,
    InvalidRoute,
    UnknownState,
    UnknownLibrary,
    ConflictingChange,
    Limit,
}

impl Code {
    /// Stable, kebab-case: what a UI or a results file refers to.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Syntax => "syntax",
            Self::Unsupported => "unsupported",
            Self::Version => "version",
            Self::UnknownKey => "unknown-key",
            Self::MissingKey => "missing-key",
            Self::DuplicateKey => "duplicate-key",
            Self::MisplacedKey => "misplaced-key",
            Self::WrongType => "wrong-type",
            Self::InvalidId => "invalid-id",
            Self::Expression => "expression",
            Self::UnknownTop => "unknown-top",
            Self::UnknownChild => "unknown-child",
            Self::UnknownAsset => "unknown-asset",
            Self::UnknownEffectNode => "unknown-effect-node",
            Self::Cycle => "cycle",
            Self::EmptyGate => "empty-gate",
            Self::DuplicateChild => "duplicate-child",
            Self::VoteRange => "vote-range",
            Self::ParamDomain => "param-domain",
            Self::DistributionRole => "distribution-role",
            Self::FractionRange => "fraction-range",
            Self::NoMagnitude => "no-magnitude",
            Self::EffectOnGate => "effect-on-gate",
            Self::OverlappingEffects => "overlapping-effects",
            Self::Unreachable => "unreachable",
            Self::ProfileAttribute => "profile-attribute",
            Self::Incomplete => "incomplete",
            Self::UnknownReference => "unknown-reference",
            Self::AssociationType => "association-type",
            Self::Cardinality => "cardinality",
            Self::InvalidRoute => "invalid-route",
            Self::UnknownState => "unknown-state",
            Self::UnknownLibrary => "unknown-library",
            Self::ConflictingChange => "conflicting-change",
            Self::Limit => "limit",
        }
    }
}

/// 1-based position in a source document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pos {
    pub line: usize,
    pub col: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    pub severity: Severity,
    pub code: Code,
    pub message: String,
    /// Where in the document, as a key path: `nodes.top.children[2]`.
    pub path: String,
    /// The model has no source text. Whoever parsed one resolves `path` to a
    /// position; until then this is `None`.
    pub pos: Option<Pos>,
}

impl Diagnostic {
    pub fn error(code: Code, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            code,
            message: message.into(),
            path: path.into(),
            pos: None,
        }
    }

    pub fn warning(code: Code, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            ..Self::error(code, path, message)
        }
    }
}
