import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import './styles/tokens.css';
import './styles/base.css';
import './styles/workspace.css';
import './styles/motion.css';

createRoot(document.getElementById('root')!).render(<App />);
