import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from './logger.js';

export interface ChannelConfig {
  enabled: boolean;
  [key: string]: any;
}

export interface ChannelsConfig {
  channels: {
    pwa?: {
      enabled: boolean;
      port: number;
      standalone: boolean;
      tailscale_funnel: boolean;
    };
    whatsapp?: {
      enabled: boolean;
      trigger: string;
    };
    telegram?: {
      enabled: boolean;
    };
    slack?: {
      enabled: boolean;
    };
  };
  assistant: {
    name: string;
    timezone: string;
  };
  paths: {
    data_dir: string;
    groups_dir: string;
    store_dir: string;
  };
}

let config: ChannelsConfig | null = null;

export function loadChannelsConfig(): ChannelsConfig {
  if (config) return config;

  const configPath = path.join(process.cwd(), 'channels.yaml');

  if (!fs.existsSync(configPath)) {
    logger.warn('channels.yaml not found, using defaults');
    return getDefaultConfig();
  }

  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    config = yaml.load(fileContents) as ChannelsConfig;
    logger.info('Channels configuration loaded');
    return config;
  } catch (err) {
    logger.error({ err }, 'Failed to load channels.yaml, using defaults');
    return getDefaultConfig();
  }
}

function getDefaultConfig(): ChannelsConfig {
  return {
    channels: {
      pwa: {
        enabled: true,
        port: 3000,
        standalone: true,
        tailscale_funnel: true,
      },
      whatsapp: {
        enabled: false,
        trigger: '@Jimmy',
      },
    },
    assistant: {
      name: 'Jimmy',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    paths: {
      data_dir: './data',
      groups_dir: './groups',
      store_dir: './store',
    },
  };
}

export function isChannelEnabled(channel: string): boolean {
  const cfg = loadChannelsConfig();
  const channelConfig = (cfg.channels as any)[channel];
  return channelConfig?.enabled ?? false;
}

export function getChannelConfig<T = any>(channel: string): T | null {
  const cfg = loadChannelsConfig();
  const channelConfig = (cfg.channels as any)[channel];
  return channelConfig?.enabled ? channelConfig : null;
}
