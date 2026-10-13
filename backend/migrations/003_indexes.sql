-- 003: indexes found missing by the review: closed issues per tool (history, delete checks,
-- usage report join) and the "who did it" foreign keys.
CREATE INDEX ix_issues_tool ON issues (tool_id);
CREATE INDEX ix_issues_issued_by ON issues (issued_by);
CREATE INDEX ix_issues_returned_by ON issues (returned_by);
