-- The Tribunal — keep the word the judge actually used
--
-- ADDITIVE upgrade. Safe on a live database: it adds one nullable column and
-- destroys nothing. Rows written before it stay NULL and fall back to the
-- stored verdict kind when displayed.
--
-- Why it exists. A charge sheet framed "justified / not justified" is judged in
-- those words: the model returns `justified` or `not_justified`, and
-- normaliseVerdict maps that onto the three kinds Postgres stores. That mapping
-- is right for storage and wrong for display — a judge who wrote "the breach was
-- not justified" was shown as GUILTY, which is the correct kind but not what the
-- judge said.
--
-- So the mapped kind stays in `verdict` and drives all logic and colour, and the
-- judge's own word is kept here purely so the record can quote it back.

alter table verdicts
  add column if not exists verdict_as_returned text;

comment on column verdicts.verdict_as_returned is
  'The vocabulary the judge answered in (justified / not_justified / guilty / not_guilty / hung). Display only; verdict holds the mapped kind. NULL for rows written before this column existed.';

notify pgrst, 'reload schema';
