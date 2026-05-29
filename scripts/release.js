#!/usr/bin/env node

import { releaseVersion, releasePublish } from 'nx/release/index.js'
import { execSync } from 'node:child_process'

const isDev = process.env.GITHUB_REF !== 'refs/heads/main'

if (isDev) {
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
