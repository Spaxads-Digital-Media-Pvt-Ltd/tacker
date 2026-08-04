/**
 * Per-page title plumbing (Section 2). A page declares its title via <PageHeader> (or usePageTitle);
 * the value is published to context and rendered ONCE in the top header (AppShell) — never duplicated
 * in the page body. Each page sets its title on mount and clears it on unmount, so navigating between
 * pages always ends on the new page's title. The header falls back to a route-derived default for any
 * page that doesn't declare one.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface PageTitleValue {
  title?: string;
  subtitle?: string;
  set: (title?: string, subtitle?: string) => void;
}

const PageTitleContext = createContext<PageTitleValue>({ set: () => {} });

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ title?: string; subtitle?: string }>({});
  return (
    <PageTitleContext.Provider value={{ ...state, set: (title, subtitle) => setState({ title, subtitle }) }}>
      {children}
    </PageTitleContext.Provider>
  );
}

/** Read the active page title/subtitle (used by the header). */
export function usePageTitleValue(): { title?: string; subtitle?: string } {
  const { title, subtitle } = useContext(PageTitleContext);
  return { title, subtitle };
}

/** Declare this page's title. Sets on mount, clears on unmount (transition-safe). */
export function usePageTitle(title?: string, subtitle?: string): void {
  const { set } = useContext(PageTitleContext);
  useEffect(() => {
    set(title, subtitle);
    return () => set(undefined, undefined);
  }, [title, subtitle, set]);
}
