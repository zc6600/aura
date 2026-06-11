export function isPathIgnored(relPath: string, ignoreList: string[]): boolean {
  const normalizedPath = relPath.replace(/\\/g, '/');

  return ignoreList.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    if (normalizedPattern === normalizedPath || normalizedPath.includes(normalizedPattern)) {
      return true;
    }

    // Simple wildcard translation (fnmatch)
    const regexStr =
      '^' +
      normalizedPattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$';
    try {
      const regex = new RegExp(regexStr);
      return regex.test(normalizedPath);
    } catch {
      return false;
    }
  });
}
