import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { applyTheme, themeFromStoredSession } from './lib/themes';
import './index.css';

// App is light-only (Section 3). Clear any legacy dark-mode class a returning session may have set.
document.documentElement.classList.remove('dark');
// Apply the saved accent theme (Section 6) BEFORE first paint to avoid a flash of the wrong color.
applyTheme(themeFromStoredSession());

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
