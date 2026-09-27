mod fixture;
use effractor_accounts::assistant::{self, Claim, Grantee};
use fixture::*;

#[test]
fn a_user_is_allowed_by_their_own_grant_or_a_groups() {
    let (_d, db) = db();
    let (ann, bob) = (user(&db, "ann"), user(&db, "bob"));
    let g = group(&db, "lab", &[bob]);
    db.read(|c| {
        assert!(!assistant::allowed(c, ann)?);
        assert!(!assistant::allowed(c, bob)?);
        Ok(())
    })
    .unwrap();
    db.write(|t| {
        assistant::grant(t, Grantee::User(ann), ann, 1)?;
        assistant::grant(t, Grantee::Group(g), ann, 1)
    })
    .unwrap();
    db.read(|c| {
        assert!(assistant::allowed(c, ann)?);
        assert!(assistant::allowed(c, bob)?);
        Ok(())
    })
    .unwrap();
    // Granting twice changes nothing.
    db.write(|t| assistant::grant(t, Grantee::User(ann), ann, 2))
        .unwrap();
    assert_eq!(db.read(assistant::grants).unwrap().len(), 2);
    db.write(|t| assistant::revoke(t, Grantee::Group(g)))
        .unwrap();
    db.read(|c| {
        assert!(!assistant::allowed(c, bob)?);
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_grant_to_nobody_is_not_found() {
    let (_d, db) = db();
    let ann = user(&db, "ann");
    assert!(matches!(
        db.write(|t| assistant::grant(t, Grantee::User(9999), ann, 1)),
        Err(effractor_accounts::Error::NotFound)
    ));
}

#[test]
fn a_disabled_user_is_never_allowed() {
    let (_d, db) = db();
    let ann = user(&db, "ann");
    db.write(|t| assistant::grant(t, Grantee::User(ann), ann, 1))
        .unwrap();
    db.write(|t| effractor_accounts::users::set_disabled(t, ann, true))
        .unwrap();
    db.read(|c| {
        assert!(!assistant::allowed(c, ann)?);
        Ok(())
    })
    .unwrap();
}

#[test]
fn settings_are_stored_and_cleared() {
    let (_d, db) = db();
    let ann = user(&db, "ann");
    db.write(|t| assistant::set_setting(t, "assistant.model", Some("m"), ann, 1))
        .unwrap();
    assert_eq!(
        db.read(|c| assistant::setting(c, "assistant.model"))
            .unwrap()
            .as_deref(),
        Some("m")
    );
    db.write(|t| assistant::set_setting(t, "assistant.model", None, ann, 2))
        .unwrap();
    assert_eq!(
        db.read(|c| assistant::setting(c, "assistant.model"))
            .unwrap(),
        None
    );
}

#[test]
fn one_turn_at_a_time_and_a_stale_turn_is_released() {
    let (_d, db) = db();
    let (ann, bob) = (user(&db, "ann"), user(&db, "bob"));
    let d = doc(&db, ann, None, "Lab");
    let s = db
        .write(|t| assistant::create_session(t, d, "architecture", ann, 10))
        .unwrap();
    let first = db
        .write(|t| assistant::claim(t, s, ann, "edit", 10, 100, false))
        .unwrap();
    assert!(matches!(
        first,
        Claim::Claimed {
            turn: 1,
            released_stale: false
        }
    ));
    let busy = db
        .write(|t| assistant::claim(t, s, bob, "read", 50, 100, false))
        .unwrap();
    assert!(matches!(busy, Claim::Busy { ref by } if by == "ann"));
    let late = db
        .write(|t| assistant::claim(t, s, bob, "read", 200, 100, false))
        .unwrap();
    assert!(matches!(
        late,
        Claim::Claimed {
            turn: 2,
            released_stale: true
        }
    ));
    let turn = db.read(|c| assistant::turn(c, s)).unwrap().unwrap();
    assert_eq!(
        (turn.by, turn.access.as_str(), turn.steps),
        (bob, "read", 0)
    );
    assert_eq!(db.write(|t| assistant::bump_steps(t, s, 250)).unwrap(), 1);
    db.write(|t| assistant::release(t, s)).unwrap();
    assert!(db.read(|c| assistant::turn(c, s)).unwrap().is_none());
}

#[test]
fn each_step_refreshes_the_turn_and_its_asker_may_take_it_over() {
    let (_d, db) = db();
    let (ann, bob) = (user(&db, "ann"), user(&db, "bob"));
    let d = doc(&db, ann, None, "Lab");
    let s = db
        .write(|t| assistant::create_session(t, d, "architecture", ann, 10))
        .unwrap();
    db.write(|t| assistant::claim(t, s, ann, "edit", 10, 100, false))
        .unwrap();
    db.write(|t| assistant::bump_steps(t, s, 90)).unwrap();
    assert_eq!(
        db.read(|c| assistant::turn(c, s)).unwrap().unwrap().since,
        90
    );
    db.write(|t| assistant::touch(t, s, 95)).unwrap();
    assert_eq!(
        db.read(|c| assistant::turn(c, s)).unwrap().unwrap().since,
        95
    );
    // Young: another is told who is asking even when taking over is allowed;
    // the asker takes it over.
    let other = db
        .write(|t| assistant::claim(t, s, bob, "edit", 150, 100, true))
        .unwrap();
    assert!(matches!(other, Claim::Busy { .. }));
    let own = db
        .write(|t| assistant::claim(t, s, ann, "edit", 150, 100, true))
        .unwrap();
    assert!(matches!(own, Claim::Claimed { turn: 2, .. }));
}

#[test]
fn messages_keep_their_order_author_and_reported_tokens() {
    let (_d, db) = db();
    let ann = user(&db, "ann");
    let d = doc(&db, ann, None, "T");
    let s = db
        .write(|t| assistant::create_session(t, d, "fault-tree", ann, 1))
        .unwrap();
    db.write(|t| {
        assistant::append(
            t,
            s,
            1,
            "user",
            Some(ann),
            r#"[{"type":"text","text":"hi"}]"#,
            None,
            1,
        )?;
        assistant::append(
            t,
            s,
            1,
            "assistant",
            None,
            r#"[{"type":"text","text":"yo"}]"#,
            Some((12, 3)),
            2,
        )
    })
    .unwrap();
    let m = db.read(|c| assistant::messages(c, s)).unwrap();
    assert_eq!(m.len(), 2);
    assert_eq!(
        (m[0].seq, m[0].author.as_deref(), m[0].input_tokens),
        (1, Some("ann"), None)
    );
    assert_eq!(
        (m[1].seq, m[1].role.as_str(), m[1].output_tokens),
        (2, "assistant", Some(3))
    );
}

#[test]
fn a_deleted_session_leaves_the_list_and_comes_back() {
    let (_d, db) = db();
    let ann = user(&db, "ann");
    let d = doc(&db, ann, None, "A");
    let s = db
        .write(|t| assistant::create_session(t, d, "attack-tree", ann, 1))
        .unwrap();
    db.write(|t| assistant::rename_session(t, s, "Phishing"))
        .unwrap();
    db.write(|t| assistant::delete_session(t, s, 5)).unwrap();
    assert!(db.read(|c| assistant::sessions(c, d)).unwrap().is_empty());
    db.write(|t| assistant::restore_session(t, s)).unwrap();
    let list = db.read(|c| assistant::sessions(c, d)).unwrap();
    assert_eq!(
        (list[0].title.as_str(), list[0].created_by_name.as_str()),
        ("Phishing", "ann")
    );
}

#[test]
fn usage_sums_what_was_reported_and_counts_what_was_not() {
    let (_d, db) = db();
    let ann = user(&db, "ann");
    db.write(|t| {
        assistant::record_usage(t, ann, None, Some(100), Some(20), 10)?;
        assistant::record_usage(t, ann, None, None, None, 5)
    })
    .unwrap();
    assert_eq!(db.read(|c| assistant::used_since(c, ann, 8)).unwrap(), 120);
    let rows = db.read(|c| assistant::usage(c, 0)).unwrap();
    assert_eq!(
        (
            rows[0].requests,
            rows[0].input,
            rows[0].output,
            rows[0].unreported
        ),
        (2, 100, 20, 1)
    );
}
