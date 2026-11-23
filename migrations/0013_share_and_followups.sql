-- Modules 9–10.
-- 9: an unguessable link per invoice, so a bill can be sent on WhatsApp as a
--    link the customer opens without logging in. NULL until first shared.
ALTER TABLE sales ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX idx_sales_share_token ON sales (share_token) WHERE share_token IS NOT NULL;

-- 10: enquiries the shop promised to follow up ("will come back on Saturday").
CREATE TABLE follow_ups (
  id         INTEGER PRIMARY KEY,
  uid        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL DEFAULT '',
  note       TEXT    NOT NULL DEFAULT '',
  due_date   TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_follow_ups_status_due ON follow_ups (status, due_date);
