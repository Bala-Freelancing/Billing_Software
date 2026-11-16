// Double-entry posting helpers. Every document posts one journal entry whose
// debits equal its credits; an unbalanced entry is a programming error and is
// refused before anything is written.

export type SystemLedger =
  | "purchase"
  | "purchase_return"
  | "sales"
  | "sales_return"
  | "input_cgst"
  | "input_sgst"
  | "input_igst"
  | "output_cgst"
  | "output_sgst"
  | "output_igst"
  | "round_off"
  | "cash"
  | "bank"
  | "discount_allowed"
  | "discount_received";

export interface JournalLine {
  ledger?: SystemLedger;
  partyId?: number;
  debit: number;
  credit: number;
}

export type SourceType = "purchase" | "purchase_return" | "sale" | "sales_return" | "receipt" | "payment";

/** Adds a debit (positive) or credit (negative) line; zero amounts are skipped. */
export class JournalBuilder {
  readonly lines: JournalLine[] = [];

  debit(target: { ledger: SystemLedger } | { partyId: number }, amount: number): this {
    return this.add(target, amount, 0);
  }

  credit(target: { ledger: SystemLedger } | { partyId: number }, amount: number): this {
    return this.add(target, 0, amount);
  }

  /** Positive amount debits, negative credits (used for round-off). */
  signed(target: { ledger: SystemLedger } | { partyId: number }, amount: number): this {
    return amount >= 0 ? this.debit(target, amount) : this.credit(target, -amount);
  }

  private add(target: { ledger: SystemLedger } | { partyId: number }, debit: number, credit: number): this {
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit < 0 || credit < 0) {
      throw new Error("Journal amounts must be non-negative integer paise");
    }
    if (debit === 0 && credit === 0) return this;
    this.lines.push({ ...target, debit, credit });
    return this;
  }

  assertBalanced(): void {
    const dr = this.lines.reduce((a, l) => a + l.debit, 0);
    const cr = this.lines.reduce((a, l) => a + l.credit, 0);
    if (dr !== cr) throw new Error(`Unbalanced journal entry: debit ${dr} ≠ credit ${cr}`);
  }
}

const SOURCE_TABLE: Record<SourceType, string> = {
  purchase: "purchases",
  purchase_return: "purchase_returns",
  sale: "sales",
  sales_return: "sales_returns",
  receipt: "money_vouchers",
  payment: "money_vouchers",
};

/**
 * Statements that insert the journal entry and its lines for a document that is
 * being inserted in the same batch, located by its uid.
 */
export function journalStatements(
  db: D1Database,
  args: { sourceType: SourceType; uid: string; date: string; narration: string; journal: JournalBuilder; now: number },
): D1PreparedStatement[] {
  args.journal.assertBalanced();
  const table = SOURCE_TABLE[args.sourceType];
  return [
    db
      .prepare(
        `INSERT INTO journal_entries (entry_date, source_type, source_id, narration, created_at)
         VALUES (?1, ?2, (SELECT id FROM ${table} WHERE uid = ?3), ?4, ?5)`,
      )
      .bind(args.date, args.sourceType, args.uid, args.narration, args.now),
    db
      .prepare(
        `INSERT INTO journal_lines (entry_id, ledger_id, party_id, debit_paise, credit_paise)
         SELECT (SELECT e.id FROM journal_entries e WHERE e.source_type = ?1 AND e.source_id = (SELECT id FROM ${table} WHERE uid = ?2)),
                (SELECT l.id FROM ledgers l WHERE l.system_key = j.value ->> '$.ledger'),
                j.value ->> '$.partyId',
                j.value ->> '$.debit',
                j.value ->> '$.credit'
           FROM json_each(?3) j`,
      )
      .bind(args.sourceType, args.uid, JSON.stringify(args.journal.lines)),
  ];
}

/** Human-readable journal lines of a document, for display to the owner/auditor. */
export async function readJournal(db: D1Database, sourceType: SourceType, sourceId: number) {
  const { results } = await db
    .prepare(
      `SELECT COALESCE(l.name, p.name) AS account, jl.debit_paise, jl.credit_paise
         FROM journal_entries e
         JOIN journal_lines jl ON jl.entry_id = e.id
         LEFT JOIN ledgers l ON l.id = jl.ledger_id
         LEFT JOIN parties p ON p.id = jl.party_id
        WHERE e.source_type = ?1 AND e.source_id = ?2
        ORDER BY jl.debit_paise = 0, jl.id`,
    )
    .bind(sourceType, sourceId)
    .all<{ account: string; debit_paise: number; credit_paise: number }>();
  return results.map((r) => ({ account: r.account, debitPaise: r.debit_paise, creditPaise: r.credit_paise }));
}
