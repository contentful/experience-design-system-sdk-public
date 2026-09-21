type ListScrollKey = {
  upArrow: boolean;
  downArrow: boolean;
  return: boolean;
};

type ListScrollOptions = {
  onExit: () => void;
  onScroll: (update: number | ((current: number) => number)) => void;
  maxOffset?: number;
  endOffset: number;
};

export function handleListScrollInput(
  input: string,
  key: ListScrollKey,
  { onExit, onScroll, maxOffset, endOffset }: ListScrollOptions,
): boolean {
  if (input === 'q' || key.return) {
    onExit();
    return true;
  }
  if (key.upArrow || input === 'k') {
    onScroll((offset) => Math.max(0, offset - 1));
    return true;
  }
  if (key.downArrow || input === 'j') {
    onScroll((offset) => (maxOffset === undefined ? offset + 1 : Math.min(maxOffset, offset + 1)));
    return true;
  }
  if (input === 'g') {
    onScroll(0);
    return true;
  }
  if (input === 'G') {
    onScroll(endOffset);
    return true;
  }
  return false;
}
