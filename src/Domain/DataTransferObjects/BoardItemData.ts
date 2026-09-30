// A card on the project board, in the shape the core needs. itemId is the
// opaque GitHub item id; type distinguishes a real issue from a draft card;
// issueUrl is present only for issue-backed items; statusOptionName is the
// current Status single-select option name (undefined when the card has no
// Status value set); draftTitle/draftBody are present only for draft cards.
// updatedAt is the card's own GraphQL updatedAt — the honest lane clock the
// conflict ladder may use (it moves on a lane change, unlike the issue's
// comment-noisy updatedAt); null when the transport carries none.
export interface BoardItemData {
  itemId: string;
  type: 'ISSUE' | 'DRAFT_ISSUE';
  issueUrl?: string;
  statusOptionName?: string;
  draftTitle?: string;
  draftBody?: string;
  updatedAt: string | null;
}
