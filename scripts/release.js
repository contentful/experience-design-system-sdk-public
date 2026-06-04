#!/usr/bin/env node

import { releaseVersion, releasePublish } from 'nx/release/index.js'
import { execSync } from 'node:child_process'

const branch = process.env.GITHUB_REF?.replace('refs/heads/', '') ?? ''
const isMain = branch === 'main'
const isCanary = branch === 'canary'

if (isCanary) {
  // Canary: conventional commits drive which packages bump and by how much.
  // The alpha preid formats the version as X.Y.Z-alpha.N so it is clearly
  // pre-release and never collides with a stable version number.
  // Git commit + tag + push are enabled (nx.json defaults) so each canary
  // release is a real, traceable tag in the repo.
  console.log('Running canary release...')

  try {
    const { releaseGraph, projectsVersionData } = await releaseVersion({
      preid: 'alpha',
      dryRun: false,
      verbose: true,
    })

    // If conventional commits found no feat/fix since the last tag, all
    // packages report the same version — nothing to publish.
    const hasChanges = Object.values(projectsVersionData).some(
      ({ newVersion, currentVersion }) => newVersion !== currentVersion
    )

    if (!hasChanges) {
      console.log('No releasable changes since last canary tag. Exiting.')
      process.exit(0)
    }

    for (const [project, { currentVersion, newVersion }] of Object.entries(projectsVersionData)) {
      console.log(`  ${project}: ${currentVersion} → ${newVersion}`)
    }

    const publishResults = await releasePublish({
      releaseGraph,
      tag: 'canary',
      dryRun: false,
      verbose: true,
    })

    console.log('\n✓ Canary packages published successfully!')
    const allSucceeded = Object.values(publishResults).every((r) => r.code === 0)
    process.exit(allSucceeded ? 0 : 1)
  } catch (error) {
    console.error('Canary release failed:', error)
    process.exit(1)
  }
} else if (!isMain) {
  // Dev: publish a throwaway SHA-stamped prerelease to GitHub Packages with
  // --tag dev for PR and branch preview builds. No git commit/tag/push so
  // these builds leave no permanent trace in the repo.
  const REF = `dev-build-${execSync('git rev-parse --short HEAD', {
    encoding: 'utf-8',
  }).trim()}`
  const normalizedRef = REF.replace(/\//g, '_')

  console.log(`Using prerelease identifier: ${normalizedRef}`)

  let affectedProjects
  try {
    const output = execSync('npx nx show projects --affected --json', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    affectedProjects = JSON.parse(output)
  } catch {
    affectedProjects = []
  }

  if (!affectedProjects || affectedProjects.length === 0) {
    console.log('No packages have changed. Exiting.')
    process.exit(0)
  }

  console.log('Affected projects:', affectedProjects)
  console.log('Publishing development prerelease for affected packages...')

  try {
    const { releaseGraph, projectsVersionData } = await releaseVersion({
      specifier: 'prerelease',
      preid: normalizedRef,
      dryRun: false,
      verbose: true,
      gitCommit: false,
      gitTag: false,
      gitPush: false,
      versionActionsOptionsOverrides: {
        skipLockFileUpdate: true,
      },
    })

    console.log('\nVersioned packages:')
    for (const [project, versionData] of Object.entries(projectsVersionData)) {
      console.log(`  ${project}: ${versionData.currentVersion} → ${versionData.newVersion}`)
    }

    const publishResults = await releasePublish({
      releaseGraph,
      dryRun: false,
      verbose: true,
      tag: 'dev',
    })

    console.log('\n✓ Development packages published successfully!')
    const allSucceeded = Object.values(publishResults).every((result) => result.code === 0)
    process.exit(allSucceeded ? 0 : 1)
  } catch (error) {
    console.error('Error during dev release:', error)
    process.exit(1)
  }
} else {
  // Main: stable release driven by conventional commits. NX reads commit
  // history, bumps the version, commits, tags, pushes, then publishes.
  console.log('Running NX release version...')

  try {
    const { projectsVersionData } = await releaseVersion({
      dryRun: false,
      verbose: true,
    })

    const anyBumps = Object.values(projectsVersionData).some((d) => d.newVersion !== null)
    if (!anyBumps) {
      console.log('No version bumps detected — nothing to publish.')
      process.exit(0)
    }

    console.log('Getting the new version from the latest tag...')
    const version = execSync('git describe --tags --abbrev=0', { encoding: 'utf-8' })
      .trim()
      .replace(/^v/, '')

    console.log(`Version: ${version}`)
    console.log('Running NX release publish...')

    await releasePublish({
      dryRun: false,
      verbose: true,
    })

    console.log('Release complete!')
    process.exit(0)
  } catch (error) {
    console.error('Release failed:', error)
    process.exit(1)
  }
}
