#!/usr/bin/env node

/**
 * SPACE CADET PINBALL - SMART DIFFERENTIAL DEPLOY & VERSION RETENTION SCRIPT
 * Deploys changed components and prunes old hosting revisions.
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const DEPLOY_CACHE_PATH = resolve(ROOT_DIR, '.deploy-cache.json');
const DEFAULT_KEEP_COUNT = 10;

const args = process.argv.slice(2);
const cleanOnly = args.includes('--clean-only') || args.includes('--clean');
const forceDeploy = args.includes('--force');
const keepIndex = args.indexOf('--keep');
const keepCount = keepIndex !== -1 && args[keepIndex + 1] ? parseInt(args[keepIndex + 1], 10) : DEFAULT_KEEP_COUNT;

function getProjectId() {
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.VITE_FIREBASE_PROJECT_ID) return process.env.VITE_FIREBASE_PROJECT_ID;

  const firebasercPath = resolve(ROOT_DIR, '.firebaserc');
  if (existsSync(firebasercPath)) {
    try {
      const rc = JSON.parse(readFileSync(firebasercPath, 'utf8'));
      if (rc.projects?.default) return rc.projects.default;
    } catch {}
  }

  console.error('❌ Project ID not found in .firebaserc.');
  process.exit(1);
}

const projectId = getProjectId();

console.log('----------------------------------------------------------------');
console.log(`🚀 Space Cadet Pinball - Deployment & Version Retention Automation`);
console.log(`🎯 Project: ${projectId} | Retention: Keep last ${keepCount}`);
console.log('----------------------------------------------------------------\n');

function getAccessToken() {
  if (process.env.FIREBASE_TOKEN) return process.env.FIREBASE_TOKEN;
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;
  try {
    const token = execSync('gcloud auth print-access-token', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
    if (token) return token;
  } catch {}
  return null;
}

function hashFile(filePath) {
  if (!existsSync(filePath)) return '';
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function detectChanges() {
  let cache = {};
  if (existsSync(DEPLOY_CACHE_PATH)) {
    try {
      const parsed = JSON.parse(readFileSync(DEPLOY_CACHE_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object') cache = parsed;
    } catch {}
  }

  const currentHosting =
    hashFile(resolve(ROOT_DIR, 'index.html')) +
    hashFile(resolve(ROOT_DIR, 'SpaceCadetPinball.js')) +
    hashFile(resolve(ROOT_DIR, 'SpaceCadetPinball.wasm')) +
    hashFile(resolve(ROOT_DIR, 'SpaceCadetPinball.data')) +
    hashFile(resolve(ROOT_DIR, 'favicon.svg')) +
    hashFile(resolve(ROOT_DIR, 'manifest.json')) +
    hashFile(resolve(ROOT_DIR, 'firebase.json'));

  const targets = [];
  const changes = [];

  if (forceDeploy || cache.hosting !== currentHosting) {
    targets.push('hosting');
    changes.push('Hosting (Pinball engine, assets, or configuration changed)');
  }

  return {
    targets,
    changes,
    newCache: {
      hosting: currentHosting,
    },
  };
}

function buildAndDeploy(targets, changes, newCache) {
  if (targets.length === 0) {
    console.log('⚡ No code or asset changes detected. Skipping deployment!\n');
    return false;
  }

  console.log('🔍 Detected changes to deploy:');
  changes.forEach((c) => console.log(`   • ${c}`));
  console.log('');

  console.log('🎨 Generating PWA raster icons from favicon.svg...');
  try {
    execSync('node scripts/generate-icons.mjs', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('✅ Icons generated successfully.\n');
  } catch (err) {
    console.warn('⚠️ Icon generation notice:', err.message);
  }

  const targetArg = targets.join(',');
  console.log(`🚀 Deploying changed targets (--only ${targetArg}) to ${projectId}...`);
  try {
    execSync(`npx -y firebase-tools deploy --only ${targetArg} --project ${projectId} --non-interactive --force`, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
    console.log('✅ Firebase deployment complete.\n');
    writeFileSync(DEPLOY_CACHE_PATH, JSON.stringify(newCache, null, 2) + '\n');
    return true;
  } catch (err) {
    console.warn('⚠️ Firebase CLI deploy warning/error:', err.message);
    return false;
  }
}

async function pruneHostingDeployments(token) {
  console.log(`🧹 Cleaning up Firebase Hosting releases (retaining last ${keepCount})...`);
  try {
    const listUrl = `https://firebasehosting.googleapis.com/v1beta1/sites/${projectId}/versions?pageSize=100`;
    const res = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': projectId,
      },
    });
    if (!res.ok) return;

    const data = await res.json();
    const activeVersions = (data.versions || []).filter((v) => v.status !== 'DELETED');
    if (activeVersions.length <= keepCount) {
      console.log(`✅ Active Hosting releases (${activeVersions.length}) within retention limit (${keepCount}).\n`);
      return;
    }

    activeVersions.sort((a, b) => new Date(b.createTime || 0).getTime() - new Date(a.createTime || 0).getTime());
    const toDelete = activeVersions.slice(keepCount);
    console.log(`🗑️ Pruning ${toDelete.length} older Hosting releases...`);
    let deleted = 0;
    for (const v of toDelete) {
      const delRes = await fetch(`https://firebasehosting.googleapis.com/v1beta1/${v.name}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': projectId,
        },
      });
      if (delRes.ok) deleted++;
    }
    console.log(`✅ Pruned ${deleted} old Hosting releases.\n`);
  } catch (err) {
    console.warn('⚠️ Hosting pruning error:', err.message);
  }
}

async function main() {
  const token = getAccessToken();

  if (cleanOnly) {
    if (token) await pruneHostingDeployments(token);
    return;
  }

  const { targets, changes, newCache } = await detectChanges();
  const didDeploy = buildAndDeploy(targets, changes, newCache);

  if (didDeploy && token) {
    await pruneHostingDeployments(token);
  }
}

main().catch((err) => {
  console.error('Fatal error during deployment:', err);
  process.exit(1);
});
