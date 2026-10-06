// A card on the project board, in the shape the core needs. itemId is the
// opaque code-host item id; type distinguishes a real issue from a draft card;
// issueUrl is present only for issue-backed items; statusOptionName is the
// current Status single-select option name (undefined when the card has no
// Status value set); draftTitle/draftBody are present only for draft cards.
// updatedAt is the card's own GraphQL updatedAt — the honest lane clock the
// conflict ladder may use (it moves on a lane change, unlike the issue's
// comment-noisy updatedAt); null when the transport carries none.
//
// WHY this lives in the shared kernel and not src/github: the name is neutral
// (a board is a port concept, not a provider one), and the port that returns it
// is owned by no provider. The gate enforces the direction: shared imports from
// no module.
export interface BoardItemData {
  itemId: string;
  type: 'ISSUE' | 'DRAFT_ISSUE';
  issueUrl?: string;
  statusOptionName?: string;
  draftTitle?: string;
  draftBody?: string;
  updatedAt: string | null;
}
