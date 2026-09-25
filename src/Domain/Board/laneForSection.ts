// The lane whose section id is the given id, or null when the id is not a lane
// section (a section-less item, or a section outside the lane map).
export function laneForSection(
  sections: Record<string, string>,
  sectionId: string | null,
): string | null {
  if (sectionId === null) {
    return null;
  }
  for (const [lane, id] of Object.entries(sections)) {
    if (id === sectionId) {
      return lane;
    }
  }
  return null;
}