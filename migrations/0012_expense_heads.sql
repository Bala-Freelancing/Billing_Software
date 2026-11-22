-- Business expenses screen: heads the owner asked for (courier, diesel).
-- OR IGNORE: the owner may already have created a head with the same name.
INSERT OR IGNORE INTO ledgers (name, group_id, created_at) VALUES
  ('Courier Charges',       (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0),
  ('Fuel & Travel (Diesel)', (SELECT id FROM ledger_groups WHERE system_key = 'indirect_expenses'), 0);
