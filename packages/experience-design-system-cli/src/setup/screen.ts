export const SETUP_SCREENS = [
  { title: 'Prerequisites', kind: 'required' },
  { title: 'Coding agent', kind: 'required' },
  { title: 'Contentful', kind: 'optional' },
  { title: 'Preferences', kind: 'optional' },
] as const;

const WIDE_STEPPER_SEPARATOR = '  ·  ';
const WIDE_STEPPER_MIN_COLUMNS = SETUP_SCREENS.map((screen, index) => {
  const label = `${index + 1} ${screen.title}`;
  return index === 0 ? `[${label}]` : label;
})
  .join(WIDE_STEPPER_SEPARATOR)
  .length;

export function formatSetupHeader(version: string, columns = process.stdout.columns): string {
  const title = 'experiences setup';
  const versionLabel = `v${version}`;
  const inlineGap = 2;
  const contentWidth = title.length + inlineGap + versionLabel.length;
  const gap =
    columns !== undefined && columns >= contentWidth ? columns - title.length - versionLabel.length : inlineGap;

  return `\n\x1b[1m${title}\x1b[0m${' '.repeat(gap)}\x1b[2m${versionLabel}\x1b[0m\nPrepare this machine for \x1b[1mexperiences import\x1b[0m.\n`;
}

export function formatSetupStepper(activeStep: number, columns?: number): string {
  const isWide = columns !== undefined && columns >= WIDE_STEPPER_MIN_COLUMNS;

  if (!isWide) {
    const markers = SETUP_SCREENS.map((_, index) => {
      const step = index + 1;
      if (step < activeStep) return '\x1b[32m✓\x1b[0m';
      if (step === activeStep) return `\x1b[1m[${step}]\x1b[0m`;
      return `\x1b[2m${step}\x1b[0m`;
    });

    return `${markers.join('  ')}\n`;
  }

  const steps = SETUP_SCREENS.map((screen, index) => {
    const step = index + 1;
    if (step < activeStep) return `\x1b[32m✓\x1b[0m ${screen.title}`;
    if (step === activeStep) return `\x1b[1m[${step} ${screen.title}]\x1b[0m`;
    return `\x1b[2m${step} ${screen.title}\x1b[0m`;
  });

  return `${steps.join(`  \x1b[2m·\x1b[0m  `)}\n`;
}

export function formatSetupScreen(
  version: string,
  activeStep: number,
  title: string,
  kind: 'required' | 'optional',
  columns = process.stdout.columns,
): string {
  return `${formatSetupHeader(version, columns)}\n${formatSetupStepper(activeStep, columns)}\n\x1b[2m[${activeStep}/4]\x1b[0m \x1b[1m${title}\x1b[0m \x1b[2m· ${kind}\x1b[0m\n`;
}
