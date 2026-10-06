// Sanitises a title into a filename slug: lowercase, spaces to dashes, strip
// everything outside [a-z0-9-], collapse runs of dashes, trim the ends.
//
// WHY this lives in the shared kernel: it is a pure string transform the
// reconciliation arithmetic needs (title comparison is slug-based), and the
// vault module that owns note naming must not be a dependency of shared.
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
