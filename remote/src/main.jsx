import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { watchLifecycle } from './lifecycle.js';
import { t } from './i18n.js';
import './styles.css';

// If anything in the app throws, show a calm dark screen with a way back, never a blank page.
class Boundary extends Component {
  constructor(props) { super(props); this.state = { err: null, n: 0 }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { console.error('remote crashed', err); }
  render() {
    if (!this.state.err) return <App key={this.state.n} />;
    return (
      <div className="crash" role="alert">
        <p><b>{t('snag')}</b><small>{t('snag_note')}</small></p>
        <button className="pill solid" onClick={() => this.setState((s) => ({ err: null, n: s.n + 1 }))}>{t('try_again')}</button>
        <button className="pill glass" onClick={() => window.__tvReload?.(() => this.setState({ err: this.state.err }))}>{t('reload')}</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<Boundary />);
window.__tvReady = true;
try { sessionStorage.removeItem('tv.bootTries'); } catch { /* private mode */ }
window.__tvMeasure?.();
watchLifecycle();
