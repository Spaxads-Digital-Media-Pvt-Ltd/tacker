import { describe, it, expect } from 'vitest';
import { createdByLabel } from '../createdBy';

describe('createdByLabel (N2: names, never raw ids)', () => {
  it("shows the team member's name (or email) the API joined in", () => {
    expect(createdByLabel('6f0e7b57-1c1e-4c4e-9d1a-0b0f3a7c2d11', 'Priya Sharma')).toBe('Priya Sharma');
    expect(createdByLabel('6f0e7b57-1c1e-4c4e-9d1a-0b0f3a7c2d11', ' ops@acme.test ')).toBe('ops@acme.test');
  });
  it('an id with no team member behind it is "Unknown user"; no id is the system', () => {
    expect(createdByLabel('6f0e7b57-1c1e-4c4e-9d1a-0b0f3a7c2d11', null)).toBe('Unknown user');
    expect(createdByLabel('6f0e7b57-1c1e-4c4e-9d1a-0b0f3a7c2d11', '')).toBe('Unknown user');
    expect(createdByLabel(null, null)).toBe('System');
    expect(createdByLabel(undefined, undefined)).toBe('System');
  });
});
