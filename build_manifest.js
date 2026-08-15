#!/usr/bin/env node
/**
 * Manifest builder for Nuvio providers
 * Generates manifest.json from src/ providers, excluding _template
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function loadExistingManifest() {
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing manifest.json, starting fresh');
    }
  }
  return {
    name: 'All-in-One-Nuvio',
    version: '1.0.0',
    scrapers: []
  };
}

function buildScraperEntry(id) {
  // Allow per-provider override file src/<id>/provider.json
  const overridePath = path.join(SRC_DIR, id, 'provider.json');
  let overrides = {};
  if (fs.existsSync(overridePath)) {
    try {
      overrides = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    } catch (e) {
      console.warn(`Failed to parse ${overridePath}: ${e.message}`);
    }
  }

  return {
    id,
    name: overrides.name || capitalize(id),
    description: overrides.description || `${capitalize(id)} provider`,
    version: overrides.version || '0.1.0',
    author: overrides.author || 'Your Name',
    supportedTypes: overrides.supportedTypes || ['tv', 'movie'],
    filename: `providers/${id}.js`,
    enabled: overrides.enabled !== undefined ? overrides.enabled : true,
    logo: overrides.logo || '',
    contentLanguage: overrides.contentLanguage || ['en'],
    formats: overrides.formats || ['mp4'],
    limited: overrides.limited || false,
    disabledPlatforms: overrides.disabledPlatforms || [],
    supportsExternalPlayer: overrides.supportsExternalPlayer !== undefined ? overrides.supportsExternalPlayer : true
  };
}

function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error('src directory not found');
    process.exit(1);
  }

  const entries = fs.readdirSync(SRC_DIR)
    .filter(name => {
      const full = path.join(SRC_DIR, name);
      return fs.statSync(full).isDirectory() && name !== '_template';
    })
    .sort();

  const manifest = loadExistingManifest();
  manifest.scrapers = entries.map(buildScraperEntry);

  // Ensure manifest has required top-level fields
  manifest.name = manifest.name || 'All-in-One-Nuvio';
  manifest.version = manifest.version || '1.0.0';

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✅ manifest.json rebuilt with ${manifest.scrapers.length} provider(s)`);
  console.log('Providers:', manifest.scrapers.map(s => s.id).join(', '));
}

main();
