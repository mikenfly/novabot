import { execSync } from 'child_process';
import qrcodeTerminal from 'qrcode-terminal';
import { logger } from './logger.js';

interface TailscaleInfo {
  hostname: string;
  funnelUrl: string;
}

/**
 * Configure Tailscale Funnel automatiquement
 * Retourne l'URL publique ou null si échec
 */
export async function setupTailscaleFunnel(port: number, funnelPort?: number): Promise<TailscaleInfo | null> {
  try {
    // Vérifier que Tailscale est actif
    try {
      execSync('tailscale status', { stdio: 'pipe' });
    } catch {
      logger.warn('Tailscale non disponible - Funnel désactivé');
      return null;
    }

    const httpsPort = funnelPort || 443;
    logger.info({ localPort: port, httpsPort }, 'Configuration Tailscale Funnel...');

    // Configurer serve + funnel sur le port HTTPS choisi
    try {
      if (httpsPort === 443) {
        execSync(`tailscale funnel --bg ${port}`, { stdio: 'pipe' });
      } else {
        execSync(`tailscale funnel --bg --https=${httpsPort} http://localhost:${port}`, { stdio: 'pipe' });
      }
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

    // Obtenir le hostname Tailscale
    const statusOutput = execSync('tailscale status --json', {
      encoding: 'utf-8',
    });
    const tsStatus = JSON.parse(statusOutput);
    const dnsName = tsStatus.Self?.DNSName?.replace(/\.$/, '');

    if (!dnsName) {
      logger.warn('Impossible de déterminer le hostname Tailscale');
      return null;
    }

    const funnelUrl = httpsPort === 443
      ? `https://${dnsName}`
      : `https://${dnsName}:${httpsPort}`;
    const hostname = dnsName;

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
  const { getFirstToken, generateTemporaryToken } = await import('./auth.js');

  // Si un token existe déjà (permanent ou temporaire), l'utiliser
  const existingToken = getFirstToken();
  if (existingToken) {
    logger.info('Utilisation du token existant');
    return existingToken;
  }

  // Sinon créer un nouveau token temporaire pour le pairing
  logger.info('Génération d\'un token temporaire (5 min)...');
  const token = generateTemporaryToken();

  logger.info('Token temporaire généré');
  return token;
}
