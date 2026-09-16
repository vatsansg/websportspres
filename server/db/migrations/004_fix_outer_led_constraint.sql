-- Fixes a contradiction in Web BRD Section 3.1 that 003's constraints got wrong.
--
-- The BRD's 7 numbered rules are internally inconsistent taken literally:
--   Rule 2: "Outer LED cannot be selected together with Main LED."
--   Rule 7: "Inner LED, Outer LED, and Main LED can be selected together."
-- Rule 7 explicitly permits a combination (Inner+Outer+Main) that necessarily contains
-- Outer+Main, which rule 2 forbids outright. Section 11.1 corroborates rule 7, not rule 2:
-- "If Inner + Outer are selected (with or without Main LED also enabled), Inner and Outer
-- will be available for Sponsor Ads" - explicitly treating Inner+Outer+Main as a normal,
-- expected configuration.
--
-- Reconciled reading: every rule (1, 3, 4, 5, 6, 7) is satisfied by a single constraint -
-- Outer can never be selected without Inner also being selected. Rule 2 is then read as
-- "Outer+Main without Inner" (still forbidden), not "Outer+Main, period" (which would
-- contradict rule 7). This single rule subsumes all of rules 2-7 at once; Main LED is
-- always independently free to combine with anything. Flagged to the user for
-- confirmation alongside this fix, same as the events/event_tables schema deviation.
ALTER TABLE event_tables DROP CHECK chk_outer_not_with_main;
ALTER TABLE event_tables DROP CHECK chk_outer_not_alone;
ALTER TABLE event_tables ADD CONSTRAINT chk_outer_requires_inner CHECK (NOT (outer_led = 1 AND inner_led = 0));
