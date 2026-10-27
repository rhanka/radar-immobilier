import { createHash, randomBytes } from "node:crypto";
import type pg from "pg";
import type { PreviewTicket, TicketMint } from "./preview-tickets.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export interface SharedReaderTickets {
  mint(input: TicketMint): Promise<PreviewTicket>;
  consume(ticket: string, browserBinding: string): Promise<PreviewTicket | null>;
}

export function createSharedReaderTickets(pool: pg.Pool): SharedReaderTickets {
  return {
    async mint(input) {
      if (!/^[a-f0-9]{64}$/.test(input.browserBinding)) throw new Error("Invalid browser binding");
      const ticket = randomBytes(32).toString("hex");
      await pool.query("DELETE FROM artifacts.reader_tickets WHERE expires_at <= now()");
      const row = await pool.query(`INSERT INTO artifacts.reader_tickets (ticket_hash,binding_hash,payload)
        VALUES ($1,$2,$3) RETURNING extract(epoch FROM expires_at)*1000 AS expires`,
      [hash(ticket), hash(input.browserBinding), input]);
      return { ...input, ticket, expiresAt: Number(row.rows[0].expires) };
    },
    async consume(ticket, browserBinding) {
      if (!/^[a-f0-9]{64}$/.test(ticket) || !/^[a-f0-9]{64}$/.test(browserBinding)) return null;
      const row = await pool.query(`DELETE FROM artifacts.reader_tickets
        WHERE ticket_hash=$1 AND binding_hash=$2 AND expires_at>now()
        RETURNING payload, extract(epoch FROM expires_at)*1000 AS expires`, [hash(ticket), hash(browserBinding)]);
      return row.rows[0] ? { ...row.rows[0].payload, ticket, expiresAt: Number(row.rows[0].expires) } : null;
    },
  };
}
