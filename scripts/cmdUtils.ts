export const getArg = (_args: string[], _prefix?: string) => {
  const prefix = `${_prefix}:`;
  const arg = _args.find(a => a.indexOf(prefix) === 0)?.replace(prefix, '');
  if (!arg) {
    return null;
  }
  return arg;
};
