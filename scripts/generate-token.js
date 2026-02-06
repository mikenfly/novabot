#!/usr/bin/env node

// Generate a permanent access token for the PWA
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const authFile = path.join(dataDir, 'auth.json');

// Generate a secure random token
const token = crypto.randomBytes(32).toString('hex');

// Create auth store with just the token (no password needed)
const authStore = {
  tokens: [
    {
      token,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      deviceName: 'PWA Access',
      permanent: true
    }
  ]
};

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(authFile, JSON.stringify(authStore, null, 2));

console.log('\n✅ Token généré avec succès !\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔑 Votre token d\'accès :');
console.log('\n   ' + token);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('💾 Sauvegardez ce token en lieu sûr !');
console.log('📱 Pour vous connecter à la PWA :');
console.log('   1. Ouvrez l\'URL de la PWA');
console.log('   2. Entrez ce token dans le champ de connexion');
console.log('   3. Le token est valide pendant 1 an\n');
console.log('🔄 Pour générer un nouveau token, relancez ce script\n');
