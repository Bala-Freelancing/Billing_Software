-- Module 9: ledger opening balances (cash in hand, bank, capital, loans… at go-live)
-- and a Capital Account ledger. Signed paise: debit positive, credit negative.
ALTER TABLE ledgers ADD COLUMN opening_balance_paise INTEGER NOT NULL DEFAULT 0;

INSERT INTO ledgers (name, group_id, system_key, created_at)
SELECT 'Capital Account', (SELECT id FROM ledger_groups WHERE system_key = 'capital'), 'capital', 0
 WHERE NOT EXISTS (SELECT 1 FROM ledgers WHERE name = 'Capital Account' COLLATE NOCASE);

-- Ledger report / trial balance filter journal lines by ledger and date.
CREATE INDEX idx_journal_lines_ledger_entry ON journal_lines (ledger_id, entry_id);
CREATE INDEX idx_journal_lines_party_entry  ON journal_lines (party_id, entry_id);
