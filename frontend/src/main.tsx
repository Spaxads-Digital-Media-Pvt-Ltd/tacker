import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { ThemeProvider, applyTheme, readStoredTheme } from './theme/ThemeContext';
import './index.css';

// Apply the user's saved light/dark choice before first paint (light unless they opted into dark).
applyTheme(readStoredTheme());
// The removed per-user ACCENT switcher used to set --accent* as an inline style on <html>, which
// wins over index.css's token values regardless of what they say. Strip any leftover from a
// session that ran the old code, so the stylesheet's accent (per theme) always applies.
for (const prop of ['--accent', '--accent-hover', '--accent-subtle', '--accent-text']) {
  document.documentElement.style.removeProperty(prop);
}

function Root() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
