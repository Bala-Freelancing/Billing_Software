export type AuditAction =
  | "auth.login_success"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.logout_all"
  | "auth.password_changed"
  | "auth.password_change_failed"
  // Written by scripts/owner.mjs (command line), listed here for reference.
  | "admin.owner_created"
  | "admin.password_reset"
  | "settings.updated"
  | "gst_slab.created"
  | "gst_slab.updated"
  | "product.created"
  | "product.updated"
  | "party.created"
  | "party.updated"
  | "purchase.created"
  | "purchase.cancelled"
  | "opening_stock.created"
  | "opening_stock.cancelled"
  | "purchase_return.created"
  | "purchase_return.cancelled"
  | "sale.created"
  | "sale.cancelled"
  | "sales_return.created"
  | "sales_return.cancelled"
  | "receipt.created"
  | "receipt.cancelled"
  | "payment.created"
  | "payment.cancelled";

export interface AuditEntry {
  action: AuditAction;
  userId: number | null;
  ip: string | null;
  userAgent: string | null;
  details?: Record<string, unknown>;
  at: number;
}

/**
 * Returns a prepared INSERT so callers can include the audit row in the same
 * D1 batch (one transaction) as the change it describes.
 */
export function auditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_log (created_at, user_id, action, ip, user_agent, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(
      entry.at,
      entry.userId,
      entry.action,
      entry.ip,
      entry.userAgent,
      entry.details ? JSON.stringify(entry.details) : null,
    );
}
