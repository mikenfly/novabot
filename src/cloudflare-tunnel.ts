import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger.js';

let tunnelProcess: ChildProcess | null = null;
let shuttingDown = false;
let restartCount = 0;
const MAX_RESTART_DELAY = 60000;

/**
 * Start the cloudflared tunnel subprocess.
 * Reads CLOUDFLARE_TUNNEL_TOKEN from environment.
 * Returns true if the tunnel connected, false otherwise.
 */
export async function startCloudflareTunnel(localPort: number): Promise<boolean> {
  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  if (!token) {
    logger.warn('CLOUDFLARE_TUNNEL_TOKEN non défini — tunnel désactivé');
    return false;
  }

  shuttingDown = false;

  return new Promise((resolve) => {
    let resolved = false;

    const proc = spawn('cloudflared', ['tunnel', 'run', '--token', token], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const onData = (data: Buffer) => {
      const line = data.toString().trim();
      for (const segment of line.split('\n')) {
        if (segment.includes('Registered tunnel connection')) {
          restartCount = 0;
          logger.info('Cloudflare Tunnel connecté');
          if (!resolved) {
            resolved = true;
            resolve(true);
          }
        } else if (segment.includes('ERR') || segment.includes('error')) {
          logger.warn({ line: segment.trim() }, 'Cloudflare Tunnel');
        }
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('error', (err) => {
      logger.error({ err }, 'Impossible de lancer cloudflared — est-il installé ?');
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    proc.on('exit', (code) => {
      tunnelProcess = null;
      if (shuttingDown) return;

      const delay = Math.min(5000 * 2 ** restartCount, MAX_RESTART_DELAY);
      restartCount++;
      logger.warn({ code, delayMs: delay }, 'Cloudflare Tunnel arrêté, redémarrage...');
      setTimeout(() => {
        if (!shuttingDown) startCloudflareTunnel(localPort);
      }, delay);
    });

    tunnelProcess = proc;

    // Timeout: resolve after 15s even if no "Registered" seen
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(tunnelProcess !== null);
      }
    }, 15000);
  });
}

/**
 * Stop the tunnel gracefully.
 */
export async function stopCloudflareTunnel(): Promise<void> {
  shuttingDown = true;
  if (!tunnelProcess) return;

  logger.info('Arrêt du Cloudflare Tunnel...');
  tunnelProcess.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      tunnelProcess?.kill('SIGKILL');
      resolve();
    }, 5000);

    tunnelProcess?.on('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  tunnelProcess = null;
}

/**
 * Check if the tunnel process is alive.
 */
export function isTunnelRunning(): boolean {
  return tunnelProcess !== null && !tunnelProcess.killed;
}
