export function publicAssetUrl(
  path: string,
  baseUrl = import.meta.env.BASE_URL
) {
  if (!path.startsWith('/') || path.startsWith('//')) {
    return path;
  }

  return `${baseUrl}${path.slice(1)}`;
}

export function publicAssetSrcSet(
  srcSet: string,
  baseUrl = import.meta.env.BASE_URL
) {
  return srcSet
    .split(',')
    .map((candidate) => {
      const [path, ...descriptors] = candidate.trim().split(/\s+/);
      return [publicAssetUrl(path, baseUrl), ...descriptors].join(' ');
    })
    .join(', ');
}
