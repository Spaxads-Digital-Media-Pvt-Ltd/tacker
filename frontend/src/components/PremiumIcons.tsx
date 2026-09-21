import React from 'react';

export function PremiumRevenue({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <ellipse cx="12" cy="16" rx="8" ry="3" fill="currentColor" fillOpacity="0.25" />
      <ellipse cx="12" cy="12" rx="8" ry="3" fill="currentColor" fillOpacity="0.5" />
      <ellipse cx="12" cy="8" rx="8" ry="3" fill="currentColor" />
    </svg>
  );
}

export function PremiumPayout({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" fillOpacity="0.2" />
      <path fillRule="evenodd" clipRule="evenodd" d="M2 11H22V15H2V11Z" fill="currentColor" fillOpacity="0.5" />
      <rect x="6" y="13" width="4" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

export function PremiumMargin({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M11 21C6.02944 21 2 16.9706 2 12C2 7.02944 6.02944 3 11 3V11H19C19 15.9706 14.9706 21 11 21Z" fill="currentColor" fillOpacity="0.25" />
      <path d="M21 9C21 5.13401 17.866 2 14 2V9H21Z" fill="currentColor" />
    </svg>
  );
}

export function PremiumClicks({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <circle cx="12" cy="12" r="10" fill="currentColor" fillOpacity="0.2" />
      <circle cx="12" cy="12" r="5" fill="currentColor" fillOpacity="0.4" />
      <path d="M10 10L14 19L15.5 14.5L20 13L10 10Z" fill="currentColor" />
    </svg>
  );
}

export function PremiumConversions({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <path d="M2 20H22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 16L9 11L13 14L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 6V10M19 6H15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 16L9 11L13 14L19 6V20H4V16Z" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

export function PremiumConvRate({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="3" y="15" width="4" height="6" rx="2" fill="currentColor" fillOpacity="0.25" />
      <rect x="10" y="9" width="4" height="12" rx="2" fill="currentColor" fillOpacity="0.5" />
      <rect x="17" y="3" width="4" height="18" rx="2" fill="currentColor" />
    </svg>
  );
}

export function PremiumPerformance({ className = '', size = 24 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="2" y="3" width="20" height="18" rx="4" fill="currentColor" fillOpacity="0.15" />
      <path d="M2 14C6 14 8 8 12 8C16 8 18 14 22 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 18C6 18 8 12 12 12C16 12 18 18 22 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.4" />
    </svg>
  );
}
