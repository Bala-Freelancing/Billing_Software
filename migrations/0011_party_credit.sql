-- Retailers & suppliers screen: credit limit and credit days per party.
-- 0 means no limit / no fixed credit period. Defaults keep the previous
-- release working on this schema.
ALTER TABLE parties ADD COLUMN credit_limit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0);
ALTER TABLE parties ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 0 CHECK (credit_days BETWEEN 0 AND 365);
