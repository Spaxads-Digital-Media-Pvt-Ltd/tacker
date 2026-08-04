/**
 * Analytics write interface (spec §2, §3B, §9). Click/conversion analytics events are written
 * through THIS interface so the store can change (Postgres now → ClickHouse at Phase 8) WITHOUT
 * rewriting callers. Callers depend on `AnalyticsWriter`, never on a concrete store.
 *
 * Phase 0: interface + a no-op default. Phase 2 wires a Postgres-backed implementation that
 * batch-inserts from the click-persist worker; Phase 8 swaps in a ClickHouse implementation
 * behind the same interface.
 */
export interface ClickEvent {
  clickId: string;
  networkId: string;
  offerId: string;
  publisherId: string;
  timestamp: string;
  [k: string]: unknown;
}

export interface ConversionEvent {
  conversionId: string;
  clickId: string;
  networkId: string;
  offerId: string;
  publisherId: string;
  timestamp: string;
  [k: string]: unknown;
}

export interface AnalyticsWriter {
  writeClicks(events: ClickEvent[]): Promise<void>;
  writeConversions(events: ConversionEvent[]): Promise<void>;
}

/** Deny-of-work default until a real writer is installed. Logs would be added by the caller. */
export class NoopAnalyticsWriter implements AnalyticsWriter {
  async writeClicks(_events: ClickEvent[]): Promise<void> {}
  async writeConversions(_events: ConversionEvent[]): Promise<void> {}
}

let writer: AnalyticsWriter = new NoopAnalyticsWriter();
export function setAnalyticsWriter(next: AnalyticsWriter): void {
  writer = next;
}
export function getAnalyticsWriter(): AnalyticsWriter {
  return writer;
}
