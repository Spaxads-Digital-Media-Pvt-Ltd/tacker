/**
 * The reference's full notification catalog — same 9 sections/rows power both Control Center ›
 * Platform Configurations › Default Notifications (network-wide defaults) and My Account › My
 * Notification Preferences (this user's own overrides), verified live against both pages.
 */
import type { NotifyDef } from '../pages/admin/controlCenter/shared';

export const PARTNER_NOTIFS: NotifyDef[] = [
  { name: 'Partner Reached Custom Daily Cap', desc: 'When the partner reaches a custom daily cap', dropdown: true, inApp: true, email: false },
  { name: 'New Partner Created', desc: 'When the partner is created by the network (as opposed to signups which trigger a different notification)', dropdown: true, inApp: true, email: false },
  { name: 'New Partner Signup', desc: 'When a new partner signs up for an account', dropdown: true, inApp: true, email: true },
  { name: 'Partner Approached Custom Daily Cap', desc: 'When the partner reaches 90% of a custom daily cap', dropdown: true, inApp: true, email: false },
  { name: 'Partner Approached Custom Monthly Cap', desc: 'When the partner reaches 90% of a custom monthly cap', dropdown: true, inApp: true, email: false },
  { name: 'Partner Approached Custom Global Cap', desc: 'When the partner reaches 90% of a custom global cap', dropdown: true, inApp: true, email: false },
  { name: 'Partner Reached Custom Monthly Cap', desc: 'When the partner reaches a custom monthly cap', dropdown: true, inApp: true, email: false },
  { name: 'Partner Reached Custom Global Cap', desc: 'When the partner reaches a custom global cap', dropdown: true, inApp: true, email: false },
  { name: 'Partner Offer Application', desc: 'When the partner applies to run an offer that requires approval', dropdown: true, inApp: true, email: false },
  { name: 'Partner Approaching Custom Weekly Cap', desc: 'When the partner reaches 90% of a custom weekly cap', dropdown: true, inApp: true, email: false },
  { name: 'Partner Reached Custom Weekly Cap', desc: 'When the partner reaches a custom weekly cap', dropdown: true, inApp: true, email: false },
  { name: 'Coupon Code Status Changed to Paused', desc: 'A coupon code with an expiration date was paused automatically', dropdown: true, inApp: true, email: false },
  { name: 'Partner User Email Changed', desc: 'When the Partner user email is updated in the system by the Partner.', inApp: false, email: false },
];

export const OFFER_NOTIFS_PLATFORM: NotifyDef[] = [
  { name: 'Offer Approaching Daily Cap', desc: 'When an offer reaches 90% of its daily cap', inApp: true, email: false },
  { name: 'Offer Approaching Monthly Cap', desc: 'When an offer reaches 90% of its monthly cap', inApp: true, email: false },
  { name: 'Offer Approaching Global Cap', desc: 'When an offer reaches 90% of its global cap', inApp: true, email: false },
  { name: 'Offer Reached Daily Cap', desc: 'When an offer reaches its daily cap', inApp: true, email: false },
  { name: 'Offer Reached Monthly Cap', desc: 'When an offer reaches its monthly cap', inApp: true, email: false },
  { name: 'Offer Reached Global Cap', desc: 'When an offer reaches its global cap', inApp: true, email: false },
  { name: 'Offer Created', desc: 'When a new offer is created', inApp: true, email: false },
  { name: 'Offer Status Changed', desc: 'When the offer status changes', inApp: true, email: false },
  { name: 'Offer Approaching Weekly Cap', desc: 'When an offer reaches 90% of its weekly cap', inApp: true, email: false },
  { name: 'Offer Reached Weekly Cap', desc: 'When an offer reaches its weekly cap', inApp: true, email: false },
  { name: 'Offer Description Changed', desc: 'When the html description of an offer is modified', inApp: true, email: false },
  { name: 'Creative Added to the Offer', desc: 'When a new creative is added to an offer', dropdown: true, inApp: true, email: true },
  { name: 'Traffic Optimized', desc: 'When the SmartSwitch triggers an optimization', dropdown: true, inApp: true, email: true },
  { name: 'SmartSwitch Rule Status Changed', desc: 'When a SmartSwitch with an expiration date is paused automatically', dropdown: true, inApp: true, email: true },
  { name: 'Traffic Control Status Changed', desc: 'When a traffic control with an expiration date is paused automatically', dropdown: true, inApp: true, email: true },
  { name: 'New Base Conversion Registered', desc: 'When a new base conversion happens', email: false },
  { name: 'New Additional Event Registered', desc: 'When a new additional event happens', email: false },
  { name: 'On Hold Conversion Status Changed', desc: 'When an On Hold Conversion status changes', email: false },
];

