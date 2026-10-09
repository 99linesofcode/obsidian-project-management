const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

exports.preCommit = ({ version }) => {
  const repositoryRoot = process.env.GITHUB_WORKSPACE ?? join(__dirname, '..');
  const manifestPath = join(repositoryRoot, 'manifest.json');
  const versionsPath = join(repositoryRoot, 'versions.json');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const versions = JSON.parse(readFileSync(versionsPath, 'utf8'));

  versions[version] = manifest.minAppVersion;

  writeFileSync(versionsPath, `${JSON.stringify(versions, null, 2)}\n`);
};
