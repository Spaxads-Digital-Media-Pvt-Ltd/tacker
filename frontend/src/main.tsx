import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

// App is light-only (Section 3). Clear any legacy dark-mode class a returning session may have set.
document.documentElement.classList.remove('dark');
// The removed per-user theme switcher used to set --accent* as an inline style on <html>, which
// wins over index.css's :root values regardless of what they say. Strip any leftover from a
// session that ran the old code, so the stylesheet's constant accent always applies.
for (const prop of ['--accent', '--accent-hover', '--accent-subtle', '--accent-text']) {
  document.documentElement.style.removeProperty(prop);
}

function Root() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