export const OFFER_GROUP_NOTIFS: NotifyDef[] = [
  { name: 'Offer Group Approaching Daily Cap', desc: 'When an offer group reaches 90% of its daily cap', inApp: true, email: false },
  { name: 'Offer Group Approaching Monthly Cap', desc: 'When an offer group reaches 90% of its monthly cap', inApp: true, email: false },
  { name: 'Offer Group Approaching Global Cap', desc: 'When an offer group reaches 90% of its global cap', inApp: true, email: false },
  { name: 'Offer Group Reached Daily Cap', desc: 'When an offer group reaches its daily cap', inApp: true, email: false },
  { name: 'Offer Group Reached Monthly Cap', desc: 'When an offer group reaches its monthly cap', inApp: true, email: false },
  { name: 'Offer Group Reached Global Cap', desc: 'When an offer group reaches its global cap', inApp: true, email: false },
  { name: 'Offer Group Approaching Weekly Cap', desc: 'When an offer group reaches 90% of its weekly cap', inApp: true, email: false },
  { name: 'Offer Group Reached Weekly Cap', desc: 'When an offer group reaches its weekly cap', inApp: true, email: false },
];

export const ADVERTISER_NOTIFS: NotifyDef[] = [
  { name: 'Advertiser Created', desc: 'When the advertiser is created by the network (as opposed to signups which trigger a different notification)', dropdown: true, inApp: true, email: false },
  { name: 'New Advertiser Signup', desc: 'When a new advertiser signs up for an account', dropdown: true, inApp: true, email: false },
];

export const ACTION_NOTIFS: NotifyDef[] = [
  { name: 'Action Scheduled', desc: 'When an action is initially created and scheduled', dropdown: true, inApp: true, email: false },
  { name: 'Scheduled Action Executed', desc: 'When a scheduled action has been executed', dropdown: true, inApp: true, email: false },
  { name: 'Scheduled Report Generated', desc: 'A report requested through Reporting > Saved & Scheduled was generated and is ready to be viewed', inApp: true, email: true },
];

export const BILLING_NOTIFS: NotifyDef[] = [
  { name: 'Invoice Created', desc: 'An invoice (partner or advertiser) was created manually or through the auto invoicing feature', dropdown: true, inApp: true, email: false },
  { name: 'Payment Executed', desc: 'A invoice payment was processed', dropdown: true, inApp: true, email: false },
  { name: 'Invoice Overdue', desc: 'When the due date of an invoice payment has been reached', inApp: false, email: false },
  { name: 'Partner billing information updated', desc: 'When partners update their billing information through the partner Portal', inApp: false, email: false },
];

export const NETWORK_NOTIFS: NotifyDef[] = [
  { name: 'Communication Hub Email (from network)', desc: 'When a Communication Hub Email is sent to you', email: true },
];

export const SECURITY_NOTIFS: NotifyDef[] = [
  { name: 'New Login', desc: 'New login detected from an unrecognized device', email: true },
];

export const TRAFFIC_HEALTH_NOTIFS: NotifyDef[] = [
  { name: 'Incidents', desc: 'Receive notifications as soon as an incident is detected', inApp: true, email: true },
  { name: 'Resolutions', desc: 'Receive notifications when an incident is successfully resolved', inApp: true, email: true },
  { name: 'Tasks', desc: 'Receive notifications when a domain-related task requiring my action is detected', inApp: true, email: true },
  { name: 'Task Completions', desc: 'Receive notifications when a domain-related task is completed', inApp: true, email: true },
];
