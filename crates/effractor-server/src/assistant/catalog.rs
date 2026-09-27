//! The tools a turn offers the model (chat spec §6.1), from the catalog the
//! page shares.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Read,
    View,
    Edit,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Tool {
    pub name: String,
    pub access: Access,
    pub description: String,
    pub schema: serde_json::Value,
}

/// A description for all profiles, or one per profile.
#[derive(Deserialize)]
#[serde(untagged)]
enum Description {
    All(String),
    Each(std::collections::HashMap<String, String>),
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    profiles: Vec<String>,
    access: Access,
    description: Description,
    schema: serde_json::Value,
}

static CATALOG: std::sync::LazyLock<Vec<Entry>> = std::sync::LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../../assets/js/assistant/tools.json"))
        .expect("tools.json is part of the build and read by the tests")
});

/// The tools of `profile`; without `edit`, only those that read or change
/// what is shown (a Viewer's turn).
pub fn tools(profile: &str, edit: bool) -> Vec<Tool> {
    CATALOG
        .iter()
        .filter(|e| e.profiles.iter().any(|p| p == profile))
        .filter(|e| edit || e.access != Access::Edit)
        .map(|e| Tool {
            name: e.name.clone(),
            access: e.access,
            description: match &e.description {
                Description::All(d) => d.clone(),
                Description::Each(m) => m.get(profile).cloned().unwrap_or_default(),
            },
            schema: e.schema.clone(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_viewer_gets_no_edit_tools_and_an_editor_gets_all() {
        let viewer = tools("architecture", false);
        assert!(viewer.iter().all(|t| t.access != Access::Edit));
        assert!(viewer.iter().any(|t| t.name == "set_view"));
        let editor = tools("architecture", true);
        assert!(editor.iter().any(|t| t.name == "add_entity"));
        assert!(editor.len() > viewer.len());
    }

    #[test]
    fn each_profile_gets_its_own_tools_and_descriptions() {
        let ft = tools("fault-tree", true);
        assert!(ft.iter().any(|t| t.name == "add_node"));
        assert!(!ft.iter().any(|t| t.name == "add_entity"));
        let set_node = ft.iter().find(|t| t.name == "set_node").unwrap();
        assert!(set_node.description.contains("probability"));
        let at = tools("attack-tree", true);
        assert!(
            at.iter()
                .find(|t| t.name == "set_node")
                .unwrap()
                .description
                .contains("attacker time")
        );
    }

    /// The strictest providers (Moonshot's "flavored" schema) want one
    /// `type` on every node, and unions as `anyOf` of typed children.
    fn strict(path: &str, v: &serde_json::Value) -> Result<(), String> {
        let o = v.as_object().ok_or(format!("{path}: not an object"))?;
        match (o.get("type"), o.get("anyOf")) {
            (Some(t), None) if t.is_string() => {}
            (None, Some(any)) => {
                for (i, child) in any
                    .as_array()
                    .ok_or(format!("{path}: anyOf"))?
                    .iter()
                    .enumerate()
                {
                    strict(&format!("{path}.anyOf[{i}]"), child)?;
                }
            }
            _ => {
                return Err(format!(
                    "{path}: one string `type`, or an anyOf without one"
                ));
            }
        }
        for (k, child) in o
            .get("properties")
            .and_then(|p| p.as_object())
            .into_iter()
            .flatten()
        {
            strict(&format!("{path}.{k}"), child)?;
        }
        if let Some(items) = o.get("items") {
            strict(&format!("{path}[]"), items)?;
        }
        if let Some(extra) = o.get("additionalProperties").filter(|a| a.is_object()) {
            strict(&format!("{path}{{}}"), extra)?;
        }
        Ok(())
    }

    #[test]
    fn every_schema_is_typed_the_way_the_strictest_provider_reads_it() {
        for p in ["fault-tree", "attack-tree", "architecture"] {
            for t in tools(p, true) {
                if let Err(why) = strict(&t.name, &t.schema) {
                    panic!("{p}: {why}");
                }
            }
        }
    }

    #[test]
    fn names_are_unique_within_a_profile() {
        for p in ["fault-tree", "attack-tree", "architecture"] {
            let mut names: Vec<_> = tools(p, true).into_iter().map(|t| t.name).collect();
            let n = names.len();
            names.sort();
            names.dedup();
            assert_eq!(names.len(), n, "{p}");
        }
    }
}
