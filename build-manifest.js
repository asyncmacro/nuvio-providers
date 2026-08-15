#!/usr/bin/env node

/**
 * Manifest Builder for nuvio-providers
 * 
 * Automatically compiles all provider metadata from src/<provider>/provider.json
 * into a single manifest.json at the repository root.
 * 
 * Excludes the '_template' provider.
 */

const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const srcDir = path.join(rootDir, 'src');
const manifestPath = path.join(rootDir, 'manifest.json');

// Default metadata generator for fallback
function getDefaultMetadata(dirName) {
    const formattedName = dirName
        .split(/[-_]+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return {
        id: dirName.toLowerCase(),
        name: formattedName,
        description: `${formattedName} streaming provider.`,
        version: "1.0.0",
        author: "Anonymous",
        supportedTypes: ["movie", "tv"],
        filename: `providers/${dirName}.js`,
        enabled: true,
        logo: "",
        contentLanguage: ["en"],
        formats: ["mp4"],
        limited: false,
        disabledPlatforms: [],
        supportsExternalPlayer: true
    };
}

function buildManifest() {
    console.log('🔍 Gathering provider metadata...');

    // Read or initialize root manifest template
    let manifestBase = {
        name: "All-in-One-Nuvio",
        version: "1.0.0",
        scrapers: []
    };

    if (fs.existsSync(manifestPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (existing.name) manifestBase.name = existing.name;
            if (existing.version) manifestBase.version = existing.version;
        } catch (e) {
            console.warn('⚠️  Could not parse existing manifest.json, using defaults.');
        }
    }

    if (!fs.existsSync(srcDir)) {
        console.error('❌ src/ directory not found.');
        process.exit(1);
    }

    // Read directories inside src/
    const folders = fs.readdirSync(srcDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter(name => name !== '_template'); // Exclude the template provider explicitly

    const scrapers = [];

    for (const folder of folders) {
        const providerJsonPath = path.join(srcDir, folder, 'provider.json');
        let metadata;

        if (fs.existsSync(providerJsonPath)) {
            try {
                metadata = JSON.parse(fs.readFileSync(providerJsonPath, 'utf8'));
                // Ensure ID and filename are set and correct
                if (!metadata.id) metadata.id = folder.toLowerCase();
                if (!metadata.filename) metadata.filename = `providers/${folder}.js`;
                console.log(`✅ Loaded metadata for '${folder}'`);
            } catch (err) {
                console.error(`⚠️  Failed to parse provider.json for '${folder}':`, err.message);
                console.log(`👉 Using default metadata for '${folder}'`);
                metadata = getDefaultMetadata(folder);
            }
        } else {
            console.log(`ℹ️  No provider.json found in 'src/${folder}/'. Generating defaults.`);
            metadata = getDefaultMetadata(folder);
            
            // Optionally, we can save the default provider.json back to the source directory
            try {
                fs.writeFileSync(providerJsonPath, JSON.stringify(metadata, null, 2) + '\n');
                console.log(`💾 Saved generated provider.json in 'src/${folder}/'`);
            } catch (writeErr) {
                console.warn(`⚠️  Could not write default provider.json to 'src/${folder}/'`);
            }
        }

        scrapers.push(metadata);
    }

    manifestBase.scrapers = scrapers;

    try {
        fs.writeFileSync(manifestPath, JSON.stringify(manifestBase, null, 2) + '\n');
        console.log(`\n✨ Successfully built manifest.json containing ${scrapers.length} active provider(s)!`);
        scrapers.forEach(s => {
            console.log(`   - [${s.enabled ? 'ENABLED ' : 'DISABLED'}] ${s.name} (${s.id})`);
        });
    } catch (err) {
        console.error('❌ Failed to write manifest.json:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    buildManifest();
}

module.exports = { buildManifest };
