import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';
import { Game } from './core/Game';
import { showFatalError } from './ui/errors';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const viewport = document.getElementById('viewport');
  const ui = document.getElementById('ui');
  if (!viewport || !ui) throw new Error('Missing #viewport or #ui element');
  if (!webglAvailable()) {
    showFatalError(ui, 'WebGL is not available', 'Sittwe 3D needs a browser with WebGL enabled (Chrome, Edge, Safari or Firefox on a desktop computer).');
    return;
  }
  const game = new Game(viewport, ui);
  (window as unknown as { sittwe3d: Game }).sittwe3d = game;
  await game.init();
}

window.addEventListener('error', (e) => console.error('[Sittwe3D] Uncaught error:', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[Sittwe3D] Unhandled rejection:', e.reason));

boot().catch((err: unknown) => {
  console.error(err);
  const ui = document.getElementById('ui');
  if (ui) showFatalError(ui, 'Sittwe 3D failed to start', err instanceof Error ? err.message : String(err));
});
