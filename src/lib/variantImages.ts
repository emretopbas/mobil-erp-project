// Variant photo storage — copies whatever expo-image-picker hands back
// (a cache-directory or content:// uri, gone the moment the OS reclaims
// cache space) into the app's persistent document directory, one file per
// variant. CLAUDE.md §3/§8: SQLite data lives in the persistent dir, never
// cache, "so a normal 'clear cache' cannot lose it" — the same rule applies
// here, since a photo the user just took losing itself on the next cache
// sweep would be a real data-loss bug, not a cosmetic one.

import { Directory, File, Paths } from 'expo-file-system';

function variantImagesDir(): Directory {
  const dir = new Directory(Paths.document, 'variant-images');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Copies a freshly picked/captured photo into persistent storage under
 * this variant's id (re-picking overwrites — any previous photo for the
 * same variant, even under a different extension, is removed first) and
 * returns the new `file://` uri to store on `ProductVariant.image_uri`. */
export async function saveVariantImage(sourceUri: string, variantId: string): Promise<string> {
  const dir = variantImagesDir();
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.startsWith(`${variantId}.`)) {
      entry.delete();
    }
  }
  const source = new File(sourceUri);
  const ext = source.extension || '.jpg';
  const dest = new File(dir, `${variantId}${ext}`);
  await source.copy(dest, { overwrite: true });
  return dest.uri;
}
