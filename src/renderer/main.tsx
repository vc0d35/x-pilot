import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/400-italic.css';
import '@fontsource/ibm-plex-mono/700.css';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
