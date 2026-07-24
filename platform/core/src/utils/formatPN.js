/**
 * Formats a patient name for display purposes.
 * Handles string, { Alphabetic }, and dcmjs naturalize array forms
 * like [{ Alphabetic: "DOE^JOHN" }].
 */
export default function formatPN(name) {
  if (!name) {
    return;
  }

  let nameToUse = name;

  // dcmjs naturalizeDataset often returns PN as [{ Alphabetic: "..." }]
  if (Array.isArray(nameToUse)) {
    nameToUse = nameToUse[0];
  }

  if (nameToUse && typeof nameToUse === 'object') {
    nameToUse = nameToUse.Alphabetic ?? nameToUse.Ideographic ?? nameToUse.Phonetic ?? '';
  }

  if (typeof nameToUse !== 'string') {
    return;
  }

  // Convert the first ^ to a ', '. String.replace() only affects
  // the first appearance of the character.
  const commaBetweenFirstAndLast = nameToUse.replace('^', ', ');

  // Replace any remaining '^' characters with spaces
  const cleaned = commaBetweenFirstAndLast.replace(/\^/g, ' ');

  // Trim any extraneous whitespace
  return cleaned.trim();
}
