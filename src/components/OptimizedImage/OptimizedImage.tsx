import type { ImgHTMLAttributes } from 'react';
import { publicAssetSrcSet, publicAssetUrl } from '@/utils/publicAssetUrl';
import styles from './OptimizedImage.module.css';

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string;
  avifSrcSet?: string;
};

const rasterSourcePattern = /\.(jpe?g|png)$/i;

function toAvifPath(src: string) {
  return src.replace(rasterSourcePattern, '.avif');
}

export function OptimizedImage({
  src,
  alt,
  className,
  decoding,
  loading,
  srcSet,
  sizes,
  avifSrcSet,
  ...imgProps
}: Props) {
  const resolvedDecoding = decoding ?? (loading === 'lazy' ? 'async' : 'auto');
  const resolvedSrc = src ? publicAssetUrl(src) : undefined;
  const resolvedSrcSet = srcSet ? publicAssetSrcSet(srcSet) : undefined;
  const resolvedAvifSrcSet = avifSrcSet
    ? publicAssetSrcSet(avifSrcSet)
    : undefined;
  const pictureClassName = className
    ? `${styles.picture} ${className}`
    : styles.picture;

  const image = (
    <img
      {...imgProps}
      className={styles.image}
      src={resolvedSrc}
      srcSet={resolvedSrcSet}
      sizes={sizes}
      alt={alt}
      loading={loading}
      decoding={resolvedDecoding}
    />
  );

  if (!src || !rasterSourcePattern.test(src)) {
    return (
      <img
        {...imgProps}
        className={className}
        src={resolvedSrc}
        srcSet={resolvedSrcSet}
        sizes={sizes}
        alt={alt}
        loading={loading}
        decoding={resolvedDecoding}
      />
    );
  }

  return (
    <picture className={pictureClassName}>
      <source
        srcSet={resolvedAvifSrcSet ?? toAvifPath(publicAssetUrl(src))}
        sizes={sizes}
        type="image/avif"
      />
      {image}
    </picture>
  );
}
