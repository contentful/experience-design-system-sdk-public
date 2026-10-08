# Help

The Help screen is read-only. It shows two things, both built in `help-info.ts`:

- **Where things are stored**: the config folder, the settings file and the debug log folder, resolved through
  `@contentful/experience-design-system-types/config`.
- **Troubleshooting**: CLI version, Node version, platform, whether Debug Mode is on and the folder this session writes
  its debug logs to.

It only reports paths and versions. It does not read the settings file, so no credential can appear on it.
