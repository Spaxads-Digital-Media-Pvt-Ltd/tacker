/** Super Admin › Resellers & white-label — the API's shapes (money is text). */
export interface Reseller {
  id: string; name: string; contactName: string | null; contactEmail: string | null; commissionPct: string;
  status: 'active' | 'inactive'; notes: string | null; networks: number; createdAt: string; updatedAt: string;
}
export interface ResellerDetail extends Reseller {
  networkList: { id: string; name: string; slug: string; status: string; plan: string | null; createdAt: string }[];
  statement: { month: string; currency: string; paid: string; invoices: number; commission: string }[];
}
export interface WhiteLabel {
  enabled: boolean; brandName: string | null; primaryColor: string | null; supportUrl: string | null; hidePlatformBranding: boolean;
  dashboardDomain: string | null; domainVerified: boolean; domainVerifiedAt: string | null; domainCheckedAt: string | null;
  domainCheckResult: string | null; dnsRecord: { type: 'TXT'; name: string; value: string } | null;
}
