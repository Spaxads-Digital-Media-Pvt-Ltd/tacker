/**
 * Macro substitution for the redirect destination (spec §5 step 10). Replaces {token}
 * placeholders so the advertiser can echo click_id back on conversion. Unknown tokens are left
 * intact. Values are URL-encoded.
 */
export type MacroValues = Record<string, string | null | undefined>;

export function substituteMacros(url: string, values: MacroValues): string {
  return url.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = values[name];
    return v == null ? whole : encodeURIComponent(v);
  });
}

/** Build the standard macro set available to every offer destination URL. */
export function buildMacros(args: {
  clickId: string;
  offerId: string;
  publisherId?: string | null;
  country?: string | null;
  device?: string | null;
  subs: (string | null | undefined)[];
}): MacroValues {
  return {
    click_id: args.clickId,
    offer_id: args.offerId,
    publisher_id: args.publisherId ?? '',
    country: args.country ?? '',
    device: args.device ?? '',
    sub1: args.subs[0] ?? '',
    sub2: args.subs[1] ?? '',
    sub3: args.subs[2] ?? '',
    sub4: args.subs[3] ?? '',
    sub5: args.subs[4] ?? '',
  };
}
