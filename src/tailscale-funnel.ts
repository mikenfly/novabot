import { execSync } from 'child_process';
import qrcodeTerminal from 'qrcode-terminal';
import { logger } from './logger.js';
import { createAuthToken } from './auth.js';
import { WEB_PORT } from './config.js';

interface TailscaleInfo {
  hostname: string;
  funnelUrl: string;
}

const FUNNEL_PORT = 10000;

/**
 * Configure Tailscale Funnel automatiquement
 * Retourne l'URL publique ou null si échec
 */
export async function setupTailscaleFunnel(): Promise<TailscaleInfo | null> {
  try {
    // Vérifier que Tailscale est actif
    try {
      execSync('tailscale status', { stdio: 'pipe' });
    } catch {
      logger.warn('Tailscale non disponible - Funnel désactivé');
      return null;
    }

    logger.info('Configuration Tailscale Funnel...');

    // Arrêter les anciens serves/funnels
    try {
      execSync('tailscale funnel reset', { stdio: 'pipe' });
    } catch {
      // Pas grave si rien à arrêter
    }

    // Configurer funnel avec la nouvelle syntaxe simplifiée
    try {
      // La nouvelle syntaxe : tailscale funnel --bg <port>
      // Cela configure automatiquement serve + funnel en arrière-plan
      execSync(`tailscale funnel --bg ${WEB_PORT}`, {
        stdio: 'pipe',
      });
    } catch (err: any) {
      if (err.message?.includes('Access denied') || err.message?.includes('denied')) {
        logger.warn('Permissions Tailscale manquantes');
        console.log('\n⚠️  Tailscale Funnel nécessite une configuration initiale:');
        console.log('   sudo tailscale set --operator=$USER');
        console.log('   Puis relancez NanoClaw\n');
        return null;
      }
      throw err;
    }

    // Obtenir l'URL (serve ou funnel)
    const statusOutput = execSync('tailscale serve status', {
      encoding: 'utf-8',
    });

    // Parser l'output pour extraire l'URL
    const urlMatch = statusOutput.match(/https:\/\/[^\s]+/);
    if (!urlMatch) {
      logger.warn('Impossible de déterminer l\'URL Tailscale');
      return null;
    }

    const funnelUrl = urlMatch[0];
    const hostname = funnelUrl.replace(/^https:\/\//, '').split(':')[0];

    // Vérifier si c'est en mode public ou tailnet only
    const isPublic = !statusOutput.includes('(tailnet only)');

    if (isPublic) {
      logger.info({ funnelUrl }, 'Tailscale Funnel public activé');
    } else {
      logger.info({ funnelUrl }, 'Tailscale Serve activé (tailnet only)');
      logger.warn('Pour accès public, exécutez: sudo tailscale set --operator=$USER');
    }

    return { hostname, funnelUrl };
  } catch (err) {
    logger.error({ err }, 'Erreur configuration Tailscale Funnel');
    return null;
  }
}

/**
 * Génère et affiche un QR code pour la connexion rapide
 */
export function displayConnectionQR(
  funnelUrl: string,
  token: string
): void {
  // Créer l'URL avec le token en paramètre
  const loginUrl = `${funnelUrl}?token=${token}`;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📱 CONNEXION RAPIDE - Scannez ce QR code avec votre iPhone');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Afficher le QR code (pas de callback, affichage direct)
  qrcodeTerminal.generate(loginUrl, { small: true });

  console.log('\n🌍 URL directe:');
  console.log(`   ${funnelUrl}`);
  console.log('\n🔑 Token:');
  console.log(`   ${token}`);
  console.log('\n💡 Astuce: Installez sur l\'écran d\'accueil iOS');
  console.log('   Safari → Partager → "Sur l\'écran d\'accueil"');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Génère un token d'accès automatiquement si nécessaire
 */
export async function ensureAccessToken(): Promise<string> {
  const { getAllTokens } = await import('./auth.js');
  const tokens = getAllTokens();

  // Si un token existe déjà, l'utiliser
  if (tokens && tokens.length > 0) {
    logger.info('Utilisation du token existant');
    return tokens[0].token;
  }

  // Sinon créer un nouveau token automatiquement
  logger.info('Génération d\'un nouveau token...');
  const token = createAuthToken('auto-generated-for-qr', 'Auto QR');
  if (!token) {
    throw new Error('Failed to generate access token');
  }

  logger.info('Token d\'accès généré automatiquement');
  return token;
}
